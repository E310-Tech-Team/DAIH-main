import {
  Prisma,
  CampaignType,
  CampaignTriggerType,
  CampaignChannel,
  CampaignStatus,
  CampaignExecutionStatus,
} from "@prisma/client";
import { prisma } from "../../db/client.js";
import { PEEDEE_CONFIG, FEATURE_FLAGS } from "../../config/peedee.config.js";
import { enqueueNotification } from "../notifications/notifications.queue.js";
import { emailService } from "../email/email.service.js";
import { coinService } from "../loyalty/coin.service.js";
import {
  CreateCampaignDTO,
  UpdateCampaignDTO,
  GenerateCopyRequestDTO,
  GenerateCopyResponseDTO,
  RfmTier,
  RfmScoreDTO,
  CampaignMetricDTO,
} from "@daih/types";
import { Decimal } from "@prisma/client/runtime/library";

export class CampaignService {
  // ─── Guardrail 1: Quiet Hours (21:00 to 08:00 WAT / UTC+1) ─────────────────
  /**
   * Checks whether the given date/time falls in quiet hours (21:00 to 08:00 WAT).
   * WAT is UTC+1.
   */
  isQuietHours(date: Date = new Date()): boolean {
    const watHour = (date.getUTCHours() + 1) % 24;
    return (
      watHour >= PEEDEE_CONFIG.QUIET_HOURS.START_HOUR ||
      watHour < PEEDEE_CONFIG.QUIET_HOURS.END_HOUR
    );
  }

  /**
   * Returns the next quiet hours end time (08:05 WAT on the same day or next day).
   */
  getNextQuietHoursEnd(date: Date = new Date()): Date {
    // Current WAT time
    const watDate = new Date(date.getTime() + 60 * 60 * 1000);
    const watHour = watDate.getUTCHours();

    const targetWat = new Date(watDate);
    if (watHour >= PEEDEE_CONFIG.QUIET_HOURS.START_HOUR) {
      // It's late evening; next quiet hours end is tomorrow at 08:05 WAT
      targetWat.setUTCDate(targetWat.getUTCDate() + 1);
    }
    targetWat.setUTCHours(
      PEEDEE_CONFIG.QUIET_HOURS.END_HOUR,
      PEEDEE_CONFIG.QUIET_HOURS.DEFERRED_MINUTE,
      0,
      0,
    );

    // Convert back from WAT to UTC (-1 hour)
    return new Date(targetWat.getTime() - 60 * 60 * 1000);
  }

  // ─── Guardrail 2: Frequency Cap (4 messages per month & 7-day spacing) ────────
  /**
   * Checks whether the recipient has reached the monthly frequency cap (4 messages per customer per month)
   * or received a discretionary message within the specified windowDays (spacing).
   */
  async isFrequencyCapped(
    recipientUserId: string,
    windowDays: number = 7,
    monthlyLimit: number = PEEDEE_CONFIG.CAMPAIGN_MONTHLY_FREQUENCY_CAP,
  ): Promise<boolean> {
    const now = Date.now();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const windowStart = new Date(now - windowDays * 24 * 60 * 60 * 1000);

    // 1. Check monthly frequency cap (4 marketing messages per customer per month)
    const monthlyExecutions = await prisma.campaignExecution.findMany({
      where: {
        recipientUserId,
        status: {
          in: [
            CampaignExecutionStatus.SENT,
            CampaignExecutionStatus.DEFERRED_QUIET_HOURS,
          ],
        },
        isHoldout: false,
        sentAt: { gte: thirtyDaysAgo },
        campaign: { isDiscretionary: true },
      },
    });

    if (monthlyExecutions.length >= monthlyLimit) {
      return true;
    }

    // 2. Check spacing window (e.g. 7 days) if windowDays > 0
    if (windowDays > 0) {
      const recentExecution = await prisma.campaignExecution.findFirst({
        where: {
          recipientUserId,
          status: {
            in: [
              CampaignExecutionStatus.SENT,
              CampaignExecutionStatus.DEFERRED_QUIET_HOURS,
            ],
          },
          isHoldout: false,
          sentAt: { gte: windowStart },
          campaign: { isDiscretionary: true },
        },
      });

      if (recentExecution) {
        return true;
      }
    }

    return false;
  }

  // ─── Guardrail 3: Budget Cap ────────────────────────────────────────────────
  /**
   * Checks if campaign has sufficient remaining budget to award the specified coin amount.
   */
  async checkAndReserveBudget(
    campaignId: string,
    coinAmount: number | Decimal,
    tx: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<boolean> {
    const campaign = await tx.campaign.findUnique({
      where: { id: campaignId },
      select: { budgetLimitNgn: true, spentBudgetNgn: true },
    });

    if (!campaign || !campaign.budgetLimitNgn) {
      return true; // No budget ceiling set
    }

    const currentSpent = new Decimal(campaign.spentBudgetNgn || 0);
    const limit = new Decimal(campaign.budgetLimitNgn);
    const addedCost = new Decimal(coinAmount).mul(PEEDEE_CONFIG.NAIRA_PER_COIN);

    if (currentSpent.plus(addedCost).greaterThan(limit)) {
      return false;
    }

    await tx.campaign.update({
      where: { id: campaignId },
      data: { spentBudgetNgn: currentSpent.plus(addedCost) },
    });

    return true;
  }

  // ─── Guardrail 4: Randomized Holdout Group Assignment ───────────────────────
  /**
   * Assigns user to holdout (control) group based on campaign holdoutPercentage (default 10%).
   */
  assignHoldout(
    userId: string,
    campaignId: string,
    holdoutPercentage: number = 10,
  ): boolean {
    // Deterministic hash based on userId + campaignId to ensure stable assignment
    let hash = 0;
    const str = `${userId}:${campaignId}`;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const bucket = Math.abs(hash) % 100;
    return bucket < holdoutPercentage;
  }

  // ─── Campaign CRUD & Management ─────────────────────────────────────────────
  async createCampaign(
    createdByUserId: string,
    dto: CreateCampaignDTO,
  ): Promise<any> {
    const campaign = await prisma.campaign.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim(),
        type: dto.type,
        triggerType: dto.triggerType || CampaignTriggerType.SCHEDULED_CRON,
        status:
          dto.status ||
          (dto.aiGenerated
            ? CampaignStatus.DRAFT
            : dto.type === CampaignType.CUSTOM_BROADCAST
              ? CampaignStatus.DRAFT
              : CampaignStatus.ACTIVE),
        subject: dto.subject?.trim(),
        body: dto.body.trim(),
        coinReward: dto.coinReward ? new Decimal(dto.coinReward) : null,
        discountPercentage: dto.discountPercentage
          ? new Decimal(dto.discountPercentage)
          : null,
        isDiscretionary: dto.isDiscretionary ?? true,
        frequencyCapDays: dto.frequencyCapDays ?? 7,
        budgetLimitNgn: dto.budgetLimitNgn
          ? new Decimal(dto.budgetLimitNgn)
          : null,
        holdoutPercentage: dto.holdoutPercentage ?? 10,
        aiGenerated: dto.aiGenerated ?? false,
        aiPrompt: dto.aiPrompt?.trim(),
        audienceFilter: (dto.audienceFilter as any) || {},
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        createdByUserId,
      },
    });

    if (createdByUserId) {
      try {
        await prisma.auditLog.create({
          data: {
            userId: createdByUserId,
            action: "CAMPAIGN_CREATE",
            entityType: "Campaign",
            entityId: campaign.id,
            metadata: {
              name: campaign.name,
              type: campaign.type,
              coinReward: campaign.coinReward
                ? Number(campaign.coinReward)
                : null,
              channel: campaign.channel,
            },
          },
        });
      } catch {}
    }

    return campaign;
  }

  async updateCampaign(
    campaignId: string,
    dto: UpdateCampaignDTO,
  ): Promise<any> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      const error: any = new Error("Campaign not found");
      error.statusCode = 404;
      throw error;
    }

    return prisma.campaign.update({
      where: { id: campaignId },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.description !== undefined && {
          description: dto.description?.trim(),
        }),
        ...(dto.subject !== undefined && { subject: dto.subject?.trim() }),
        ...(dto.body && { body: dto.body.trim() }),
        ...(dto.coinReward !== undefined && {
          coinReward: dto.coinReward ? new Decimal(dto.coinReward) : null,
        }),
        ...(dto.discountPercentage !== undefined && {
          discountPercentage: dto.discountPercentage
            ? new Decimal(dto.discountPercentage)
            : null,
        }),
        ...(dto.isDiscretionary !== undefined && {
          isDiscretionary: dto.isDiscretionary,
        }),
        ...(dto.frequencyCapDays !== undefined && {
          frequencyCapDays: dto.frequencyCapDays,
        }),
        ...(dto.budgetLimitNgn !== undefined && {
          budgetLimitNgn: dto.budgetLimitNgn
            ? new Decimal(dto.budgetLimitNgn)
            : null,
        }),
        ...(dto.holdoutPercentage !== undefined && {
          holdoutPercentage: dto.holdoutPercentage,
        }),
        ...(dto.audienceFilter !== undefined && {
          audienceFilter: dto.audienceFilter as any,
        }),
        ...(dto.scheduledAt !== undefined && {
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        }),
        ...(dto.status && { status: dto.status }),
      },
    });
  }

  /**
   * Guardrail 6: Human Approval Gate for AI-Generated Campaign Content.
   */
  async approveAiCampaign(
    adminUserId: string,
    campaignId: string,
  ): Promise<any> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      const error: any = new Error("Campaign not found");
      error.statusCode = 404;
      throw error;
    }

    return prisma.campaign.update({
      where: { id: campaignId },
      data: {
        aiApprovedByUserId: adminUserId,
        aiApprovedAt: new Date(),
        status: CampaignStatus.SCHEDULED,
      },
    });
  }

  /**
   * General Human Approval Gate for AI-Generated and High-Budget Campaigns.
   */
  async approveCampaign(adminUserId: string, campaignId: string): Promise<any> {
    return this.approveAiCampaign(adminUserId, campaignId);
  }

  // ─── Audience Resolution ───────────────────────────────────────────────────
  async resolveAudience(campaign: any): Promise<any[]> {
    const now = new Date();

    switch (campaign.type) {
      case CampaignType.WELCOME_SERIES: {
        // Customers registered in last 7 days with no confirmed bookings
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return prisma.user.findMany({
          where: {
            role: "CUSTOMER",
            isVerified: true,
            createdAt: { gte: sevenDaysAgo },
            bookings: { none: { state: "CONFIRMED" } },
          },
          select: { id: true, email: true, firstName: true, lastName: true },
        });
      }

      case CampaignType.INACTIVE_30D: {
        // Members who haven't booked in >= 30 days
        const thirtyDaysAgo = new Date(
          now.getTime() - 30 * 24 * 60 * 60 * 1000,
        );
        return prisma.user.findMany({
          where: {
            role: "CUSTOMER",
            isVerified: true,
            bookings: {
              some: { state: { in: ["CONFIRMED", "COMPLETED", "CHECKED_IN"] } },
              none: { createdAt: { gte: thirtyDaysAgo } },
            },
          },
          select: { id: true, email: true, firstName: true, lastName: true },
        });
      }

      case CampaignType.BIRTHDAY: {
        // Members whose birthday matches today's "MM-DD"
        const monthStr = String(now.getMonth() + 1).padStart(2, "0");
        const dayStr = String(now.getDate()).padStart(2, "0");
        const todayBirthday = `${monthStr}-${dayStr}`;

        return prisma.user.findMany({
          where: {
            role: "CUSTOMER",
            isVerified: true,
            birthday: todayBirthday,
          },
          select: { id: true, email: true, firstName: true, lastName: true },
        });
      }

      case CampaignType.ABANDONED_BOOKING: {
        // Users who created a hold that expired in the last 24h without payment
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const expiredBookings = await prisma.booking.findMany({
          where: {
            state: "EXPIRED",
            holdExpiresAt: { gte: yesterday, lte: now },
          },
          select: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        });
        return expiredBookings.map((b) => b.user);
      }

      default: {
        // Custom audience or broadcast
        const filter = (campaign.audienceFilter || {}) as any;
        return prisma.user.findMany({
          where: {
            role: "CUSTOMER",
            isVerified: true,
            ...(filter.inactiveDaysMin && {
              bookings: {
                none: {
                  createdAt: {
                    gte: new Date(
                      now.getTime() -
                        filter.inactiveDaysMin * 24 * 60 * 60 * 1000,
                    ),
                  },
                },
              },
            }),
          },
          select: { id: true, email: true, firstName: true, lastName: true },
          take: 500, // Batch limit per cycle
        });
      }
    }
  }

  // ─── Campaign Execution Engine with 6 Guardrails ───────────────────────────
  async executeCampaign(
    campaignId: string,
    executedByUserId?: string,
    ipAddress?: string,
  ): Promise<{
    targeted: number;
    sent: number;
    holdout: number;
    deferredQuietHours: number;
    suppressedFrequencyCap: number;
    suppressedBudget: number;
  }> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { aiApprovedBy: true },
    });

    if (!campaign) {
      const error: any = new Error("Campaign not found");
      error.statusCode = 404;
      throw error;
    }

    // Guardrail 6: Check Human Approval Gate if AI generated
    if (campaign.aiGenerated && !campaign.aiApprovedByUserId) {
      const error: any = new Error(
        "Guardrail Violation: AI-generated campaign cannot be executed without explicit human approval.",
      );
      error.code = "AI_APPROVAL_REQUIRED";
      error.statusCode = 400;
      throw error;
    }

    // Guardrail 7: Campaign Budget Approval Gate (Budget above ₦50,000 requires FINANCE_OFFICER or SUPER_ADMIN approval)
    const budgetThreshold =
      PEEDEE_CONFIG.CAMPAIGN_BUDGET_APPROVAL_THRESHOLD_NGN;
    if (
      campaign.budgetLimitNgn &&
      new Decimal(campaign.budgetLimitNgn).greaterThan(budgetThreshold)
    ) {
      if (!campaign.aiApprovedByUserId) {
        const error: any = new Error(
          `Guardrail Violation: Campaign budget exceeding ₦${budgetThreshold.toFixed(0)} requires explicit review and approval from FINANCE_OFFICER or SUPER_ADMIN.`,
        );
        error.code = "BUDGET_APPROVAL_REQUIRED";
        error.statusCode = 400;
        throw error;
      }

      const approver =
        (campaign as any).aiApprovedBy ||
        (await prisma.user.findUnique({
          where: { id: campaign.aiApprovedByUserId },
          select: { id: true, role: true },
        }));

      const allowedRoles = ["FINANCE_OFFICER", "SUPER_ADMIN"];
      if (!approver || !allowedRoles.includes(approver.role)) {
        const error: any = new Error(
          "Guardrail Violation: Campaign budget exceeding ₦50,000 must be reviewed and approved by a FINANCE_OFFICER or SUPER_ADMIN.",
        );
        error.code = "UNAUTHORIZED_BUDGET_APPROVER";
        error.statusCode = 403;
        throw error;
      }
    }

    const recipients = await this.resolveAudience(campaign);

    let sentCount = 0;
    let holdoutCount = 0;
    let deferredCount = 0;
    let freqCapCount = 0;
    let budgetCapCount = 0;

    const now = new Date();
    const inQuietHours = this.isQuietHours(now);
    const quietHoursEnd = inQuietHours ? this.getNextQuietHoursEnd(now) : null;

    for (const recipient of recipients) {
      // 1. Check idempotency: Has user already received this campaign?
      const existing = await prisma.campaignExecution.findFirst({
        where: {
          campaignId,
          recipientUserId: recipient.id,
          status: {
            in: [
              CampaignExecutionStatus.SENT,
              CampaignExecutionStatus.DEFERRED_QUIET_HOURS,
            ],
          },
        },
      });
      if (existing) continue;

      // 2. Guardrail 4: Holdout Group (10% control group)
      if (campaign.isDiscretionary) {
        const isHoldout = this.assignHoldout(
          recipient.id,
          campaignId,
          campaign.holdoutPercentage,
        );
        if (isHoldout) {
          await prisma.campaignExecution.create({
            data: {
              campaignId,
              recipientUserId: recipient.id,
              channel: campaign.channel,
              status: CampaignExecutionStatus.SUPPRESSED_HOLDOUT,
              isHoldout: true,
            },
          });
          holdoutCount++;
          continue;
        }
      }

      // 3. Guardrail 2: 7-Day Frequency Cap for discretionary messages
      if (campaign.isDiscretionary) {
        const capped = await this.isFrequencyCapped(
          recipient.id,
          campaign.frequencyCapDays,
        );
        if (capped) {
          await prisma.campaignExecution.create({
            data: {
              campaignId,
              recipientUserId: recipient.id,
              channel: campaign.channel,
              status: CampaignExecutionStatus.SUPPRESSED_FREQUENCY_CAP,
              isHoldout: false,
            },
          });
          freqCapCount++;
          continue;
        }
      }

      // 4. Guardrail 3: Budget Cap Check
      if (campaign.coinReward && Number(campaign.coinReward) > 0) {
        const budgetOk = await this.checkAndReserveBudget(
          campaignId,
          campaign.coinReward,
        );
        if (!budgetOk) {
          await prisma.campaignExecution.create({
            data: {
              campaignId,
              recipientUserId: recipient.id,
              channel: campaign.channel,
              status: CampaignExecutionStatus.SUPPRESSED_BUDGET_CAP,
              isHoldout: false,
            },
          });
          budgetCapCount++;
          continue;
        }
      }

      // 5. Guardrail 1: Quiet Hours Deferral (21:00 - 08:00 WAT)
      if (campaign.isDiscretionary && inQuietHours && quietHoursEnd) {
        await prisma.campaignExecution.create({
          data: {
            campaignId,
            recipientUserId: recipient.id,
            channel: campaign.channel,
            status: CampaignExecutionStatus.DEFERRED_QUIET_HOURS,
            deferredUntil: quietHoursEnd,
            isHoldout: false,
          },
        });
        deferredCount++;
        continue;
      }

      // 6. Deliver Message (Treatment Group)
      await prisma.campaignExecution.create({
        data: {
          campaignId,
          recipientUserId: recipient.id,
          channel: campaign.channel,
          status: CampaignExecutionStatus.SENT,
          sentAt: new Date(),
          isHoldout: false,
          coinAwarded: campaign.coinReward,
        },
      });

      // Credit coin reward if campaign provides immediate reward
      if (campaign.coinReward && Number(campaign.coinReward) > 0) {
        try {
          await coinService.creditCoins({
            userId: recipient.id,
            action: "ADMIN_ADJUSTMENT" as any,
            amount: campaign.coinReward,
            referenceType: "CAMPAIGN",
            referenceId: campaignId,
            idempotencyKey: `campaign_reward_${campaignId}_${recipient.id}`,
            metadata: { campaignName: campaign.name },
          });
        } catch (err: any) {
          console.warn(
            "[Campaign] Failed to credit coin reward:",
            err?.message,
          );
        }
      }

      // Dispatch email notification (Enqueued to BullMQ worker + direct failover for dev)
      try {
        const emailPayload = {
          subject: campaign.subject || campaign.name,
          content: campaign.body,
          coinReward: campaign.coinReward
            ? Number(campaign.coinReward)
            : undefined,
          discountPercentage: campaign.discountPercentage
            ? Number(campaign.discountPercentage)
            : undefined,
        };

        // Try queue first
        await enqueueNotification(
          "campaign.broadcast",
          recipient.email,
          recipient.firstName,
          emailPayload,
        );

        // Direct email dispatch to ensure immediate delivery in development or direct setups
        await emailService.sendCampaignBroadcastEmail(
          recipient.email,
          recipient.firstName,
          emailPayload.subject,
          emailPayload.content,
          emailPayload.coinReward,
          emailPayload.discountPercentage,
        );
      } catch (err: any) {
        console.warn("[Campaign] Email delivery notice:", err?.message);
      }

      sentCount++;
    }

    // Update campaign status & timestamp
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        lastRunAt: new Date(),
        status: CampaignStatus.ACTIVE,
      },
    });

    if (executedByUserId) {
      try {
        await prisma.auditLog.create({
          data: {
            userId: executedByUserId,
            action: "CAMPAIGN_EXECUTE",
            entityType: "Campaign",
            entityId: campaignId,
            ipAddress: ipAddress || null,
            metadata: {
              campaignName: campaign.name,
              channel: campaign.channel,
              coinReward: campaign.coinReward
                ? Number(campaign.coinReward)
                : null,
              targeted: recipients.length,
              sent: sentCount,
              holdout: holdoutCount,
              deferredQuietHours: deferredCount,
              suppressedFrequencyCap: freqCapCount,
              suppressedBudget: budgetCapCount,
            },
          },
        });
      } catch (auditErr) {
        console.warn("[CampaignService] AuditLog recording notice:", auditErr);
      }
    }

    return {
      targeted: recipients.length,
      sent: sentCount,
      holdout: holdoutCount,
      deferredQuietHours: deferredCount,
      suppressedFrequencyCap: freqCapCount,
      suppressedBudget: budgetCapCount,
    };
  }

  // ─── Delete / Disable / Archive Campaign ───────────────────────────────────
  async deleteCampaign(
    campaignId: string,
  ): Promise<{ success: boolean; action: "DELETED" | "ARCHIVED" }> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { _count: { select: { executions: true } } },
    });

    if (!campaign) {
      const error: any = new Error("Campaign not found");
      error.statusCode = 404;
      throw error;
    }

    if (campaign._count.executions > 0) {
      // Soft-delete / Archive if past executions exist
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.ARCHIVED },
      });
      return { success: true, action: "ARCHIVED" };
    }

    // Hard delete if clean / never dispatched
    await prisma.campaign.delete({ where: { id: campaignId } });
    return { success: true, action: "DELETED" };
  }

  // ─── Process Deferred Quiet Hours Executions ───────────────────────────────
  async processDeferredQuietHoursExecutions(): Promise<{ dispatched: number }> {
    const now = new Date();
    const readyExecutions = await prisma.campaignExecution.findMany({
      where: {
        status: CampaignExecutionStatus.DEFERRED_QUIET_HOURS,
        deferredUntil: { lte: now },
      },
      include: {
        campaign: true,
        recipient: true,
      },
      take: 100,
    });

    let dispatched = 0;
    for (const exec of readyExecutions) {
      // Re-verify frequency cap at dispatch time
      const capped = await this.isFrequencyCapped(
        exec.recipientUserId,
        exec.campaign.frequencyCapDays,
      );

      if (capped) {
        await prisma.campaignExecution.update({
          where: { id: exec.id },
          data: { status: CampaignExecutionStatus.SUPPRESSED_FREQUENCY_CAP },
        });
        continue;
      }

      await prisma.campaignExecution.update({
        where: { id: exec.id },
        data: {
          status: CampaignExecutionStatus.SENT,
          sentAt: new Date(),
        },
      });

      try {
        await emailService.sendCampaignBroadcastEmail(
          exec.recipient.email,
          exec.recipient.firstName,
          exec.campaign.subject || exec.campaign.name,
          exec.campaign.body,
          exec.campaign.coinReward
            ? Number(exec.campaign.coinReward)
            : undefined,
          exec.campaign.discountPercentage
            ? Number(exec.campaign.discountPercentage)
            : undefined,
        );
      } catch {}

      dispatched++;
    }

    return { dispatched };
  }

  // ─── Lift Analytics & Conversion Attribution ───────────────────────────────
  /**
   * Records booking conversion and updates incremental lift metrics (treatment vs holdout).
   */
  async recordConversion(
    userId: string,
    bookingId: string,
    amount: number | Decimal,
  ): Promise<void> {
    const conversionAmount = new Decimal(amount);
    const attributionWindowStart = new Date(
      Date.now() - 14 * 24 * 60 * 60 * 1000,
    ); // 14-day window

    // Find executions for this user within attribution window
    const executions = await prisma.campaignExecution.findMany({
      where: {
        recipientUserId: userId,
        status: {
          in: [
            CampaignExecutionStatus.SENT,
            CampaignExecutionStatus.SUPPRESSED_HOLDOUT,
          ],
        },
        createdAt: { gte: attributionWindowStart },
        convertedAt: null,
      },
    });

    for (const exec of executions) {
      await prisma.campaignExecution.update({
        where: { id: exec.id },
        data: {
          convertedAt: new Date(),
          conversionAmount,
        },
      });

      // Recalculate campaign metrics
      await this.recalculateMetrics(exec.campaignId);
    }
  }

  /**
   * Recalculates metrics and lift for a campaign.
   */
  async recalculateMetrics(campaignId: string): Promise<CampaignMetricDTO> {
    const period = "ALL_TIME";
    const executions = await prisma.campaignExecution.findMany({
      where: { campaignId },
    });

    const treatmentExecs = executions.filter(
      (e) => !e.isHoldout && e.status === CampaignExecutionStatus.SENT,
    );
    const holdoutExecs = executions.filter((e) => e.isHoldout);

    const treatmentSent = treatmentExecs.length;
    const holdoutCount = holdoutExecs.length;

    const treatmentConversions = treatmentExecs.filter(
      (e) => e.convertedAt !== null,
    ).length;
    const holdoutConversions = holdoutExecs.filter(
      (e) => e.convertedAt !== null,
    ).length;

    const treatmentRevenue = treatmentExecs.reduce(
      (sum, e) => sum.plus(new Decimal(e.conversionAmount || 0)),
      new Decimal(0),
    );
    const holdoutRevenue = holdoutExecs.reduce(
      (sum, e) => sum.plus(new Decimal(e.conversionAmount || 0)),
      new Decimal(0),
    );

    const treatmentRate =
      treatmentSent > 0 ? treatmentConversions / treatmentSent : 0;
    const holdoutRate =
      holdoutCount > 0 ? holdoutConversions / holdoutCount : 0;
    const incrementalLift = treatmentRate - holdoutRate;

    const metric = await prisma.campaignMetric.upsert({
      where: {
        campaignId_period: { campaignId, period },
      },
      create: {
        campaignId,
        period,
        totalTargeted: executions.length,
        treatmentSent,
        holdoutCount,
        treatmentConversions,
        holdoutConversions,
        treatmentRevenue,
        holdoutRevenue,
        incrementalLift: new Decimal(incrementalLift),
      },
      update: {
        totalTargeted: executions.length,
        treatmentSent,
        holdoutCount,
        treatmentConversions,
        holdoutConversions,
        treatmentRevenue,
        holdoutRevenue,
        incrementalLift: new Decimal(incrementalLift),
      },
    });

    return {
      id: metric.id,
      campaignId,
      period,
      totalTargeted: metric.totalTargeted,
      treatmentSent: metric.treatmentSent,
      holdoutCount: metric.holdoutCount,
      treatmentConversions: metric.treatmentConversions,
      holdoutConversions: metric.holdoutConversions,
      treatmentRevenue: Number(metric.treatmentRevenue),
      holdoutRevenue: Number(metric.holdoutRevenue),
      treatmentConversionRate: Math.round(treatmentRate * 10000) / 100, // percentage e.g. 14.5%
      holdoutConversionRate: Math.round(holdoutRate * 10000) / 100,
      incrementalLift: Math.round(incrementalLift * 10000) / 100, // percentage points e.g. +3.2%
      revenueLiftNgn: Number(treatmentRevenue.minus(holdoutRevenue)),
    };
  }

  // ─── AI Copy Drafting (Human Approval Gated) ───────────────────────────────
  async generateAiCopy(
    dto: GenerateCopyRequestDTO,
  ): Promise<GenerateCopyResponseDTO> {
    const tone = dto.tone || "friendly";

    let subject = "";
    let body = "";

    switch (dto.campaignType) {
      case CampaignType.WELCOME_SERIES:
        subject = "Welcome to DAIH Hub — Claim Your 500 PeeDee Coins!";
        body = `Hi there,\n\nWe're thrilled to welcome you to DAIH Hub. Your account has been credited with 500 PeeDee Coins (₦500 value) to use toward your first desk or private office reservation.\n\nEnjoy blazing-fast internet, premium power backup, and complimentary coffee.\n\nBook your desk today and experience productivity at its finest!\n\nBest,\nDAIH Community Team`;
        break;

      case CampaignType.INACTIVE_30D:
        subject = "We miss you at DAIH Hub — Here's a special invite back";
        body = `Hi there,\n\nIt's been a while since your last visit. We've upgraded our workspaces with high-speed ergonomic setups and refreshed coffee lounges.\n\nBook your next visit this week and earn 2x PeeDee Coins on check-in!\n\nSee you soon,\nDAIH Hub Team`;
        break;

      case CampaignType.BIRTHDAY:
        subject = "Happy Birthday from DAIH Hub! 🎂 500 PeeDee Coins for you";
        body = `Happy Birthday!\n\nTo celebrate your special day, we've gifted 500 PeeDee Coins to your wallet. Redeem them on your next workspace booking or treat yourself to a dedicated conference session.\n\nHave a fantastic day!\nDAIH Hub Team`;
        break;

      case CampaignType.STREAK_ACHIEVEMENT:
        subject = "3 Months Strong! 🔥 You've earned a 200 PD Streak Bonus";
        body = `Congratulations on your consistency! You've booked with DAIH Hub for 3 consecutive months. As a token of appreciation, 200 PeeDee Coins have been added to your balance.\n\nKeep the momentum going!\nDAIH Hub Community`;
        break;

      default:
        subject = `Special update from DAIH Hub: ${dto.goal}`;
        body = `Hello,\n\nWe have an exclusive update for our community members. Reserve your workspace now and enjoy seamless amenities designed for modern professionals.\n\nDAIH Hub Team`;
        break;
    }

    return {
      subject,
      body,
      previewText: subject,
    };
  }

  // ─── Nightly RFM Scoring Engine ────────────────────────────────────────────
  async calculateRfmScores(): Promise<{ processedCount: number }> {
    const customers = await prisma.user.findMany({
      where: { role: "CUSTOMER", isVerified: true },
      include: {
        bookings: {
          where: { state: { in: ["CONFIRMED", "COMPLETED", "CHECKED_IN"] } },
          select: { createdAt: true, totalAmount: true },
        },
      },
    });

    const now = new Date();
    let processedCount = 0;

    for (const customer of customers) {
      const bookings = customer.bookings;
      const frequency = bookings.length;
      const monetary = bookings.reduce(
        (sum, b) => sum + Number(b.totalAmount),
        0,
      );

      let recencyDays = 999;
      if (bookings.length > 0) {
        const sorted = bookings.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        const lastBookingDate = new Date(sorted[0].createdAt);
        recencyDays = Math.floor(
          (now.getTime() - lastBookingDate.getTime()) / (1000 * 60 * 60 * 24),
        );
      }

      // R Score (1-5, lower recency days = higher score)
      let rScore = 1;
      if (recencyDays <= 7) rScore = 5;
      else if (recencyDays <= 14) rScore = 4;
      else if (recencyDays <= 30) rScore = 3;
      else if (recencyDays <= 60) rScore = 2;

      // F Score (1-5)
      let fScore = 1;
      if (frequency >= 10) fScore = 5;
      else if (frequency >= 5) fScore = 4;
      else if (frequency >= 3) fScore = 3;
      else if (frequency >= 2) fScore = 2;

      // M Score (1-5)
      let mScore = 1;
      if (monetary >= 100000) mScore = 5;
      else if (monetary >= 50000) mScore = 4;
      else if (monetary >= 25000) mScore = 3;
      else if (monetary >= 10000) mScore = 2;

      // Segment Tier
      let tier: RfmTier = RfmTier.POTENTIAL_LOYALIST;
      if (rScore >= 4 && fScore >= 4 && mScore >= 4) tier = RfmTier.CHAMPION;
      else if (rScore >= 3 && fScore >= 3 && mScore >= 3)
        tier = RfmTier.LOYAL_MEMBER;
      else if (rScore >= 4 && fScore <= 2) tier = RfmTier.RECENT_CUSTOMER;
      else if (rScore <= 2 && fScore >= 3) tier = RfmTier.AT_RISK;
      else if (rScore <= 2 && fScore <= 2 && frequency > 0)
        tier = RfmTier.HIBERNATING;
      else if (frequency === 0) tier = RfmTier.LOST;

      // Update customer acquisitionSource or metadata with RFM tier for fast segment queries
      await prisma.user.update({
        where: { id: customer.id },
        data: { acquisitionSource: tier },
      });

      processedCount++;
    }

    return { processedCount };
  }
}

export const campaignService = new CampaignService();

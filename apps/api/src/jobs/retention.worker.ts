import crypto from "crypto";
import { prisma } from "../db/client.js";
import { outboxService } from "../modules/events/outbox.service.js";
import { UserRole } from "@daih/types";
import { CoinLedgerAction } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

export interface RetentionCleanupSummary {
  expiredPasswordResetTokens: number;
  expiredVerificationTokens: number;
  expiredMfaOtpTokens: number;
  expiredSessions: number;
}

export interface AnonymizationSummary {
  anonymizedUsersCount: number;
  anonymizedUserIds: string[];
}

export class RetentionService {
  /**
   * Cleans up expired tokens and stale auth sessions.
   * Runs daily in background.
   */
  async purgeExpiredTokens(): Promise<RetentionCleanupSummary> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 1. Password reset tokens older than 7 days
    const resetRes = await prisma.passwordResetToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: sevenDaysAgo } },
          { usedAt: { lt: sevenDaysAgo } },
        ],
      },
    });

    // 2. Verification tokens older than 30 days
    const verifyRes = await prisma.verificationToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: thirtyDaysAgo } },
          { usedAt: { lt: thirtyDaysAgo } },
        ],
      },
    });

    // 3. MFA OTP tokens older than 24 hours
    const mfaRes = await prisma.mfaOtpToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: oneDayAgo } }, { usedAt: { lt: oneDayAgo } }],
      },
    });

    // 4. Stale/revoked sessions older than 30 days
    const sessionRes = await prisma.authSession.deleteMany({
      where: {
        OR: [
          { isRevoked: true, updatedAt: { lt: thirtyDaysAgo } },
          { expiresAt: { lt: thirtyDaysAgo } },
        ],
      },
    });

    const summary: RetentionCleanupSummary = {
      expiredPasswordResetTokens: resetRes.count,
      expiredVerificationTokens: verifyRes.count,
      expiredMfaOtpTokens: mfaRes.count,
      expiredSessions: sessionRes.count,
    };

    return summary;
  }

  /**
   * Expire dormant coins for accounts inactive >= thresholdMonths.
   * Runs under coin_balances lock immediately before anonymization.
   */
  async expireInactiveCoins(
    cutoffDate: Date,
    options: { dryRun?: boolean } = {},
  ): Promise<{ expiredUsersCount: number; userIds: string[] }> {
    const now = new Date();
    const dryRun = options.dryRun ?? false;

    // Find users eligible for coin expiry with unified predicate guards
    const eligibleUsers = await prisma.user.findMany({
      where: {
        role: UserRole.CUSTOMER,
        skipAnonymization: false,
        createdAt: { lt: cutoffDate },
        sessions: {
          none: { lastUsedAt: { gte: cutoffDate } },
        },
        bookings: {
          none: {
            OR: [
              { createdAt: { gte: cutoffDate } },
              { endTime: { gt: now } },
              {
                state: {
                  in: [
                    "HELD",
                    "PENDING_PAYMENT",
                    "CONFIRMED",
                    "CHECKED_IN",
                    "ACTIVE",
                  ] as any,
                },
              },
            ],
          },
        },
        coinBalance: {
          balance: { gt: 0 },
        },
        coinHolds: {
          none: {
            status: "ACTIVE" as any,
          },
        },
        transactions: {
          none: {
            status: "PENDING" as any,
          },
        },
        refundRequestsRaised: {
          none: {
            status: {
              in: ["PENDING", "PROCESSING", "REQUIRES_RECONCILIATION"] as any,
            },
          },
        },
      },
      select: {
        id: true,
        clientId: true,
        coinBalance: { select: { balance: true } },
      },
      take: 100,
    });

    const expiredUserIds: string[] = [];

    for (const user of eligibleUsers) {
      const balance = user.coinBalance?.balance
        ? new Decimal(user.coinBalance.balance)
        : new Decimal(0);

      if (balance.lte(0)) continue;

      if (dryRun) {
        console.log(
          `[DRY-RUN] Would expire ${balance} coins for user ${user.clientId || user.id}`,
        );
        expiredUserIds.push(user.id);
        continue;
      }

      await prisma.$transaction(async (tx) => {
        // Lock coin balance
        const [balRow] = await tx.$queryRaw<Array<{ balance: Decimal }>>`
          SELECT balance FROM "coin_balances" WHERE "userId" = ${user.id} FOR UPDATE
        `;

        const curBal = balRow?.balance
          ? new Decimal(balRow.balance)
          : new Decimal(0);
        if (curBal.lte(0)) return;

        await tx.coinLedgerEntry.create({
          data: {
            userId: user.id,
            action: CoinLedgerAction.EXPIRY,
            amount: curBal.negated(),
            balanceAfter: new Decimal(0),
            referenceType: "AccountRetention",
            referenceId: user.id,
            idempotencyKey: `coin_expiry_${user.id}_${cutoffDate.toISOString().slice(0, 10)}`,
            metadata: {
              expiredAt: new Date().toISOString(),
              reason: "Dormant account inactivity expiry",
            },
          },
        });

        await tx.coinBalance.update({
          where: { userId: user.id },
          data: { balance: new Decimal(0) },
        });

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: "LOYALTY_COINS_EXPIRED",
            entityType: "User",
            entityId: user.id,
            metadata: {
              clientId: user.clientId,
              expiredAmount: curBal.toNumber(),
              cutoffDate: cutoffDate.toISOString(),
            },
          },
        });
      });

      expiredUserIds.push(user.id);
    }

    return {
      expiredUsersCount: expiredUserIds.length,
      userIds: expiredUserIds,
    };
  }

  /**
   * Anonymizes inactive customer accounts older than thresholdMonths (default 24 months).
   * Aligned with the Nigeria Data Protection Act (NDPA) 2023.
   *
   * Replaces personally identifiable info with unresolvable placeholders while
   * preserving financial records (Client ID, Bookings, Payments, Invoices) for statutory accounting.
   */
  async anonymizeInactiveCustomers(
    thresholdMonths = 24,
    options: { dryRun?: boolean } = {},
  ): Promise<AnonymizationSummary> {
    const dryRun = options.dryRun ?? false;
    const now = new Date();
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - thresholdMonths);

    // 1. Run coin expiry pass immediately prior to anonymization
    const expiryResult = await this.expireInactiveCoins(cutoffDate, { dryRun });

    // 2. Find CUSTOMER accounts with no activity since cutoffDate and unified predicate guards
    const inactiveCustomers = await prisma.user.findMany({
      where: {
        role: UserRole.CUSTOMER,
        skipAnonymization: false,
        createdAt: { lt: cutoffDate },
        // Not already anonymized
        email: { not: { endsWith: "@daih.anonymized" } },
        // No sessions used since cutoffDate
        sessions: {
          none: {
            lastUsedAt: { gte: cutoffDate },
          },
        },
        // No bookings created since cutoffDate, and no future or active bookings
        bookings: {
          none: {
            OR: [
              { createdAt: { gte: cutoffDate } },
              { endTime: { gt: now } },
              {
                state: {
                  in: [
                    "HELD",
                    "PENDING_PAYMENT",
                    "CONFIRMED",
                    "CHECKED_IN",
                    "ACTIVE",
                  ] as any,
                },
              },
            ],
          },
        },
        // No active coin holds
        coinHolds: {
          none: {
            status: "ACTIVE" as any,
          },
        },
        // No pending transactions
        transactions: {
          none: {
            status: "PENDING" as any,
          },
        },
        // No open refund requests or disputes
        refundRequestsRaised: {
          none: {
            status: {
              in: ["PENDING", "PROCESSING", "REQUIRES_RECONCILIATION"] as any,
            },
          },
        },
        // Unspent coin balance must be 0 (in dryRun mode, include users whose coins would be expired)
        OR: [
          { coinBalance: null },
          { coinBalance: { balance: { lte: 0 } } },
          ...(dryRun && expiryResult.userIds.length > 0
            ? [{ id: { in: expiryResult.userIds } }]
            : []),
        ],
      },
      select: {
        id: true,
        email: true,
        clientId: true,
      },
      take: 100, // Batch limit to prevent blocking
    });

    const anonymizedUserIds: string[] = [];

    for (const customer of inactiveCustomers) {
      if (dryRun) {
        console.log(
          `[DRY-RUN] Would anonymize customer ${customer.clientId || customer.id} (${customer.email})`,
        );
        anonymizedUserIds.push(customer.id);
        continue;
      }

      const anonHash = crypto
        .createHash("sha256")
        .update(customer.id)
        .digest("hex")
        .slice(0, 10);
      const anonymizedEmail = `anon_${anonHash}@daih.anonymized`;

      await prisma.$transaction(async (tx) => {
        // 1. Anonymize user record
        await tx.user.update({
          where: { id: customer.id },
          data: {
            firstName: "Anonymized",
            lastName: "Customer",
            email: anonymizedEmail,
            phoneNumber: null,
            passwordHash: null,
            avatarUrl: null,
            mfaSecret: null,
            mfaEnabled: false,
          },
        });

        // 2. Revoke and remove any old active session tokens
        await tx.authSession.deleteMany({
          where: { userId: customer.id },
        });

        // 3. Record in audit trail
        await tx.auditLog.create({
          data: {
            userId: customer.id,
            action: "USER_ANONYMIZED",
            entityType: "User",
            entityId: customer.id,
            metadata: {
              clientId: customer.clientId,
              retentionPolicyMonths: thresholdMonths,
              anonymizedAt: new Date().toISOString(),
            },
          },
        });

        // 4. Publish outbox event
        await outboxService.recordEvent(
          {
            eventType: "identity.user_anonymized",
            aggregateType: "User",
            aggregateId: customer.id,
            payload: {
              userId: customer.id,
              clientId: customer.clientId,
              anonymizedEmail,
            },
          },
          tx,
        );
      });

      anonymizedUserIds.push(customer.id);
    }

    return {
      anonymizedUsersCount: anonymizedUserIds.length,
      anonymizedUserIds,
    };
  }
}

export const retentionService = new RetentionService();

import {
  Prisma,
  RefundStatus,
  RefundReasonCode,
  UserRole,
  BookingState,
  CoinLedgerAction,
} from "@prisma/client";
import { prisma } from "../../db/client.js";
import { paystackClient } from "./paystack.client.js";
import { enqueueNotification } from "../notifications/notifications.queue.js";
import { outboxService } from "../events/outbox.service.js";
import { Decimal } from "@prisma/client/runtime/library";

export interface RaiseRefundRequestDTO {
  bookingId: string;
  reasonCode: RefundReasonCode;
  reason: string;
}

export interface RequestInfoDTO {
  question: string;
}

export interface ProvideInfoDTO {
  response: string;
}

export interface RejectRefundDTO {
  rejectionReason: string;
}

export class RefundService {
  /**
   * Operations Manager raises a dual-authorization refund request.
   * Enforces detailed justification (>= 20 chars) and checks existing requests.
   */
  async raiseRefundRequest(
    operatorUserId: string,
    dto: RaiseRefundRequestDTO,
  ): Promise<any> {
    const cleanReason = (dto.reason || "").trim();
    if (cleanReason.length < 20) {
      const error: any = new Error(
        "Refund request reason must be at least 20 characters describing the justification.",
      );
      error.code = "INVALID_REFUND_REASON";
      error.statusCode = 400;
      throw error;
    }

    // 1. Fetch booking with transactions and user
    const booking = await prisma.booking.findUnique({
      where: { id: dto.bookingId },
      include: {
        transactions: {
          where: { status: "SUCCESSFUL" },
        },
        user: true,
      },
    });

    if (!booking) {
      const error: any = new Error("Booking not found");
      error.code = "BOOKING_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    // 2. Check if an active refund request already exists for this booking
    const existing = await prisma.refundRequest.findFirst({
      where: {
        bookingId: dto.bookingId,
        status: {
          in: [
            RefundStatus.PENDING,
            RefundStatus.PROCESSING,
            RefundStatus.INFO_REQUESTED,
            RefundStatus.APPROVED,
            RefundStatus.PROCESSED,
          ],
        },
      },
    });

    if (existing) {
      const error: any = new Error(
        `A refund request for this booking is already ${existing.status.toLowerCase()}.`,
      );
      error.code = "REFUND_ALREADY_EXISTS";
      error.statusCode = 409;
      throw error;
    }

    // 3. Compute net settled fiat to refund
    const totalPaidFiat = booking.transactions.reduce(
      (sum, t) => sum.plus(new Decimal(t.amount)),
      new Decimal(0),
    );

    const primaryTransaction = booking.transactions[0];

    // 4. Calculate coin adjustments
    // (a) Customer redeemed coins to return (in PDC)
    const coinsToReverse = booking.coinsRedeemed
      ? new Decimal(booking.coinsRedeemed)
      : booking.redeemedCoins
        ? new Decimal(booking.redeemedCoins)
        : new Decimal(0);

    // (b) Customer earned coins to claw back
    const earnedEntry = await prisma.coinLedgerEntry.findFirst({
      where: {
        referenceId: booking.id,
        action: CoinLedgerAction.BOOKING_EARN,
      },
    });
    const coinsToClawback = earnedEntry
      ? new Decimal(earnedEntry.amount)
      : new Decimal(0);

    // (c) Referrer coins to claw back if this was referee's first booking
    let referralCoinsToClawback = new Decimal(0);
    let referrerId: string | null = null;
    if (booking.user.referredById) {
      const refEntry = await prisma.coinLedgerEntry.findFirst({
        where: {
          referenceId: booking.id,
          action: CoinLedgerAction.REFERRAL_BONUS,
        },
      });
      if (refEntry) {
        referralCoinsToClawback = new Decimal(refEntry.amount);
        referrerId = booking.user.referredById;
      }
    }

    // 5. Create or update RefundRequest
    const operator = await prisma.user.findUnique({
      where: { id: operatorUserId },
    });

    const existingRecord = await prisma.refundRequest.findFirst({
      where: { bookingId: dto.bookingId },
      orderBy: { createdAt: "desc" },
    });

    let refundRequest;
    if (existingRecord) {
      refundRequest = await prisma.refundRequest.update({
        where: { id: existingRecord.id },
        data: {
          transactionId: primaryTransaction?.id || null,
          amount: totalPaidFiat,
          coinsToReverse,
          coinsToClawback,
          referralCoinsToClawback,
          referrerId,
          reasonCode: dto.reasonCode,
          reason: cleanReason,
          status: RefundStatus.PENDING,
          isSystemInitiated: false,
          requestedByUserId: operatorUserId,
          reviewedByUserId: null,
          reviewedAt: null,
          rejectionReason: null,
          infoRequested: null,
          infoProvided: null,
        },
        include: {
          booking: true,
          requestedBy: true,
        },
      });
    } else {
      refundRequest = await prisma.refundRequest.create({
        data: {
          bookingId: dto.bookingId,
          transactionId: primaryTransaction?.id || null,
          amount: totalPaidFiat,
          coinsToReverse,
          coinsToClawback,
          referralCoinsToClawback,
          referrerId,
          reasonCode: dto.reasonCode,
          reason: cleanReason,
          status: RefundStatus.PENDING,
          isSystemInitiated: false,
          requestedByUserId: operatorUserId,
        },
        include: {
          booking: true,
          requestedBy: true,
        },
      });
    }

    // 6. Notify Finance Officers and Super Admins
    const financeOfficers = await prisma.user.findMany({
      where: {
        role: { in: [UserRole.FINANCE_OFFICER, UserRole.SUPER_ADMIN] },
        isVerified: true,
      },
      select: { id: true, email: true, firstName: true },
    });

    for (const fo of financeOfficers) {
      try {
        await enqueueNotification(
          "finance.refund_requested",
          fo.email,
          fo.firstName,
          {
            refundRequestId: refundRequest.id,
            bookingReference: booking.reference,
            amount: Number(totalPaidFiat),
            operatorName:
              `${operator?.firstName || "Operations"} ${operator?.lastName || ""}`.trim(),
            reason: cleanReason,
          },
        );
      } catch (err: any) {
        console.warn(
          "[RefundService] Failed to notify finance officer:",
          err?.message,
        );
      }
    }

    return refundRequest;
  }

  /**
   * Finance Officer requests more info / clarification from Operations.
   */
  async requestMoreInfo(
    financeOfficerUserId: string,
    refundRequestId: string,
    dto: RequestInfoDTO,
  ): Promise<any> {
    const refundRequest = await prisma.refundRequest.findUnique({
      where: { id: refundRequestId },
      include: { requestedBy: true, booking: true },
    });

    if (!refundRequest) {
      const error: any = new Error("Refund request not found");
      error.code = "REFUND_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    if (refundRequest.status !== RefundStatus.PENDING) {
      const error: any = new Error(
        `Cannot request info on refund request with status ${refundRequest.status}.`,
      );
      error.code = "INVALID_REFUND_STATUS";
      error.statusCode = 400;
      throw error;
    }

    const updated = await prisma.refundRequest.update({
      where: { id: refundRequestId },
      data: {
        status: RefundStatus.INFO_REQUESTED,
        infoRequested: dto.question.trim(),
        reviewedByUserId: financeOfficerUserId,
      },
      include: {
        booking: true,
        requestedBy: true,
      },
    });

    // Notify Operations Admin if available
    if (refundRequest.requestedBy?.email && refundRequest.booking) {
      try {
        await enqueueNotification(
          "operations.refund_info_requested",
          refundRequest.requestedBy.email,
          refundRequest.requestedBy.firstName || "Operations",
          {
            refundRequestId: updated.id,
            bookingReference: refundRequest.booking.reference,
            question: dto.question.trim(),
          },
        );
      } catch (err: any) {
        console.warn(
          "[RefundService] Failed to notify operations admin:",
          err?.message,
        );
      }
    }

    return updated;
  }

  /**
   * Operations Manager provides clarification requested by Finance.
   */
  async provideMoreInfo(
    operatorUserId: string,
    refundRequestId: string,
    dto: ProvideInfoDTO,
  ): Promise<any> {
    const refundRequest = await prisma.refundRequest.findUnique({
      where: { id: refundRequestId },
      include: { booking: true },
    });

    if (!refundRequest) {
      const error: any = new Error("Refund request not found");
      error.code = "REFUND_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    if (refundRequest.status !== RefundStatus.INFO_REQUESTED) {
      const error: any = new Error(
        `Refund request is not awaiting clarification (status: ${refundRequest.status}).`,
      );
      error.code = "INVALID_REFUND_STATUS";
      error.statusCode = 400;
      throw error;
    }

    const updated = await prisma.refundRequest.update({
      where: { id: refundRequestId },
      data: {
        status: RefundStatus.PENDING,
        infoProvided: dto.response.trim(),
      },
      include: {
        booking: true,
        requestedBy: true,
      },
    });

    // Notify Finance Officer
    if (refundRequest.reviewedByUserId) {
      const fo = await prisma.user.findUnique({
        where: { id: refundRequest.reviewedByUserId },
      });
      if (fo?.email) {
        try {
          await enqueueNotification(
            "finance.refund_info_provided",
            fo.email,
            fo.firstName,
            {
              refundRequestId: updated.id,
              bookingReference: refundRequest.booking?.reference || "N/A",
              response: dto.response.trim(),
            },
          );
        } catch (err: any) {
          console.warn(
            "[RefundService] Failed to notify finance officer:",
            err?.message,
          );
        }
      }
    }

    return updated;
  }

  /**
   * Finance Officer or Super Admin approves the refund request.
   * Executes 3-Stage Atomic Claim, Paystack gateway execution, and reason-code scoped finalization.
   */
  async approveRefund(
    financeOfficerUserId: string,
    refundRequestId: string,
    workerId: string = "manual-finance-officer",
  ): Promise<any> {
    return this.executeRefund(
      refundRequestId,
      financeOfficerUserId,
      workerId,
      false,
    );
  }

  /**
   * Background Worker or Sweeper executes system-initiated refund.
   */
  async processSystemRefund(
    refundRequestId: string,
    workerId: string = "system-refund-worker",
  ): Promise<any> {
    return this.executeRefund(
      refundRequestId,
      "SYSTEM_AUTO_REFUND",
      workerId,
      true,
    );
  }

  /**
   * Core 3-Stage Atomic Refund Execution
   */
  private async executeRefund(
    refundRequestId: string,
    approvingUserId: string,
    workerId: string,
    isSystem: boolean,
  ): Promise<any> {
    const refund = await prisma.refundRequest.findUnique({
      where: { id: refundRequestId },
      include: {
        booking: {
          include: {
            user: true,
          },
        },
        transaction: true,
      },
    });

    if (!refund) {
      const error: any = new Error("Refund request not found");
      error.code = "REFUND_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    // Segregation of duties for manual requests
    if (!isSystem && refund.requestedByUserId === approvingUserId) {
      const error: any = new Error(
        "Segregation of Duties Violation: You cannot approve a refund request that you initiated.",
      );
      error.code = "SELF_APPROVAL_PROHIBITED";
      error.statusCode = 403;
      throw error;
    }

    if (
      ![RefundStatus.PENDING, RefundStatus.INFO_REQUESTED].includes(
        refund.status as any,
      )
    ) {
      const error: any = new Error(
        `Cannot approve refund request with status ${refund.status}.`,
      );
      error.code = "INVALID_REFUND_STATUS";
      error.statusCode = 400;
      throw error;
    }

    // Stage 1: Atomic Claim with Global Lock Order
    await prisma.$transaction(
      async (tx) => {
        if (refund.transactionId) {
          // Lock transaction first (Step 1 in Lock Hierarchy)
          await tx.$queryRaw`
            SELECT id FROM "transactions" WHERE id = ${refund.transactionId} FOR UPDATE
          `;
        }

        // Lock & claim refund request: PENDING/INFO_REQUESTED -> PROCESSING
        const updatedCount = await tx.$executeRaw`
          UPDATE "refund_requests"
          SET status = 'PROCESSING', "claimedAt" = NOW(), "workerId" = ${workerId}
          WHERE id = ${refundRequestId} AND status IN ('PENDING', 'INFO_REQUESTED')
        `;

        if (updatedCount === 0) {
          const error: any = new Error("Concurrent refund in progress");
          error.code = "CONCURRENT_REFUND_IN_PROGRESS";
          error.statusCode = 409;
          throw error;
        }
      },
      { timeout: 15000, maxWait: 10000 },
    );

    // Stage 2: Gateway Execution
    await prisma.refundRequest.update({
      where: { id: refundRequestId },
      data: { gatewayRequestedAt: new Date() },
    });

    let paystackResult: any = null;
    const isZeroCash = !refund.transactionId;
    const isSystemRefund = (
      [
        RefundReasonCode.DUPLICATE_PAYMENT,
        RefundReasonCode.UNAVAILABLE_RESOURCE,
        RefundReasonCode.PRICE_CHANGED,
      ] as RefundReasonCode[]
    ).includes(refund.reasonCode);

    if (!isZeroCash) {
      const txRef =
        refund.transaction?.paystackReference ||
        refund.transaction?.reference ||
        refund.booking?.reference ||
        "";

      // Refund amount is strictly min(transaction.amount, booking.cashDue)
      let refundAmount = new Decimal(refund.amount);
      if (refund.transaction && refund.booking?.cashDue) {
        const txAmt = new Decimal(refund.transaction.amount);
        const cashDue = new Decimal(refund.booking.cashDue);
        refundAmount = Decimal.min(txAmt, cashDue);
      }
      const amountKobo = Math.round(Number(refundAmount) * 100);

      try {
        paystackResult = await paystackClient.createRefund({
          transaction: txRef,
          amount: amountKobo,
          merchantNote: `Refund: ${refund.reason}`,
          customerNote: "Refund for your booking at DAIH Hub",
        });
      } catch (err: any) {
        const errMsg = err?.message || "Gateway error";
        const isAlreadyRefunded =
          errMsg.toLowerCase().includes("already refunded") ||
          errMsg.toLowerCase().includes("already_refunded");

        if (isAlreadyRefunded) {
          paystackResult = {
            data: { id: "ALREADY_REFUNDED", refund_reference: txRef },
          };
        } else if (err?.statusCode >= 400 && err?.statusCode < 500) {
          await prisma.refundRequest.update({
            where: { id: refundRequestId },
            data: {
              status: RefundStatus.FAILED,
              failureReason: errMsg,
              lastError: errMsg,
              reviewedByUserId: approvingUserId,
              reviewedAt: new Date(),
            },
          });
          const error: any = new Error(
            `Paystack Gateway Refund Failed: ${errMsg}`,
          );
          error.code = "GATEWAY_REFUND_FAILED";
          error.statusCode = 502;
          throw error;
        } else {
          await prisma.refundRequest.update({
            where: { id: refundRequestId },
            data: {
              status: RefundStatus.REQUIRES_RECONCILIATION,
              lastError: errMsg,
              failureReason: errMsg,
            },
          });
          const error: any = new Error(
            `Paystack Gateway Refund Network Error: ${errMsg}`,
          );
          error.code = "GATEWAY_TIMEOUT";
          error.statusCode = 504;
          throw error;
        }
      }
    }

    // Stage 3: Scoped Refund Finalization inside Atomic Database Transaction
    const approved = await prisma.$transaction(
      async (tx) => {
        // (a) Update RefundRequest to PROCESSED
        const processedRequest = await tx.refundRequest.update({
          where: { id: refundRequestId },
          data: {
            status: RefundStatus.PROCESSED,
            reviewedByUserId: isSystem ? null : approvingUserId,
            reviewedAt: new Date(),
            paystackRefundId: String(paystackResult?.data?.id || ""),
            gatewayReference: paystackResult?.data?.refund_reference || null,
          },
          include: {
            booking: { include: { user: true } },
            requestedBy: true,
            reviewedBy: true,
          },
        });

        // (b) Update transaction status
        if (refund.transactionId) {
          await tx.transaction.update({
            where: { id: refund.transactionId },
            data: {
              status: "REFUNDED",
              refundedAt: new Date(),
              refundAmount: refund.amount,
              refundedBy: approvingUserId,
            },
          });
        }

        // (c) Scoped Finalization by Reason Code
        if (isSystemRefund) {
          // DUPLICATE_PAYMENT, UNAVAILABLE_RESOURCE, PRICE_CHANGED:
          // Return money via gateway only. Do NOT cancel booking or claw back coins.
        } else {
          // Standard customer refund:
          if (refund.bookingId) {
            await tx.booking.update({
              where: { id: refund.bookingId },
              data: { state: BookingState.REFUNDED },
            });

            // Asynchronous Coin Re-Credit via Outbox with P2002 idempotency
            if (Number(refund.coinsToReverse) > 0) {
              await outboxService.recordEvent(
                {
                  eventType: "loyalty.redemption_reversal",
                  aggregateType: "Booking",
                  aggregateId: refund.bookingId,
                  payload: {
                    bookingId: refund.bookingId,
                    coinsToReverse: Number(refund.coinsToReverse),
                    idempotencyKey: `redemption_reversal_${refund.bookingId}`,
                  },
                },
                tx,
              );
            }

            // Schedule clawback of earned coins
            if (Number(refund.coinsToClawback) > 0) {
              await outboxService.recordEvent(
                {
                  eventType: "loyalty.clawback_earned",
                  aggregateType: "Booking",
                  aggregateId: refund.bookingId,
                  payload: {
                    bookingId: refund.bookingId,
                    coinsToClawback: Number(refund.coinsToClawback),
                    idempotencyKey: `clawback_customer_${refund.bookingId}`,
                  },
                },
                tx,
              );
            }

            // Schedule clawback of referral bonus
            if (
              refund.referrerId &&
              Number(refund.referralCoinsToClawback) > 0
            ) {
              await outboxService.recordEvent(
                {
                  eventType: "loyalty.clawback_referral",
                  aggregateType: "Booking",
                  aggregateId: refund.bookingId,
                  payload: {
                    bookingId: refund.bookingId,
                    referrerId: refund.referrerId,
                    coinsToClawback: Number(refund.referralCoinsToClawback),
                    idempotencyKey: `coin:clawback:referral:${refund.bookingId}`,
                  },
                },
                tx,
              );
            }
          }
        }

        // (d) Record Outbox event
        await outboxService.recordEvent(
          {
            eventType: "refund.processed",
            aggregateType: "RefundRequest",
            aggregateId: refundRequestId,
            payload: {
              refundRequestId: processedRequest.id,
              bookingId: refund.bookingId,
              amount: Number(refund.amount),
              isSystemRefund,
              approvedByUserId: approvingUserId,
            },
          },
          tx,
        );

        return processedRequest;
      },
      { timeout: 20000, maxWait: 15000 },
    );

    // Notify Customer if booking and user exist
    if (refund.booking?.user?.email) {
      try {
        await enqueueNotification(
          "customer.refund_processed",
          refund.booking.user.email,
          refund.booking.user.firstName || "Customer",
          {
            bookingReference: refund.booking.reference,
            amount: Number(refund.amount),
            coinsToReverse: Number(refund.coinsToReverse),
          },
        );
      } catch (err: any) {
        console.warn(
          "[RefundService] Failed to notify customer:",
          err?.message,
        );
      }
    }

    return approved;
  }

  /**
   * Finance Officer rejects a refund request with justification.
   */
  async rejectRefund(
    financeOfficerUserId: string,
    refundRequestId: string,
    dto: RejectRefundDTO,
  ): Promise<any> {
    const refundRequest = await prisma.refundRequest.findUnique({
      where: { id: refundRequestId },
      include: { booking: true, requestedBy: true },
    });

    if (!refundRequest) {
      const error: any = new Error("Refund request not found");
      error.code = "REFUND_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    if (
      ![RefundStatus.PENDING, RefundStatus.INFO_REQUESTED].includes(
        refundRequest.status as any,
      )
    ) {
      const error: any = new Error(
        `Cannot reject refund request with status ${refundRequest.status}.`,
      );
      error.code = "INVALID_REFUND_STATUS";
      error.statusCode = 400;
      throw error;
    }

    const cleanRejection = (dto.rejectionReason || "").trim();
    if (!cleanRejection) {
      const error: any = new Error("Rejection reason is required.");
      error.code = "REJECTION_REASON_REQUIRED";
      error.statusCode = 400;
      throw error;
    }

    const updated = await prisma.refundRequest.update({
      where: { id: refundRequestId },
      data: {
        status: RefundStatus.REJECTED,
        rejectionReason: cleanRejection,
        reviewedByUserId: financeOfficerUserId,
        reviewedAt: new Date(),
      },
      include: {
        booking: true,
        requestedBy: true,
        reviewedBy: true,
      },
    });

    // Notify Operations Admin if available
    if (refundRequest.requestedBy?.email && refundRequest.booking) {
      try {
        await enqueueNotification(
          "operations.refund_rejected",
          refundRequest.requestedBy.email,
          refundRequest.requestedBy.firstName || "Operations",
          {
            refundRequestId: updated.id,
            bookingReference: refundRequest.booking.reference,
            rejectionReason: cleanRejection,
          },
        );
      } catch (err: any) {
        console.warn(
          "[RefundService] Failed to notify operations admin:",
          err?.message,
        );
      }
    }

    return updated;
  }

  /**
   * Lists refund requests with optional status filter and pagination.
   */
  async listRefundRequests(filters: {
    status?: RefundStatus;
    page?: number;
    limit?: number;
  }): Promise<{
    items: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.RefundRequestWhereInput = {
      ...(filters.status && { status: filters.status }),
    };

    const [items, total] = await Promise.all([
      prisma.refundRequest.findMany({
        where,
        include: {
          booking: {
            select: {
              id: true,
              reference: true,
              state: true,
              totalAmount: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          requestedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
          reviewedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: { requestedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.refundRequest.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Gets details of a single refund request by ID.
   */
  async getRefundRequest(refundRequestId: string): Promise<any> {
    const request = await prisma.refundRequest.findUnique({
      where: { id: refundRequestId },
      include: {
        booking: {
          include: {
            transactions: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        requestedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
        reviewedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!request) {
      const error: any = new Error("Refund request not found");
      error.code = "REFUND_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    return request;
  }
}

export const refundService = new RefundService();

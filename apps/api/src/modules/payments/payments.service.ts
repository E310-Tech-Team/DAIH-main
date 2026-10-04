import { prisma } from "../../db/client.js";
import { Prisma } from "@prisma/client";
import {
  paymentsRepository,
  PaymentsRepository,
} from "./payments.repository.js";
import { paystackClient, PaystackClient } from "./paystack.client.js";
import { invoiceService, InvoiceService } from "./invoice.service.js";
import { outboxService } from "../events/outbox.service.js";
import { bookingRepository } from "../booking/booking.repository.js";
import {
  scheduleHoldExpiry,
  cancelHoldExpiryJob,
} from "../../jobs/hold-expiry.job.js";
import {
  assertValidTransition,
  ACTIVE_BOOKING_STATES,
} from "../booking/booking.state-machine.js";
import { discountService } from "../discounts/discount.service.js";
import { loyaltyService } from "../loyalty/loyalty.service.js";
import { generateSignedQrToken } from "../access/qr-token.util.js";
import { Decimal } from "@prisma/client/runtime/library";
import {
  HoldStatus,
  CoinLedgerAction,
  RefundReasonCode,
  RefundStatus,
} from "@prisma/client";
import {
  BookingState,
  PaymentStatus,
  PaymentMethod,
  PaymentTransaction,
  PaystackWebhookPayload,
  ReconciliationSummary,
  ReconciliationDiscrepancy,
  DailyPaymentSummary,
} from "@daih/types";

export class PaymentsService {
  constructor(
    private repo: PaymentsRepository = paymentsRepository,
    private paystack: PaystackClient = paystackClient,
    private invoices: InvoiceService = invoiceService,
  ) {}

  /**
   * Formats transaction entity into clean API DTO
   */
  private formatTransaction(tx: any): PaymentTransaction {
    if (!tx) return tx;

    return {
      id: tx.id,
      reference: tx.reference,
      bookingId: tx.bookingId,
      userId: tx.userId,
      amount: Number(tx.amount),
      currency: tx.currency,
      status: tx.status as any,
      method: tx.method as any,
      paystackReference: tx.paystackReference || null,
      paystackChannel: tx.paystackChannel || null,
      gatewayResponse: tx.gatewayResponse || null,
      webhookEventId: tx.webhookEventId || null,
      webhookReceivedAt: tx.webhookReceivedAt
        ? tx.webhookReceivedAt instanceof Date
          ? tx.webhookReceivedAt.toISOString()
          : tx.webhookReceivedAt
        : null,
      paidAt: tx.paidAt
        ? tx.paidAt instanceof Date
          ? tx.paidAt.toISOString()
          : tx.paidAt
        : null,
      failedAt: tx.failedAt
        ? tx.failedAt instanceof Date
          ? tx.failedAt.toISOString()
          : tx.failedAt
        : null,
      refundedAt: tx.refundedAt
        ? tx.refundedAt instanceof Date
          ? tx.refundedAt.toISOString()
          : tx.refundedAt
        : null,
      refundAmount: tx.refundAmount ? Number(tx.refundAmount) : null,
      refundReason: tx.refundReason || null,
      refundedBy: tx.refundedBy || null,
      createdAt:
        tx.createdAt instanceof Date
          ? tx.createdAt.toISOString()
          : tx.createdAt,
      updatedAt:
        tx.updatedAt instanceof Date
          ? tx.updatedAt.toISOString()
          : tx.updatedAt,
      booking: tx.booking
        ? {
            id: tx.booking.id,
            reference: tx.booking.reference,
            resourceName: tx.booking.resource?.name || "Workspace",
            startTime:
              tx.booking.startTime instanceof Date
                ? tx.booking.startTime.toISOString()
                : tx.booking.startTime,
            endTime:
              tx.booking.endTime instanceof Date
                ? tx.booking.endTime.toISOString()
                : tx.booking.endTime,
            state: tx.booking.state,
          }
        : undefined,
      invoice: tx.invoice
        ? {
            id: tx.invoice.id,
            invoiceNumber: tx.invoice.invoiceNumber,
            transactionId: tx.invoice.transactionId,
            bookingId: tx.invoice.bookingId,
            userId: tx.invoice.userId,
            subtotal: Number(tx.invoice.subtotal),
            tax: Number(tx.invoice.tax),
            total: Number(tx.invoice.total),
            currency: tx.invoice.currency,
            lineItems: Array.isArray(tx.invoice.lineItems)
              ? tx.invoice.lineItems
              : [],
            issuedAt:
              tx.invoice.issuedAt instanceof Date
                ? tx.invoice.issuedAt.toISOString()
                : tx.invoice.issuedAt,
            customerName: tx.invoice.customerName,
            customerEmail: tx.invoice.customerEmail,
            customerClientId: tx.invoice.customerClientId,
            resourceName: tx.invoice.resourceName,
            bookingReference: tx.invoice.bookingReference,
            createdAt:
              tx.invoice.createdAt instanceof Date
                ? tx.invoice.createdAt.toISOString()
                : tx.invoice.createdAt,
          }
        : null,
    };
  }

  /**
   * Initiates payment for an active booking hold with in-flight race protection and cashDue price locking
   */
  async initializePayment(
    bookingId: string,
    userId: string,
    callbackUrl?: string,
  ) {
    const initResult = await prisma.$transaction(
      async (tx) => {
        // Serialized booking lock
        const [booking] = await tx.$queryRaw<
          Array<{
            id: string;
            reference: string;
            userId: string;
            state: BookingState;
            holdExpiresAt: Date | null;
            cashDue: Prisma.Decimal;
            totalAmount: Prisma.Decimal;
            currency: string;
          }>
        >`SELECT id, reference, "userId", state, "holdExpiresAt", "cashDue", "totalAmount", currency FROM "bookings" WHERE id = ${bookingId} FOR UPDATE`;

        if (!booking) {
          const err: any = new Error(`Booking '${bookingId}' not found`);
          err.statusCode = 404;
          err.code = "BOOKING_NOT_FOUND";
          throw err;
        }

        if (booking.userId !== userId) {
          const err: any = new Error(
            "You are not authorized to pay for this booking",
          );
          err.statusCode = 403;
          err.code = "FORBIDDEN";
          throw err;
        }

        if (
          booking.state !== BookingState.HELD &&
          booking.state !== BookingState.PENDING_PAYMENT
        ) {
          const err: any = new Error(
            `Cannot pay for booking in state '${booking.state}'`,
          );
          err.statusCode = 400;
          err.code = "INVALID_BOOKING_STATE";
          throw err;
        }

        const cashDueDecimal = new Prisma.Decimal(booking.cashDue);
        if (cashDueDecimal.isZero() || cashDueDecimal.isNegative()) {
          const err: any = new Error(
            "Booking is fully covered by coins or discounts and does not require cash payment.",
          );
          err.statusCode = 400;
          err.code = "ZERO_CASH_DUE";
          throw err;
        }

        // Check if booking has already been paid and confirmed
        const successfulTx = await tx.transaction.findFirst({
          where: {
            bookingId: booking.id,
            status: PaymentStatus.SUCCESSFUL,
          },
        });
        if (successfulTx) {
          const err: any = new Error(
            `This booking has already been paid and confirmed (Reference: ${successfulTx.reference}).`,
          );
          err.statusCode = 400;
          err.code = "BOOKING_ALREADY_PAID";
          throw err;
        }

        // Check existing PENDING transaction for in-flight or re-usable checkout session
        const existingPendingTx = await tx.transaction.findFirst({
          where: {
            bookingId: booking.id,
            status: PaymentStatus.PENDING,
          },
          orderBy: { createdAt: "desc" },
        });

        if (existingPendingTx) {
          const ageMs =
            Date.now() - new Date(existingPendingTx.createdAt).getTime();
          const authUrl = (existingPendingTx.gatewayResponse as any)
            ?.authorization_url;

          // In-flight check (< 30s) where authorization URL is not yet populated
          if (!authUrl && ageMs < 30 * 1000) {
            return { inFlight: true, transactionId: existingPendingTx.id };
          }

          // Valid existing session (< 15 mins) with matching cashDue
          const isUnder15Mins = ageMs < 15 * 60 * 1000;
          if (
            authUrl &&
            isUnder15Mins &&
            new Prisma.Decimal(existingPendingTx.amount).equals(cashDueDecimal)
          ) {
            return {
              existing: true,
              authorization_url: authUrl,
              access_code: (existingPendingTx.gatewayResponse as any)
                ?.access_code,
              reference: existingPendingTx.reference,
              transactionId: existingPendingTx.id,
              amount: Number(existingPendingTx.amount),
              currency: existingPendingTx.currency,
            };
          }

          // Otherwise mark stale pending transaction as ABANDONED
          await tx.transaction.update({
            where: { id: existingPendingTx.id },
            data: { status: PaymentStatus.ABANDONED },
          });
        }

        // Extend hold by 15 minutes for payment session
        const newHoldExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            state: BookingState.PENDING_PAYMENT,
            holdExpiresAt: newHoldExpiresAt,
          },
        });

        const datePart = new Date()
          .toISOString()
          .slice(0, 10)
          .replace(/-/g, "");
        const randomSuffix = Math.floor(10000 + Math.random() * 90000);
        const reference = `DAIH-PAY-${datePart}-${randomSuffix}`;
        const amount = Number(cashDueDecimal);

        // Explicitly create and commit Transaction row with amount = booking.cashDue
        const createdTx = await tx.transaction.create({
          data: {
            reference,
            bookingId: booking.id,
            userId,
            amount: cashDueDecimal,
            currency: booking.currency || "NGN",
            status: PaymentStatus.PENDING,
            method: PaymentMethod.PAYSTACK,
            paystackReference: reference,
          },
        });

        await outboxService.recordEvent(
          {
            eventType: "payment.initialized",
            aggregateType: "Transaction",
            aggregateId: createdTx.id,
            payload: {
              transactionId: createdTx.id,
              reference,
              bookingId: booking.id,
              userId,
              amount,
              currency: booking.currency,
            },
          },
          tx,
        );

        return {
          created: true,
          transaction: createdTx,
          booking,
          amount,
          reference,
        };
      },
      { timeout: 20000, maxWait: 15000 },
    );

    if ("existing" in initResult && initResult.existing) {
      return initResult;
    }

    if ("inFlight" in initResult && initResult.inFlight) {
      // Poll briefly (3 attempts, 200ms intervals) for authorizationUrl
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const checkTx = await prisma.transaction.findUnique({
          where: { id: (initResult as any).transactionId },
        });
        const authUrl = (checkTx?.gatewayResponse as any)?.authorization_url;
        if (authUrl) {
          return {
            authorization_url: authUrl,
            access_code: (checkTx?.gatewayResponse as any)?.access_code,
            reference: checkTx!.reference,
            transactionId: checkTx!.id,
            amount: Number(checkTx!.amount),
            currency: checkTx!.currency,
          };
        }
      }
      const err: any = new Error(
        "Payment initialization is currently processing. Please retry in a few moments.",
      );
      err.statusCode = 409;
      err.code = "RETRY_LATER";
      throw err;
    }

    const { transaction, booking, amount, reference } = initResult as any;

    // Reschedule hold expiry job
    await scheduleHoldExpiry(booking.id, 15 * 60 * 1000);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    const amountInKobo = Math.round(amount * 100);

    // Call Paystack gateway decoupled outside DB transaction
    try {
      const paystackRes = await this.paystack.initializeTransaction({
        email: user?.email || "customer@daih.ng",
        amount: amountInKobo,
        reference,
        callbackUrl,
        metadata: {
          bookingId: booking.id,
          bookingReference: booking.reference,
          userId,
          transactionId: transaction.id,
        },
      });

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          paystackReference: paystackRes.reference,
          gatewayResponse: {
            authorization_url: paystackRes.authorization_url,
            access_code: paystackRes.access_code,
          },
        },
      });

      return {
        authorization_url: paystackRes.authorization_url,
        access_code: paystackRes.access_code,
        reference: paystackRes.reference,
        transactionId: transaction.id,
        amount,
        currency: booking.currency,
      };
    } catch (gatewayErr: any) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: PaymentStatus.FAILED,
          failedAt: new Date(),
          gatewayResponse: { error: gatewayErr?.message || "Gateway error" },
        },
      });
      const err: any = new Error(
        `Payment Gateway Error: ${gatewayErr?.message}`,
      );
      err.statusCode = 502;
      err.code = "PAYMENT_GATEWAY_ERROR";
      throw err;
    }
  }

  /**
   * Authoritative Payment Reconciler with Strict State Machine Precedence
   */
  async reconcilePaymentTransaction(
    transactionId: string,
    gatewayPayload?: any,
    eventId?: string,
  ): Promise<{
    status: PaymentStatus;
    confirmed: boolean;
    reference: string;
    message: string;
  }> {
    return prisma.$transaction(
      async (tx) => {
        // 1. Transaction Lock (Hierarchical Lock Order: Step 1 = Transaction)
        const [txRecord] = await tx.$queryRaw<
          Array<{
            id: string;
            reference: string;
            bookingId: string;
            userId: string;
            amount: Prisma.Decimal;
            currency: string;
            status: PaymentStatus;
            paystackReference: string | null;
          }>
        >`SELECT id, reference, "bookingId", "userId", amount, currency, status, "paystackReference" FROM "transactions" WHERE id = ${transactionId} FOR UPDATE`;

        if (!txRecord) {
          const err: any = new Error(
            `Transaction '${transactionId}' not found`,
          );
          err.statusCode = 404;
          err.code = "TRANSACTION_NOT_FOUND";
          throw err;
        }

        // Terminal status idempotent no-op
        const terminalStatuses: PaymentStatus[] = [
          PaymentStatus.SUCCESSFUL,
          PaymentStatus.REFUNDED,
          PaymentStatus.PARTIALLY_REFUNDED,
          PaymentStatus.FLAGGED_MISMATCH,
          PaymentStatus.REQUIRES_RECONCILIATION,
          PaymentStatus.FAILED,
        ];
        if (terminalStatuses.includes(txRecord.status)) {
          return {
            status: txRecord.status,
            confirmed: txRecord.status === PaymentStatus.SUCCESSFUL,
            reference: txRecord.reference,
            message: `Transaction already in terminal state: ${txRecord.status}`,
          };
        }

        // Validate gateway payload if supplied
        if (gatewayPayload) {
          const isSuccess =
            gatewayPayload.status === "success" ||
            gatewayPayload.event === "charge.success";
          if (!isSuccess) {
            await tx.transaction.update({
              where: { id: txRecord.id },
              data: {
                status: PaymentStatus.FAILED,
                failedAt: new Date(),
                gatewayResponse: gatewayPayload,
              },
            });
            await tx.auditLog.create({
              data: {
                userId: txRecord.userId,
                action: "PAYMENT_FAILED",
                entityType: "Transaction",
                entityId: txRecord.id,
                metadata: {
                  reference: txRecord.reference,
                  gatewayStatus: gatewayPayload.status,
                },
              },
            });
            await outboxService.recordEvent(
              {
                eventType: "payment.failed",
                aggregateType: "Transaction",
                aggregateId: txRecord.id,
                payload: {
                  transactionId: txRecord.id,
                  bookingId: txRecord.bookingId,
                  reference: txRecord.reference,
                },
              },
              tx,
            );
            return {
              status: PaymentStatus.FAILED,
              confirmed: false,
              reference: txRecord.reference,
              message: "Payment failed on gateway",
            };
          }
        }

        // 2. Fetch Booking Under Lock (Hierarchical Lock Order: Step 2 = Booking)
        const [booking] = await tx.$queryRaw<
          Array<{
            id: string;
            reference: string;
            resourceId: string;
            userId: string;
            totalAmount: Prisma.Decimal;
            coinsRedeemed: Prisma.Decimal;
            coinTenderAmount: Prisma.Decimal;
            cashDue: Prisma.Decimal;
            state: BookingState;
            holdExpiresAt: Date | null;
            startTime: Date;
            endTime: Date;
            currency: string;
            quantity: number;
          }>
        >`SELECT id, reference, "resourceId", "userId", "totalAmount", "coinsRedeemed", "coinTenderAmount", "cashDue", state, "holdExpiresAt", "startTime", "endTime", currency, quantity FROM "bookings" WHERE id = ${txRecord.bookingId} FOR UPDATE`;

        if (!booking) {
          await tx.transaction.update({
            where: { id: txRecord.id },
            data: { status: PaymentStatus.REQUIRES_RECONCILIATION },
          });
          return {
            status: PaymentStatus.REQUIRES_RECONCILIATION,
            confirmed: false,
            reference: txRecord.reference,
            message: "Booking record missing",
          };
        }

        // Helper to spawn system refund safely
        const spawnSystemRefund = async (
          reasonCode: RefundReasonCode,
          reasonText: string,
        ) => {
          try {
            await tx.refundRequest.create({
              data: {
                bookingId: booking.id,
                transactionId: txRecord.id,
                amount: txRecord.amount,
                reasonCode,
                reason: reasonText,
                status: RefundStatus.PENDING,
                isSystemInitiated: true,
                requestedByUserId: null,
              },
            });
          } catch (e: any) {
            if (e.code !== "P2002") throw e;
          }
        };

        // STEP 1: Booking State Machine Evaluation (Executed BEFORE Price Guard)
        // Case A: Explicitly Cancelled or Refunded
        if (
          booking.state === BookingState.CANCELLED ||
          booking.state === BookingState.REFUNDED
        ) {
          await tx.transaction.update({
            where: { id: txRecord.id },
            data: { status: PaymentStatus.REQUIRES_RECONCILIATION },
          });
          await spawnSystemRefund(
            RefundReasonCode.UNAVAILABLE_RESOURCE,
            `Booking was in terminal state '${booking.state}' when payment arrived`,
          );
          await tx.auditLog.create({
            data: {
              userId: booking.userId,
              action: "PAYMENT_REQUIRES_RECONCILIATION",
              entityType: "Transaction",
              entityId: txRecord.id,
              metadata: {
                bookingId: booking.id,
                reason: `Booking state '${booking.state}' cannot be revived. System refund initiated.`,
              },
            },
          });
          await outboxService.recordEvent(
            {
              eventType: "admin.payment_flagged",
              aggregateType: "Transaction",
              aggregateId: txRecord.id,
              payload: {
                transactionId: txRecord.id,
                bookingId: booking.id,
                reasonCode: "UNAVAILABLE_RESOURCE",
                bookingState: booking.state,
              },
            },
            tx,
          );
          return {
            status: PaymentStatus.REQUIRES_RECONCILIATION,
            confirmed: false,
            reference: txRecord.reference,
            message: "Booking was cancelled/refunded; system refund initiated",
          };
        }

        // Case B: Already Confirmed
        if (
          booking.state === BookingState.CONFIRMED ||
          booking.state === BookingState.CHECKED_IN ||
          booking.state === BookingState.COMPLETED
        ) {
          await tx.transaction.update({
            where: { id: txRecord.id },
            data: { status: PaymentStatus.REQUIRES_RECONCILIATION },
          });
          await spawnSystemRefund(
            RefundReasonCode.DUPLICATE_PAYMENT,
            "Payment received for already-confirmed booking",
          );
          await tx.auditLog.create({
            data: {
              userId: booking.userId,
              action: "PAYMENT_DUPLICATE_FLAGGED",
              entityType: "Transaction",
              entityId: txRecord.id,
              metadata: {
                bookingId: booking.id,
                reason:
                  "Duplicate payment for confirmed booking. System refund initiated.",
              },
            },
          });
          await outboxService.recordEvent(
            {
              eventType: "admin.payment_flagged",
              aggregateType: "Transaction",
              aggregateId: txRecord.id,
              payload: {
                transactionId: txRecord.id,
                bookingId: booking.id,
                reasonCode: "DUPLICATE_PAYMENT",
              },
            },
            tx,
          );
          return {
            status: PaymentStatus.REQUIRES_RECONCILIATION,
            confirmed: false,
            reference: txRecord.reference,
            message:
              "Booking already confirmed; duplicate payment refund initiated",
          };
        }

        // STEP 2: Slot Time Validity Guard
        const now = new Date();
        if (new Date(booking.endTime).getTime() <= now.getTime()) {
          await tx.transaction.update({
            where: { id: txRecord.id },
            data: { status: PaymentStatus.REQUIRES_RECONCILIATION },
          });
          await spawnSystemRefund(
            RefundReasonCode.UNAVAILABLE_RESOURCE,
            "Booking end time has already elapsed in real world",
          );
          await tx.auditLog.create({
            data: {
              userId: booking.userId,
              action: "PAYMENT_SLOT_ELAPSED",
              entityType: "Transaction",
              entityId: txRecord.id,
              metadata: {
                bookingId: booking.id,
                endTime: booking.endTime,
                reason: "Booking slot already ended. System refund initiated.",
              },
            },
          });
          await outboxService.recordEvent(
            {
              eventType: "admin.payment_flagged",
              aggregateType: "Transaction",
              aggregateId: txRecord.id,
              payload: {
                transactionId: txRecord.id,
                bookingId: booking.id,
                reasonCode: "UNAVAILABLE_RESOURCE",
                reason: "SLOT_ELAPSED",
              },
            },
            tx,
          );
          return {
            status: PaymentStatus.REQUIRES_RECONCILIATION,
            confirmed: false,
            reference: txRecord.reference,
            message: "Booking slot time has passed; system refund initiated",
          };
        }

        // STEP 3: Price Guard Against booking.cashDue (Evaluated on pending bookings)
        const bookingCashDue = new Prisma.Decimal(booking.cashDue);
        const txAmount = new Prisma.Decimal(txRecord.amount);
        if (!txAmount.equals(bookingCashDue)) {
          await tx.transaction.update({
            where: { id: txRecord.id },
            data: { status: PaymentStatus.FLAGGED_MISMATCH },
          });
          await spawnSystemRefund(
            RefundReasonCode.PRICE_CHANGED,
            `Price mismatch: Transaction amount ${txAmount} does not equal cashDue ${bookingCashDue}`,
          );
          await tx.auditLog.create({
            data: {
              userId: booking.userId,
              action: "PAYMENT_PRICE_MISMATCH",
              entityType: "Transaction",
              entityId: txRecord.id,
              metadata: {
                bookingId: booking.id,
                txAmount: txAmount.toNumber(),
                bookingCashDue: bookingCashDue.toNumber(),
              },
            },
          });
          await outboxService.recordEvent(
            {
              eventType: "admin.payment_flagged",
              aggregateType: "Transaction",
              aggregateId: txRecord.id,
              payload: {
                transactionId: txRecord.id,
                bookingId: booking.id,
                reasonCode: "PRICE_CHANGED",
                txAmount: txAmount.toNumber(),
                cashDue: bookingCashDue.toNumber(),
              },
            },
            tx,
          );
          return {
            status: PaymentStatus.FLAGGED_MISMATCH,
            confirmed: false,
            reference: txRecord.reference,
            message: "Price mismatch detected; refund initiated",
          };
        }

        // STEP 4: Process Live vs. Expired Booking Confirmation
        const isHoldLive =
          [BookingState.HELD, BookingState.PENDING_PAYMENT].includes(
            booking.state as any,
          ) &&
          booking.holdExpiresAt !== null &&
          new Date(booking.holdExpiresAt).getTime() >= now.getTime();

        const user = await tx.user.findUnique({
          where: { id: booking.userId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            clientId: true,
          },
        });
        const resource = await tx.facilityResource.findUnique({
          where: { id: booking.resourceId },
          select: { id: true, name: true, capacity: true },
        });

        const customerName =
          `${user?.firstName || ""} ${user?.lastName || ""}`.trim() ||
          "Valued Customer";

        if (isHoldLive) {
          // CASE C: Live Active Hold
          // Capacity and coins were already reserved.
          if (new Prisma.Decimal(booking.coinsRedeemed).gt(0)) {
            // Lock coin_holds -> coin_balances
            await tx.$queryRaw`
              SELECT id FROM "coin_holds" WHERE "bookingId" = ${booking.id} FOR UPDATE
            `;
            const [balanceRow] = await tx.$queryRaw<
              Array<{ balance: Prisma.Decimal }>
            >`
              SELECT balance FROM "coin_balances" WHERE "userId" = ${booking.userId} FOR UPDATE
            `;

            // Transition coin_holds row to BURNED
            await tx.coinHold.updateMany({
              where: { bookingId: booking.id },
              data: { status: HoldStatus.BURNED },
            });

            // Record CoinLedgerEntry
            const burnAmount = new Prisma.Decimal(booking.coinsRedeemed);
            const currentBal = new Prisma.Decimal(balanceRow?.balance || 0);
            const newBal = currentBal.sub(burnAmount);

            try {
              await tx.coinLedgerEntry.create({
                data: {
                  userId: booking.userId,
                  action: CoinLedgerAction.HOLD_BURNED,
                  amount: burnAmount.negated(),
                  balanceAfter: newBal,
                  referenceType: "Booking",
                  referenceId: booking.id,
                  idempotencyKey: `burn_booking_${booking.id}`,
                  metadata: {
                    bookingId: booking.id,
                    transactionId: txRecord.id,
                  },
                },
              });
              await tx.coinBalance.update({
                where: { userId: booking.userId },
                data: {
                  balance: newBal,
                  lifetimeBurned: { increment: burnAmount },
                },
              });
            } catch (e: any) {
              if (e.code !== "P2002") throw e;
            }
          }

          // Invalidate other pending transactions
          await tx.transaction.updateMany({
            where: {
              bookingId: booking.id,
              status: PaymentStatus.PENDING,
              id: { not: txRecord.id },
            },
            data: { status: PaymentStatus.ABANDONED },
          });

          // Transition transaction to SUCCESSFUL
          await tx.transaction.update({
            where: { id: txRecord.id },
            data: {
              status: PaymentStatus.SUCCESSFUL,
              paidAt: now,
              gatewayResponse: gatewayPayload || undefined,
              webhookEventId: eventId || undefined,
              webhookReceivedAt: eventId ? now : undefined,
              paystackChannel: gatewayPayload?.channel || undefined,
            },
          });

          // Transition booking to CONFIRMED
          const qrToken = generateSignedQrToken({
            bookingId: booking.id,
            reference: booking.reference,
            userId: booking.userId,
            startTime:
              booking.startTime instanceof Date
                ? booking.startTime.toISOString()
                : String(booking.startTime),
            endTime:
              booking.endTime instanceof Date
                ? booking.endTime.toISOString()
                : String(booking.endTime),
            issuedAt: Date.now(),
          });
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              state: BookingState.CONFIRMED,
              qrToken,
              holdExpiresAt: null,
            },
          });

          // Create invoice
          await this.invoices.createInvoiceForTransaction(tx, {
            transactionId: txRecord.id,
            bookingId: booking.id,
            userId: booking.userId,
            customerName,
            customerEmail: user?.email || "customer@daih.ng",
            customerClientId:
              user?.clientId ||
              `DAIH-CUS-${booking.userId.slice(0, 8).toUpperCase()}`,
            resourceName: resource?.name || "Workspace",
            bookingReference: booking.reference,
            amount: Number(txRecord.amount),
            currency: txRecord.currency,
          });

          await tx.auditLog.create({
            data: {
              userId: booking.userId,
              action: "PAYMENT_SUCCESSFUL",
              entityType: "Transaction",
              entityId: txRecord.id,
              metadata: {
                bookingId: booking.id,
                reference: txRecord.reference,
                amount: Number(txRecord.amount),
              },
            },
          });

          await loyaltyService.awardPaymentReward(tx, txRecord.id);

          await outboxService.recordEvent(
            {
              eventType: "payment.successful",
              aggregateType: "Transaction",
              aggregateId: txRecord.id,
              payload: {
                transactionId: txRecord.id,
                bookingId: booking.id,
                reference: booking.reference,
                amount: Number(txRecord.amount),
                currency: txRecord.currency,
                customerEmail: user?.email,
                customerName,
              },
            },
            tx,
          );

          await outboxService.recordEvent(
            {
              eventType: "booking.confirmed",
              aggregateType: "Booking",
              aggregateId: booking.id,
              payload: {
                bookingId: booking.id,
                reference: booking.reference,
                qrToken,
                customerEmail: user?.email,
              },
            },
            tx,
          );

          await cancelHoldExpiryJob(booking.id);

          return {
            status: PaymentStatus.SUCCESSFUL,
            confirmed: true,
            reference: txRecord.reference,
            message: "Payment confirmed successfully",
          };
        } else {
          // CASE D: Expired Hold
          // Lock facility resource
          const [resLock] = await tx.$queryRaw<
            Array<{ id: string; capacity: number }>
          >`
            SELECT id, capacity FROM "facility_resources" WHERE id = ${booking.resourceId} FOR UPDATE
          `;
          const capacity = resLock?.capacity || resource?.capacity || 1;

          // Re-check capacity excluding this booking's own row
          const [reservedRow] = await tx.$queryRaw<
            Array<{ reserved_quantity: number }>
          >`
            SELECT COALESCE(SUM("quantity"), 0)::int AS reserved_quantity
            FROM "bookings"
            WHERE "resourceId" = ${booking.resourceId}
              AND "id" <> ${booking.id}
              AND "state" IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE')
              AND ("state" NOT IN ('HELD', 'PENDING_PAYMENT') OR "holdExpiresAt" > NOW())
              AND "startTime" < ${booking.endTime} AND "endTime" > ${booking.startTime}
          `;

          const reserved = Number(reservedRow?.reserved_quantity || 0);
          if (reserved + Number(booking.quantity) > capacity) {
            // Capacity is gone!
            await tx.transaction.update({
              where: { id: txRecord.id },
              data: { status: PaymentStatus.REQUIRES_RECONCILIATION },
            });
            await spawnSystemRefund(
              RefundReasonCode.UNAVAILABLE_RESOURCE,
              "Hold expired and resource capacity was claimed by another customer",
            );
            await tx.auditLog.create({
              data: {
                userId: booking.userId,
                action: "LATE_PAYMENT_CAPACITY_CONFLICT",
                entityType: "Booking",
                entityId: booking.id,
                metadata: {
                  bookingId: booking.id,
                  reserved,
                  quantity: booking.quantity,
                  capacity,
                },
              },
            });
            await outboxService.recordEvent(
              {
                eventType: "admin.payment_flagged",
                aggregateType: "Transaction",
                aggregateId: txRecord.id,
                payload: {
                  transactionId: txRecord.id,
                  bookingId: booking.id,
                  reasonCode: "UNAVAILABLE_RESOURCE",
                  conflict: "CAPACITY_FULL",
                },
              },
              tx,
            );
            return {
              status: PaymentStatus.REQUIRES_RECONCILIATION,
              confirmed: false,
              reference: txRecord.reference,
              message: "Capacity no longer available; refund initiated",
            };
          }

          // Capacity IS available! Re-check spendable coins if coins were redeemed
          const coinsRedeemedDecimal = new Prisma.Decimal(
            booking.coinsRedeemed,
          );
          if (coinsRedeemedDecimal.gt(0)) {
            const [balanceRow] = await tx.$queryRaw<
              Array<{ balance: Prisma.Decimal }>
            >`
              SELECT balance FROM "coin_balances" WHERE "userId" = ${booking.userId} FOR UPDATE
            `;
            const [activeHoldsRow] = await tx.$queryRaw<
              Array<{ active_holds: Prisma.Decimal }>
            >`
              SELECT COALESCE(SUM(amount), 0)::numeric as active_holds FROM "coin_holds" WHERE "userId" = ${booking.userId} AND status = 'ACTIVE' AND "bookingId" <> ${booking.id}
            `;
            const currentBal = new Prisma.Decimal(balanceRow?.balance || 0);
            const activeHolds = new Prisma.Decimal(
              activeHoldsRow?.active_holds || 0,
            );
            const spendable = currentBal.sub(activeHolds);

            if (spendable.lt(coinsRedeemedDecimal)) {
              // User spent coins elsewhere while hold expired!
              await tx.transaction.update({
                where: { id: txRecord.id },
                data: { status: PaymentStatus.REQUIRES_RECONCILIATION },
              });
              await spawnSystemRefund(
                RefundReasonCode.UNAVAILABLE_RESOURCE,
                "Hold expired and spendable coins are no longer sufficient to cover redeemed amount",
              );
              await tx.auditLog.create({
                data: {
                  userId: booking.userId,
                  action: "LATE_PAYMENT_COINS_CONFLICT",
                  entityType: "Booking",
                  entityId: booking.id,
                  metadata: {
                    bookingId: booking.id,
                    spendable: spendable.toNumber(),
                    required: coinsRedeemedDecimal.toNumber(),
                  },
                },
              });
              await outboxService.recordEvent(
                {
                  eventType: "admin.payment_flagged",
                  aggregateType: "Transaction",
                  aggregateId: txRecord.id,
                  payload: {
                    transactionId: txRecord.id,
                    bookingId: booking.id,
                    reasonCode: "UNAVAILABLE_RESOURCE",
                    conflict: "INSUFFICIENT_COINS",
                  },
                },
                tx,
              );
              return {
                status: PaymentStatus.REQUIRES_RECONCILIATION,
                confirmed: false,
                reference: txRecord.reference,
                message: "Coins no longer available; refund initiated",
              };
            }

            // Spendable coins ARE sufficient! Re-burn coins
            await tx.coinHold.updateMany({
              where: { bookingId: booking.id },
              data: { status: HoldStatus.BURNED },
            });

            const newBal = currentBal.sub(coinsRedeemedDecimal);
            try {
              await tx.coinLedgerEntry.create({
                data: {
                  userId: booking.userId,
                  action: CoinLedgerAction.HOLD_BURNED,
                  amount: coinsRedeemedDecimal.negated(),
                  balanceAfter: newBal,
                  referenceType: "Booking",
                  referenceId: booking.id,
                  idempotencyKey: `burn_booking_${booking.id}`,
                  metadata: {
                    bookingId: booking.id,
                    transactionId: txRecord.id,
                  },
                },
              });
              await tx.coinBalance.update({
                where: { userId: booking.userId },
                data: {
                  balance: newBal,
                  lifetimeBurned: { increment: coinsRedeemedDecimal },
                },
              });
            } catch (e: any) {
              if (e.code !== "P2002") throw e;
            }
          }

          // Invalidate other pending transactions
          await tx.transaction.updateMany({
            where: {
              bookingId: booking.id,
              status: PaymentStatus.PENDING,
              id: { not: txRecord.id },
            },
            data: { status: PaymentStatus.ABANDONED },
          });

          // Transition transaction to SUCCESSFUL
          await tx.transaction.update({
            where: { id: txRecord.id },
            data: {
              status: PaymentStatus.SUCCESSFUL,
              paidAt: now,
              gatewayResponse: gatewayPayload || undefined,
            },
          });

          // Re-confirm booking
          const qrToken = generateSignedQrToken({
            bookingId: booking.id,
            reference: booking.reference,
            userId: booking.userId,
            startTime:
              booking.startTime instanceof Date
                ? booking.startTime.toISOString()
                : String(booking.startTime),
            endTime:
              booking.endTime instanceof Date
                ? booking.endTime.toISOString()
                : String(booking.endTime),
            issuedAt: Date.now(),
          });
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              state: BookingState.CONFIRMED,
              qrToken,
              holdExpiresAt: null,
            },
          });

          // Create invoice
          await this.invoices.createInvoiceForTransaction(tx, {
            transactionId: txRecord.id,
            bookingId: booking.id,
            userId: booking.userId,
            customerName,
            customerEmail: user?.email || "customer@daih.ng",
            customerClientId:
              user?.clientId ||
              `DAIH-CUS-${booking.userId.slice(0, 8).toUpperCase()}`,
            resourceName: resource?.name || "Workspace",
            bookingReference: booking.reference,
            amount: Number(txRecord.amount),
            currency: txRecord.currency,
          });

          await tx.auditLog.create({
            data: {
              userId: booking.userId,
              action: "PAYMENT_SUCCESSFUL",
              entityType: "Transaction",
              entityId: txRecord.id,
              metadata: {
                bookingId: booking.id,
                reference: txRecord.reference,
                amount: Number(txRecord.amount),
                lateConfirmed: true,
              },
            },
          });

          await loyaltyService.awardPaymentReward(tx, txRecord.id);

          await outboxService.recordEvent(
            {
              eventType: "payment.successful",
              aggregateType: "Transaction",
              aggregateId: txRecord.id,
              payload: {
                transactionId: txRecord.id,
                bookingId: booking.id,
                reference: booking.reference,
                amount: Number(txRecord.amount),
                currency: txRecord.currency,
                customerEmail: user?.email,
                customerName,
              },
            },
            tx,
          );

          await outboxService.recordEvent(
            {
              eventType: "booking.confirmed",
              aggregateType: "Booking",
              aggregateId: booking.id,
              payload: {
                bookingId: booking.id,
                reference: booking.reference,
                qrToken,
                customerEmail: user?.email,
              },
            },
            tx,
          );

          await cancelHoldExpiryJob(booking.id);

          return {
            status: PaymentStatus.SUCCESSFUL,
            confirmed: true,
            reference: txRecord.reference,
            message: "Late payment reconfirmed successfully",
          };
        }
      },
      { timeout: 20000, maxWait: 15000 },
    );
  }

  /**
   * Handles incoming Paystack webhook idempotently
   */
  async handleWebhookEvent(event: PaystackWebhookPayload) {
    const eventId = String(event.data?.id || "");
    const reference = event.data?.reference;

    if (!reference) {
      console.warn("⚠️ Webhook event missing reference:", event.event);
      return { received: true, skipped: true };
    }

    // 1. Idempotency check: have we already recorded this Paystack event ID?
    if (eventId) {
      const existing = await this.repo.findByWebhookEventId(eventId);
      if (existing) {
        console.log(
          `⚡ Idempotent webhook received: Event ID '${eventId}' already processed for transaction '${existing.reference}'`,
        );
        return { received: true, duplicate: true };
      }
    }

    // 2. Lookup transaction by Paystack reference
    const transaction = await this.repo.findByPaystackReference(reference);
    if (!transaction) {
      console.warn(
        `⚠️ Orphan webhook received: No local transaction found for Paystack reference '${reference}'`,
      );
      return { received: true, orphan: true };
    }

    if (event.event === "charge.success") {
      const result = await this.reconcilePaymentTransaction(
        transaction.id,
        event.data,
        eventId,
      );
      return { received: true, processed: true, ...result };
    } else if (
      event.event === "charge.failed" ||
      event.event === "paymentrequest.failed"
    ) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: PaymentStatus.FAILED,
          failedAt: new Date(),
          webhookEventId: eventId || null,
          webhookReceivedAt: new Date(),
          gatewayResponse: {
            gateway_response: event.data.gateway_response || "Failed",
          },
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: transaction.userId,
          action: "PAYMENT_FAILED",
          entityType: "Transaction",
          entityId: transaction.id,
          metadata: {
            reference: transaction.reference,
            paystackEventId: eventId,
            gatewayResponse: event.data.gateway_response,
          },
        },
      });

      await outboxService.recordEvent({
        eventType: "payment.failed",
        aggregateType: "Transaction",
        aggregateId: transaction.id,
        payload: {
          transactionId: transaction.id,
          bookingId: transaction.bookingId,
          reference: transaction.reference,
        },
      });

      return { received: true, processed: true };
    }

    return { received: true, ignored: true };
  }

  /**
   * Verify and sync payment status with Paystack (Customer polling or manual verification)
   */
  async verifyPayment(transactionIdOrRef: string, userId?: string) {
    let tx = await this.repo.findById(transactionIdOrRef);
    if (!tx) {
      tx = await this.repo.findByReference(transactionIdOrRef);
    }
    if (!tx) {
      tx = await this.repo.findByPaystackReference(transactionIdOrRef);
    }
    if (!tx) {
      // Support looking up latest transaction by booking ID
      tx = await prisma.transaction.findFirst({
        where: { bookingId: transactionIdOrRef },
        orderBy: { createdAt: "desc" },
        include: {
          booking: {
            include: {
              resource: true,
              user: true,
            },
          },
          user: true,
          invoice: true,
        },
      });
    }
    if (!tx) {
      const err: any = new Error(
        `Transaction '${transactionIdOrRef}' not found`,
      );
      err.statusCode = 404;
      err.code = "TRANSACTION_NOT_FOUND";
      throw err;
    }

    if (userId && tx.userId !== userId) {
      const err: any = new Error(
        "You are not authorized to view this transaction",
      );
      err.statusCode = 403;
      err.code = "FORBIDDEN";
      throw err;
    }

    // If still pending, query Paystack directly to sync
    if (tx.status === PaymentStatus.PENDING && tx.paystackReference) {
      try {
        const verifyRes = await this.paystack.verifyTransaction(
          tx.paystackReference,
        );
        if (verifyRes && verifyRes.data) {
          if (verifyRes.data.status === "success") {
            await this.reconcilePaymentTransaction(tx.id, verifyRes.data);
            tx = await this.repo.findById(tx.id);
          } else if (
            verifyRes.data.status === "failed" ||
            verifyRes.data.status === "abandoned"
          ) {
            await this.handleWebhookEvent({
              event: "charge.failed",
              data: verifyRes.data as any,
            });
            tx = await this.repo.findById(tx.id);
          }
        } else if (verifyRes === null) {
          // Transaction reference was not found on Paystack (never sent to Paystack or abandoned)
          const ageMinutes =
            (Date.now() - new Date(tx.createdAt).getTime()) / (1000 * 60);
          if (ageMinutes >= 15) {
            await prisma.transaction.update({
              where: { id: tx.id },
              data: {
                status: PaymentStatus.FAILED,
                failedAt: new Date(),
                gatewayResponse: {
                  gateway_response:
                    "Transaction abandoned before Paystack registration",
                },
              },
            });
            tx = await this.repo.findById(tx.id);
          }
        }
      } catch (err: any) {
        console.warn("Notice checking Paystack verification:", err.message);
      }
    }

    return this.formatTransaction(tx);
  }

  /**
   * Get customer's personal payment history
   */
  async getPaymentHistory(
    userId: string,
    options?: { page?: number; limit?: number },
  ) {
    const res = await this.repo.findByUserId(userId, options);
    return {
      total: res.total,
      page: res.page,
      limit: res.limit,
      transactions: res.transactions.map((t) => this.formatTransaction(t)),
    };
  }

  /**
   * Get all transactions for Admin / Finance view
   */
  async getAdminTransactions(filters: {
    status?: PaymentStatus;
    method?: PaymentMethod;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const parseFilterDate = (d?: string, isEnd = false) => {
      if (!d) return undefined;
      const date = new Date(d);
      if (isNaN(date.getTime())) return undefined;
      if (isEnd && (d.length <= 10 || !d.includes("T"))) {
        date.setHours(23, 59, 59, 999);
      }
      return date;
    };

    const res = await this.repo.findAllAdminTransactions({
      ...filters,
      startDate: parseFilterDate(filters.startDate, false),
      endDate: parseFilterDate(filters.endDate, true),
    });

    return {
      total: res.total,
      page: res.page,
      limit: res.limit,
      transactions: res.transactions.map((t) => this.formatTransaction(t)),
    };
  }

  /**
   * Reconciliation View for Finance Officers
   */
  async getReconciliationView(
    startDateStr?: string,
    endDateStr?: string,
  ): Promise<ReconciliationSummary> {
    const startDate = startDateStr
      ? new Date(startDateStr)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = endDateStr ? new Date(endDateStr) : new Date();

    const transactions = await prisma.transaction.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        booking: {
          include: { resource: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    let totalCollected = 0;
    let totalRefunded = 0;
    let matchedCount = 0;
    const discrepancies: ReconciliationDiscrepancy[] = [];

    for (const t of transactions) {
      const amount = Number(t.amount);
      if (t.status === PaymentStatus.SUCCESSFUL) {
        totalCollected += amount;
        matchedCount++;
      } else if (
        t.status === PaymentStatus.REFUNDED ||
        t.status === PaymentStatus.PARTIALLY_REFUNDED
      ) {
        totalCollected += amount;
        totalRefunded += Number(t.refundAmount || amount);
        matchedCount++;
      } else if (t.status === PaymentStatus.FAILED) {
        // Failed is recorded
        matchedCount++;
      } else if (t.status === PaymentStatus.PENDING) {
        // Check if old pending transactions have discrepancies
        const ageHours =
          (Date.now() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60);
        if (ageHours > 24) {
          discrepancies.push({
            transactionId: t.id,
            reference: t.reference,
            type: "STATUS_MISMATCH",
            localStatus: PaymentStatus.PENDING as any,
            localAmount: amount,
            details:
              "Pending transaction older than 24 hours without resolution",
          });
        }
      }
    }

    return {
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      totalLocalTransactions: transactions.length,
      matchedCount,
      discrepancyCount: discrepancies.length,
      totalCollected,
      totalRefunded,
      netRevenue: totalCollected - totalRefunded,
      currency: "NGN",
      discrepancies,
    };
  }

  /**
   * Daily Payment Summary for Finance Dashboard
   */
  async getDailySummary(dateStr?: string): Promise<DailyPaymentSummary> {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const startOfDay = new Date(
      Date.UTC(
        targetDate.getUTCFullYear(),
        targetDate.getUTCMonth(),
        targetDate.getUTCDate(),
        0,
        0,
        0,
      ),
    );
    const endOfDay = new Date(
      Date.UTC(
        targetDate.getUTCFullYear(),
        targetDate.getUTCMonth(),
        targetDate.getUTCDate(),
        23,
        59,
        59,
      ),
    );

    const transactions = await prisma.transaction.findMany({
      where: {
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    let successfulCount = 0;
    let successfulAmount = 0;
    let failedCount = 0;
    let failedAmount = 0;
    let refundedCount = 0;
    let refundedAmount = 0;
    let pendingCount = 0;
    let pendingAmount = 0;

    for (const t of transactions) {
      const amt = Number(t.amount);
      switch (t.status) {
        case PaymentStatus.SUCCESSFUL:
          successfulCount++;
          successfulAmount += amt;
          break;
        case PaymentStatus.FAILED:
          failedCount++;
          failedAmount += amt;
          break;
        case PaymentStatus.REFUNDED:
        case PaymentStatus.PARTIALLY_REFUNDED:
          refundedCount++;
          refundedAmount += Number(t.refundAmount || amt);
          successfulAmount += amt; // originally collected
          break;
        case PaymentStatus.PENDING:
          pendingCount++;
          pendingAmount += amt;
          break;
      }
    }

    return {
      date: startOfDay.toISOString().slice(0, 10),
      totalTransactions: transactions.length,
      successfulCount,
      successfulAmount,
      failedCount,
      failedAmount,
      refundedCount,
      refundedAmount,
      pendingCount,
      pendingAmount,
      netRevenue: successfulAmount - refundedAmount,
      currency: "NGN",
    };
  }
}

export const paymentsService = new PaymentsService();

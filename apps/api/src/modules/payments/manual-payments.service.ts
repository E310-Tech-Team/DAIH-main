import { HoldStatus, Prisma } from "@prisma/client";
import {
  BankAccountDetails,
  BankTransferCheckoutResult,
  BookingState,
  ConfirmBankTransferInput,
  PaymentMethod,
  PaymentOption,
  PaymentStatus,
  PendingBankTransfer,
  ReceptionCheckoutResult,
  RecordReceptionPaymentInput,
} from "@daih/types";
import { prisma } from "../../db/client.js";
import { scheduleHoldExpiry } from "../../jobs/hold-expiry.job.js";
import { paymentsService } from "./payments.service.js";
import { paymentSettingsService } from "./payment-settings.service.js";
import {
  bankAccountOf,
  bankTransferDeadline,
  receptionDeadline,
} from "./payment-options.js";
import { isUniqueViolation, paymentError } from "./payment-errors.js";
import {
  generatePaymentReference,
  lockPayableBooking,
  toKobo,
} from "./payable-booking.js";

/** A transfer can be confirmed while open, or after it lapsed if the money still arrived. */
const CONFIRMABLE_TRANSFER_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.EXPIRED,
  PaymentStatus.ABANDONED,
];
/** Money arriving later than this after the transfer was opened is settled outside the app. */
const LATE_CONFIRMATION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRANSFER_LIST_LIMIT = 200;
const TX_OPTIONS = { timeout: 20000, maxWait: 15000 };

/** The account a member was shown when the transfer was opened (stored on the transaction). */
function accountShownFor(
  gatewayResponse: Prisma.JsonValue | null,
): BankAccountDetails | null {
  const shown = (gatewayResponse as { bankAccount?: BankAccountDetails } | null)
    ?.bankAccount;
  return shown?.bankName && shown.accountNumber && shown.accountName
    ? shown
    : null;
}

export type ReconcileOutcome = Awaited<
  ReturnType<typeof paymentsService.reconcilePaymentTransaction>
>;

export interface ManualPaymentResult extends ReconcileOutcome {
  transactionId: string;
  bookingId: string;
}

export type TransferListStatus =
  | PaymentStatus.PENDING
  | PaymentStatus.EXPIRED
  | PaymentStatus.ABANDONED
  | PaymentStatus.FAILED;

function formatNaira(amount: Prisma.Decimal | number): string {
  return `₦${Number(amount).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Holds the booking, and any coins reserved for it, until `deadline`. */
async function holdBookingUntil(
  tx: Prisma.TransactionClient,
  bookingId: string,
  deadline: Date,
  option: PaymentOption,
): Promise<void> {
  await tx.booking.update({
    where: { id: bookingId },
    data: {
      state: BookingState.PENDING_PAYMENT,
      holdExpiresAt: deadline,
      paymentOption: option,
    },
  });
  await tx.coinHold.updateMany({
    where: { bookingId, status: HoldStatus.ACTIVE },
    data: { expiresAt: deadline },
  });
}

/** Supersedes any open checkout session for the booking (e.g. an unfinished Paystack page). */
async function abandonOpenPayments(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<void> {
  await tx.transaction.updateMany({
    where: { bookingId, status: PaymentStatus.PENDING },
    data: { status: PaymentStatus.ABANDONED },
  });
}

function toPendingTransfer(
  row: Prisma.TransactionGetPayload<{
    include: {
      booking: { include: { resource: { select: { name: true } } } };
      user: {
        select: {
          id: true;
          firstName: true;
          lastName: true;
          email: true;
          clientId: true;
        };
      };
    };
  }>,
): PendingBankTransfer {
  return {
    transactionId: row.id,
    reference: row.reference,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status as PaymentStatus,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.booking.holdExpiresAt?.toISOString() ?? null,
    member: {
      id: row.user.id,
      name: `${row.user.firstName} ${row.user.lastName}`.trim(),
      email: row.user.email,
      clientId: row.user.clientId,
    },
    booking: {
      id: row.booking.id,
      reference: row.booking.reference,
      resourceName: row.booking.resource.name,
      startTime: row.booking.startTime.toISOString(),
      endTime: row.booking.endTime.toISOString(),
      state: row.booking.state,
    },
  };
}

export class ManualPaymentsService {
  /** Member chose to pay by transfer: issue a reference and hold the booking while it arrives. */
  async startBankTransfer(
    bookingId: string,
    userId: string,
  ): Promise<BankTransferCheckoutResult> {
    const settings = await paymentSettingsService.getValues();
    const bankAccount = bankAccountOf(settings);
    if (!settings.bankTransferEnabled || !bankAccount) {
      throw paymentError(
        400,
        "PAYMENT_OPTION_UNAVAILABLE",
        "Bank transfer is not available right now. Please choose another way to pay.",
      );
    }
    const now = new Date();

    const { transfer, expiresAt, isNew } = await prisma.$transaction(
      async (tx) => {
        const booking = await lockPayableBooking(tx, bookingId, userId);

        // Re-opening the instructions must not extend the hold: reuse the open
        // transfer and its original deadline.
        const open = await tx.transaction.findFirst({
          where: {
            bookingId,
            status: PaymentStatus.PENDING,
            method: PaymentMethod.BANK_TRANSFER,
          },
          orderBy: { createdAt: "desc" },
        });
        if (
          open &&
          booking.holdExpiresAt &&
          new Prisma.Decimal(open.amount).equals(booking.cashDue)
        ) {
          return {
            transfer: open,
            expiresAt: booking.holdExpiresAt,
            isNew: false,
          };
        }

        const deadline = bankTransferDeadline(
          now,
          booking.startTime,
          settings.transferWindowHours,
        );
        if (!deadline) {
          throw paymentError(
            400,
            "TRANSFER_WINDOW_TOO_SHORT",
            "This booking starts too soon for a bank transfer to be confirmed. Please pay online or at reception.",
          );
        }

        await abandonOpenPayments(tx, bookingId);
        const created = await tx.transaction.create({
          data: {
            reference: generatePaymentReference(now),
            bookingId,
            userId,
            amount: booking.cashDue,
            currency: booking.currency || "NGN",
            status: PaymentStatus.PENDING,
            method: PaymentMethod.BANK_TRANSFER,
            // Snapshot: a later settings change must not redirect this member.
            gatewayResponse: { bankAccount: { ...bankAccount } },
          },
        });
        await holdBookingUntil(
          tx,
          bookingId,
          deadline,
          PaymentOption.BANK_TRANSFER,
        );
        return { transfer: created, expiresAt: deadline, isNew: true };
      },
      TX_OPTIONS,
    );

    if (isNew) {
      await scheduleHoldExpiry(bookingId, expiresAt.getTime() - Date.now());
    }
    return {
      option: PaymentOption.BANK_TRANSFER,
      reference: transfer.reference,
      transactionId: transfer.id,
      amount: Number(transfer.amount),
      currency: transfer.currency,
      expiresAt: expiresAt.toISOString(),
      bankAccount: accountShownFor(transfer.gatewayResponse) ?? bankAccount,
    };
  }

  /** Member chose to pay at the desk: hold the booking until shortly after it starts. */
  async startPayAtReception(
    bookingId: string,
    userId: string,
  ): Promise<ReceptionCheckoutResult> {
    const settings = await paymentSettingsService.getValues();
    if (!settings.payAtReceptionEnabled) {
      throw paymentError(
        400,
        "PAYMENT_OPTION_UNAVAILABLE",
        "Paying at reception is not available right now. Please choose another way to pay.",
      );
    }
    const now = new Date();

    const { booking, deadline } = await prisma.$transaction(async (tx) => {
      const locked = await lockPayableBooking(tx, bookingId, userId);
      const until = receptionDeadline(
        now,
        locked.startTime,
        settings.receptionGraceMinutes,
      );
      if (!until) {
        throw paymentError(
          400,
          "RECEPTION_WINDOW_PASSED",
          "It is too late to reserve this booking to pay at reception. Please pay online instead.",
        );
      }
      await abandonOpenPayments(tx, bookingId);
      await holdBookingUntil(
        tx,
        bookingId,
        until,
        PaymentOption.PAY_AT_RECEPTION,
      );
      return { booking: locked, deadline: until };
    }, TX_OPTIONS);

    await scheduleHoldExpiry(bookingId, deadline.getTime() - Date.now());
    return {
      option: PaymentOption.PAY_AT_RECEPTION,
      amount: Number(booking.cashDue),
      currency: booking.currency || "NGN",
      expiresAt: deadline.toISOString(),
    };
  }

  /**
   * Finance attests the money is on the bank statement. The reconciler then
   * confirms the booking, or holds the payment for review if anything differs.
   */
  async confirmBankTransfer(
    staffUserId: string,
    transactionId: string,
    input: ConfirmBankTransferInput,
  ): Promise<ManualPaymentResult> {
    const transfer = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    if (!transfer || transfer.method !== PaymentMethod.BANK_TRANSFER) {
      throw paymentError(404, "TRANSFER_NOT_FOUND", "Bank transfer not found.");
    }
    if (transfer.userId === staffUserId) {
      throw paymentError(
        403,
        "SELF_CONFIRMATION_PROHIBITED",
        "You cannot confirm a payment for your own booking.",
      );
    }
    if (
      transfer.status !== PaymentStatus.PENDING &&
      Date.now() - transfer.createdAt.getTime() >
        LATE_CONFIRMATION_DAYS * DAY_MS
    ) {
      throw paymentError(
        409,
        "TRANSFER_TOO_OLD",
        `This transfer was opened more than ${LATE_CONFIRMATION_DAYS} days ago. Settle it with the member outside the app.`,
      );
    }
    // Catch typos before anything is recorded; a genuine difference must be acknowledged.
    if (
      toKobo(input.amountReceived) !== toKobo(transfer.amount) &&
      !input.allowAmountMismatch
    ) {
      throw paymentError(
        409,
        "AMOUNT_MISMATCH",
        `You entered ${formatNaira(input.amountReceived)} but ${formatNaira(transfer.amount)} is due. Check for a typo. If the member really sent a different amount, confirm again and choose to record it for reconciliation.`,
      );
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Only the first attestation counts: a concurrent or repeated confirm
        // must not overwrite who vouched for the money.
        const claimed = await tx.transaction.updateMany({
          where: {
            id: transactionId,
            status: { in: CONFIRMABLE_TRANSFER_STATUSES },
            confirmedBy: null,
          },
          data: {
            confirmedBy: staffUserId,
            externalReference: input.bankReference,
          },
        });
        if (claimed.count === 0) {
          throw paymentError(
            409,
            "TRANSFER_ALREADY_SETTLED",
            "This transfer has already been confirmed or closed.",
          );
        }
        await tx.auditLog.create({
          data: {
            userId: staffUserId,
            action: "BANK_TRANSFER_RECEIVED",
            entityType: "Transaction",
            entityId: transactionId,
            metadata: {
              reference: transfer.reference,
              bankReference: input.bankReference,
              amountReceived: input.amountReceived,
              amountDue: Number(transfer.amount),
              amountMismatchAcknowledged: !!input.allowAmountMismatch,
              note: input.note ?? null,
            },
          },
        });
      }, TX_OPTIONS);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw paymentError(
          409,
          "DUPLICATE_BANK_REFERENCE",
          "This bank reference has already been used to confirm another payment.",
        );
      }
      throw err;
    }

    const outcome = await paymentsService.reconcilePaymentTransaction(
      transactionId,
      {
        status: "success",
        amount: toKobo(input.amountReceived),
        currency: transfer.currency,
        reference: transfer.reference,
        channel: "bank_transfer",
        bankReference: input.bankReference,
        confirmedBy: staffUserId,
      },
    );
    return { ...outcome, transactionId, bookingId: transfer.bookingId };
  }

  /** Finance found no matching money: close the transfer; the member can still pay another way. */
  async rejectBankTransfer(
    staffUserId: string,
    transactionId: string,
    reason: string,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const rejected = await tx.transaction.updateMany({
        where: {
          id: transactionId,
          method: PaymentMethod.BANK_TRANSFER,
          // Lapsed transfers can be closed too, so they stop being confirmable.
          status: { in: CONFIRMABLE_TRANSFER_STATUSES },
          confirmedBy: null,
        },
        data: {
          status: PaymentStatus.FAILED,
          failedAt: new Date(),
          confirmedBy: staffUserId,
          gatewayResponse: { rejectedReason: reason },
        },
      });
      if (rejected.count === 0) {
        throw paymentError(
          409,
          "TRANSFER_NOT_PENDING",
          "Only transfers that have not been confirmed or closed can be rejected.",
        );
      }
      await tx.auditLog.create({
        data: {
          userId: staffUserId,
          action: "BANK_TRANSFER_REJECTED",
          entityType: "Transaction",
          entityId: transactionId,
          metadata: { reason },
        },
      });
    }, TX_OPTIONS);
  }

  async listBankTransfers(
    status: TransferListStatus = PaymentStatus.PENDING,
  ): Promise<PendingBankTransfer[]> {
    const rows = await prisma.transaction.findMany({
      where: { method: PaymentMethod.BANK_TRANSFER, status },
      include: {
        booking: { include: { resource: { select: { name: true } } } },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            clientId: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: TRANSFER_LIST_LIMIT,
    });
    return rows.map(toPendingTransfer);
  }

  /** Reception took cash or POS at the desk for an unpaid booking. */
  async recordReceptionPayment(
    staffUserId: string,
    bookingId: string,
    input: RecordReceptionPaymentInput,
  ): Promise<ManualPaymentResult> {
    const settings = await paymentSettingsService.getValues();
    if (!settings.payAtReceptionEnabled) {
      throw paymentError(
        400,
        "PAYMENT_OPTION_UNAVAILABLE",
        "Reception payments are turned off in payment settings.",
      );
    }
    const now = new Date();

    const recordInTransaction = () =>
      prisma.$transaction(async (tx) => {
        // lockPayableBooking also refuses a lapsed hold (HOLD_LAPSED).
        const booking = await lockPayableBooking(tx, bookingId);
        if (booking.userId === staffUserId) {
          throw paymentError(
            403,
            "SELF_CONFIRMATION_PROHIBITED",
            "You cannot record a payment for your own booking.",
          );
        }
        // A desk payment already awaiting finance review must not be collected again.
        const underReview = await tx.transaction.findFirst({
          where: {
            bookingId,
            method: { in: [PaymentMethod.CASH, PaymentMethod.POS_TERMINAL] },
            status: {
              in: [
                PaymentStatus.REQUIRES_RECONCILIATION,
                PaymentStatus.FLAGGED_MISMATCH,
              ],
            },
          },
          select: { reference: true },
        });
        if (underReview) {
          throw paymentError(
            409,
            "RECEPTION_PAYMENT_UNDER_REVIEW",
            `A desk payment for this booking (${underReview.reference}) is awaiting finance review. Do not collect again; ask finance to resolve it.`,
          );
        }
        // Cash is counted at the desk, so collect the exact amount rather than reconcile a difference later.
        if (toKobo(input.amountReceived) !== toKobo(booking.cashDue)) {
          throw paymentError(
            400,
            "AMOUNT_MISMATCH",
            `Collect exactly ${formatNaira(booking.cashDue)} for this booking.`,
          );
        }

        // A retry after a failed confirmation reuses the row it left behind.
        const leftover = await tx.transaction.findFirst({
          where: {
            bookingId,
            status: PaymentStatus.PENDING,
            method: input.method,
          },
          orderBy: { createdAt: "desc" },
        });
        const fields = {
          amount: booking.cashDue,
          confirmedBy: staffUserId,
          externalReference: input.receiptReference ?? null,
        };
        const created = leftover
          ? await tx.transaction.update({
              where: { id: leftover.id },
              data: fields,
            })
          : await tx.transaction.create({
              data: {
                ...fields,
                reference: generatePaymentReference(now),
                bookingId,
                userId: booking.userId,
                currency: booking.currency || "NGN",
                status: PaymentStatus.PENDING,
                method: input.method,
              },
            });
        await tx.auditLog.create({
          data: {
            userId: staffUserId,
            action: "RECEPTION_PAYMENT_RECORDED",
            entityType: "Transaction",
            entityId: created.id,
            metadata: {
              bookingId,
              bookingReference: booking.reference,
              method: input.method,
              amount: Number(booking.cashDue),
              receiptReference: input.receiptReference ?? null,
            },
          },
        });
        return created;
      }, TX_OPTIONS);

    const recorded = await recordInTransaction().catch((err: unknown) => {
      if (isUniqueViolation(err)) {
        throw paymentError(
          409,
          "DUPLICATE_RECEIPT_REFERENCE",
          "This POS receipt number has already been recorded for another payment.",
        );
      }
      throw err;
    });

    const outcome = await paymentsService.reconcilePaymentTransaction(
      recorded.id,
      {
        status: "success",
        amount: toKobo(recorded.amount),
        currency: recorded.currency,
        reference: recorded.reference,
        channel: input.method === PaymentMethod.CASH ? "cash" : "pos",
        confirmedBy: staffUserId,
      },
    );
    return { ...outcome, transactionId: recorded.id, bookingId };
  }
}

export const manualPaymentsService = new ManualPaymentsService();

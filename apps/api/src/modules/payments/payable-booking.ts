import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { BookingState, PaymentStatus } from "@daih/types";
import { paymentError } from "./payment-errors.js";

export interface PayableBooking {
  id: string;
  reference: string;
  userId: string;
  state: BookingState;
  holdExpiresAt: Date | null;
  cashDue: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  currency: string;
  startTime: Date;
}

/**
 * Locks a booking that can still be paid for (`FOR UPDATE`), or throws the
 * reason it cannot. Pass `payerUserId` when the member themself is paying.
 */
export async function lockPayableBooking(
  tx: Prisma.TransactionClient,
  bookingId: string,
  payerUserId?: string,
): Promise<PayableBooking> {
  const [booking] = await tx.$queryRaw<PayableBooking[]>`
    SELECT id, reference, "userId", state, "holdExpiresAt", "cashDue", "totalAmount", currency, "startTime"
    FROM "bookings" WHERE id = ${bookingId} FOR UPDATE`;

  if (!booking) {
    throw paymentError(
      404,
      "BOOKING_NOT_FOUND",
      `Booking '${bookingId}' not found`,
    );
  }
  if (payerUserId !== undefined && booking.userId !== payerUserId) {
    throw paymentError(
      403,
      "FORBIDDEN",
      "You are not authorized to pay for this booking",
    );
  }
  if (
    booking.state !== BookingState.HELD &&
    booking.state !== BookingState.PENDING_PAYMENT
  ) {
    throw paymentError(
      400,
      "INVALID_BOOKING_STATE",
      `Cannot pay for booking in state '${booking.state}'`,
    );
  }

  // The overdue sweep runs every 30 s, so a lapsed hold can still read as
  // HELD/PENDING_PAYMENT. Never re-hold it: its slot may already be released.
  if (
    booking.holdExpiresAt &&
    new Date(booking.holdExpiresAt).getTime() <= Date.now()
  ) {
    throw paymentError(
      409,
      "HOLD_LAPSED",
      "This reservation has expired, so its slot may have been released. Please make a new booking.",
    );
  }

  const cashDue = new Prisma.Decimal(booking.cashDue);
  if (cashDue.lte(0)) {
    throw paymentError(
      400,
      "ZERO_CASH_DUE",
      "Booking is fully covered by coins or discounts and does not require cash payment.",
    );
  }

  const paid = await tx.transaction.findFirst({
    where: { bookingId: booking.id, status: PaymentStatus.SUCCESSFUL },
    select: { reference: true },
  });
  if (paid) {
    throw paymentError(
      400,
      "BOOKING_ALREADY_PAID",
      `This booking has already been paid and confirmed (Reference: ${paid.reference}).`,
    );
  }

  return { ...booking, cashDue };
}

// No 0/O or 1/I: members type this reference into their banking app.
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A payment reference safe to type into a transfer narration: DAIH-PAY-YYYYMMDD-XXXXXX. */
export function generatePaymentReference(now: Date = new Date()): string {
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  // 32 symbols divide 256 evenly, so `byte % 32` has no bias.
  const suffix = Array.from(
    crypto.randomBytes(6),
    (byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length],
  ).join("");
  return `DAIH-PAY-${datePart}-${suffix}`;
}

/** Naira to kobo: the unit Paystack and the reconciler compare amounts in. */
export function toKobo(amount: Prisma.Decimal | number): number {
  return Math.round(Number(amount) * 100);
}

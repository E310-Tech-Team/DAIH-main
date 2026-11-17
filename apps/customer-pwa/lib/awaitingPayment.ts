import { BookingState, BookingSummary } from "@daih/types";

const UNPAID_STATES: ReadonlySet<BookingState> = new Set([
  BookingState.HELD,
  BookingState.PENDING_PAYMENT,
]);

/** When the booking's hold lapses, in epoch ms; null if it has no valid deadline. */
export function getHoldDeadlineMs(booking: BookingSummary): number | null {
  if (!booking.holdExpiresAt) return null;
  const deadlineMs = new Date(booking.holdExpiresAt).getTime();
  return Number.isNaN(deadlineMs) ? null : deadlineMs;
}

/** Unpaid (HELD or PENDING_PAYMENT) and its hold has not yet lapsed. */
export function isAwaitingPayment(booking: BookingSummary, now: Date): boolean {
  const deadlineMs = getHoldDeadlineMs(booking);
  return (
    UNPAID_STATES.has(booking.state) &&
    deadlineMs !== null &&
    deadlineMs > now.getTime()
  );
}

/** Bookings still waiting for payment, the most urgent deadline first. */
export function selectAwaitingPayment(
  bookings: readonly BookingSummary[],
  now: Date,
): BookingSummary[] {
  // filter() returns a new array, so sorting it leaves `bookings` untouched.
  return bookings
    .filter((booking) => isAwaitingPayment(booking, now))
    .sort((a, b) => (getHoldDeadlineMs(a) ?? 0) - (getHoldDeadlineMs(b) ?? 0));
}

/** What the member still has to pay in cash, after discounts and coins. */
export function getAmountDue(booking: BookingSummary): number {
  return booking.cashDue ?? booking.amount;
}

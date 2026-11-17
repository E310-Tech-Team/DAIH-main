"use client";

import { useId } from "react";
import { BookingSummary } from "@daih/types";
import { AwaitingPaymentCard, PayNowError } from "./AwaitingPaymentCard";

interface AwaitingPaymentSectionProps {
  /** Unpaid bookings whose hold has not lapsed, most urgent first. */
  bookings: BookingSummary[];
  payingBookingId: string | null;
  payNowError: PayNowError | null;
  onPayNow: (bookingId: string) => void;
  onCancel: (bookingId: string) => void;
}

/** My Bookings' "Awaiting payment" group, shown above the active passes. */
export function AwaitingPaymentSection({
  bookings,
  payingBookingId,
  payNowError,
  onPayNow,
  onCancel,
}: AwaitingPaymentSectionProps) {
  const headingId = useId();
  const count = bookings.length;

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div>
        <h2
          id={headingId}
          className="flex items-center gap-2 text-lg font-extrabold text-slate-900"
        >
          <span>Awaiting payment</span>
          <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-amber-100 px-2 text-sm font-bold text-amber-800">
            {count}
            <span className="sr-only">
              {count === 1 ? " booking" : " bookings"}
            </span>
          </span>
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Pay before the deadline, or the booking is released for other members.
        </p>
      </div>
      <ul
        role="list"
        className="grid grid-cols-1 items-start gap-4 md:grid-cols-2"
      >
        {bookings.map((booking) => (
          <li key={booking.id}>
            <AwaitingPaymentCard
              booking={booking}
              isPaying={payingBookingId === booking.id}
              payNowError={
                payNowError?.bookingId === booking.id ? payNowError : null
              }
              onPayNow={onPayNow}
              onCancel={onCancel}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

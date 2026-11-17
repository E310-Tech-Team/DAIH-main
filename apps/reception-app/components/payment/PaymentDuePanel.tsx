"use client";

import React, { useId } from "react";
import { Info, Wallet } from "lucide-react";
import type { AccessPassDetails, UserRole } from "@daih/types";
import { CollectPaymentFlow } from "./CollectPaymentFlow";
import {
  canRoleRecordPayment,
  describePaymentChoice,
  formatAmountDue,
  type PaymentDue,
} from "./payment-due";

type Props = {
  booking: AccessPassDetails;
  paymentDue: PaymentDue;
  /** The signed-in officer's role: only some roles may take payment. */
  officerRole: UserRole;
  /** Re-verifies the booking by its reference, then shows `notice` on the kiosk. */
  onPaymentConfirmed: (
    bookingReference: string,
    notice: string,
  ) => Promise<void>;
};

/** "Payment due" block on the verification card for an UNPAID booking. */
export function PaymentDuePanel({
  booking,
  paymentDue,
  officerRole,
  onPaymentConfirmed,
}: Props) {
  const headingId = useId();
  const amountLabel = formatAmountDue(paymentDue.amount, paymentDue.currency);
  const canCollect =
    paymentDue.canRecordPayment && canRoleRecordPayment(officerRole);
  // When the API itself won't take payment, its rejection message above already says why
  const needsReceptionOfficer = paymentDue.canRecordPayment && !canCollect;

  const handleConfirmed = (tender: string) =>
    onPaymentConfirmed(
      booking.reference,
      `✓ Payment Recorded: ${booking.customerName} paid ${amountLabel} ${tender}. Booking confirmed — ready for check-in.`,
    );

  return (
    <section
      aria-labelledby={headingId}
      className="p-4 sm:p-5 rounded-xl border-2 border-[#23055c]/25 bg-[#EBE7F5]/50 space-y-4"
    >
      <div>
        <h4
          id={headingId}
          className="text-xs font-bold uppercase tracking-wider text-[#23055c] flex items-center gap-1.5"
        >
          <Wallet className="w-4 h-4" aria-hidden="true" />
          Payment due
        </h4>
        <p className="mt-1 text-3xl font-extrabold leading-tight tabular-nums text-[#181c20]">
          {amountLabel}
        </p>
        <p className="mt-1 text-sm font-semibold text-slate-700">
          {describePaymentChoice(paymentDue.paymentOption)}
        </p>
      </div>

      {canCollect && (
        <CollectPaymentFlow
          bookingId={booking.bookingId}
          amount={paymentDue.amount}
          amountLabel={amountLabel}
          onConfirmed={handleConfirmed}
        />
      )}

      {needsReceptionOfficer && (
        <p className="p-3 rounded-lg bg-white border border-slate-200 text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Info
            className="w-4 h-4 shrink-0 text-[#23055c]"
            aria-hidden="true"
          />
          Ask a reception officer to take payment.
        </p>
      )}
    </section>
  );
}

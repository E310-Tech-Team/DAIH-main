"use client";

import Link from "next/link";
import {
  BankTransferCheckoutResult,
  PaymentOption,
  ReceptionCheckoutResult,
} from "@daih/types";
import { ArrowRight, Store } from "lucide-react";
import { formatLagosDateTime, formatNaira } from "../../lib/paymentFormat";
import { BankTransferDetails } from "./BankTransferDetails";
import { PRIMARY_BUTTON } from "./buttonStyles";
import { useFocusOnMount } from "./useFocusOnMount";

/** Checkout results that are paid outside the app, so the member stays here. */
export type ManualCheckoutResult =
  BankTransferCheckoutResult | ReceptionCheckoutResult;

interface ManualCheckoutConfirmationProps {
  result: ManualCheckoutResult;
}

/**
 * What to do next after choosing bank transfer or pay at reception. Focus
 * moves to the new content because the button the member pressed is gone.
 */
export function ManualCheckoutConfirmation({
  result,
}: ManualCheckoutConfirmationProps) {
  if (result.option === PaymentOption.BANK_TRANSFER) {
    return <BankTransferConfirmation transfer={result} />;
  }
  return <ReceptionConfirmation reception={result} />;
}

function BankTransferConfirmation({
  transfer,
}: {
  transfer: BankTransferCheckoutResult;
}) {
  const focusHeading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <section className="space-y-4 text-left">
      <h3
        ref={focusHeading}
        tabIndex={-1}
        className="text-base font-bold text-slate-900 focus:outline-none"
      >
        Transfer details
      </h3>
      <BankTransferDetails transfer={transfer} />
      <Link href="/bookings" className={`${PRIMARY_BUTTON} w-full`}>
        <span>Done — view my bookings</span>
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

function ReceptionConfirmation({
  reception,
}: {
  reception: ReceptionCheckoutResult;
}) {
  const focusMessage = useFocusOnMount<HTMLParagraphElement>();
  return (
    <section className="space-y-4 text-left">
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <Store
          className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700"
          aria-hidden="true"
        />
        <p
          ref={focusMessage}
          tabIndex={-1}
          className="text-sm font-semibold text-emerald-900 focus:outline-none"
        >
          Reserved. Pay {formatNaira(reception.amount)} at reception before{" "}
          <time dateTime={reception.expiresAt}>
            {formatLagosDateTime(reception.expiresAt)}
          </time>
          .
        </p>
      </div>
      <Link href="/bookings" className={`${PRIMARY_BUTTON} w-full`}>
        <span>View my bookings</span>
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

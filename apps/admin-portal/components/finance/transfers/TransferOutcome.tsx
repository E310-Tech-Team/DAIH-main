"use client";

import React, { useEffect, useId, useRef } from "react";
import type { ManualPaymentOutcome } from "@daih/types";
import { InlineAlert } from "../../common/InlineAlert";
import { PRIMARY_BUTTON } from "../../common/buttonStyles";

interface TransferOutcomeProps {
  outcome: ManualPaymentOutcome;
  onDone: () => void;
}

/** What happened after finance confirmed a transfer: confirmed, or held for reconciliation. */
export function TransferOutcome({ outcome, onDone }: TransferOutcomeProps) {
  const resultId = useId();
  const doneButtonRef = useRef<HTMLButtonElement>(null);

  // The form (and its submit button) is gone: move focus to the result so it is announced.
  useEffect(() => {
    doneButtonRef.current?.focus();
  }, []);

  return (
    <div className="space-y-5">
      <div id={resultId} className="space-y-3">
        {outcome.confirmed ? (
          <InlineAlert tone="success" title="Payment confirmed">
            The booking is confirmed and the member&apos;s QR pass has been
            issued.
          </InlineAlert>
        ) : (
          <InlineAlert tone="warning" title="Held for reconciliation">
            The booking was not confirmed. The payment has been recorded and is
            held for review.
          </InlineAlert>
        )}
        <dl className="space-y-2 rounded-xl border border-[#EBE7F5] bg-[#F8F9FA] p-4 text-sm">
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
              Payment reference
            </dt>
            <dd className="break-all font-mono font-bold text-[#23055c]">
              {outcome.reference}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
              Result
            </dt>
            <dd className="text-slate-800">{outcome.message}</dd>
          </div>
        </dl>
      </div>
      <div className="flex justify-end border-t border-slate-100 pt-4">
        <button
          ref={doneButtonRef}
          type="button"
          onClick={onDone}
          aria-describedby={resultId}
          className={PRIMARY_BUTTON}
        >
          Done
        </button>
      </div>
    </div>
  );
}

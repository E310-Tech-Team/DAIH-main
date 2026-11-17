"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
} from "lucide-react";
import { api, ApiError } from "@daih/api-client";
import {
  PaymentMethod,
  type ManualPaymentOutcome,
  type ReceptionPaymentMethod,
} from "@daih/types";
import {
  RECEIPT_MAX_LENGTH,
  describeTender,
  hasDisallowedReceiptCharacters,
  isValidReceiptNumber,
} from "./payment-due";

type Step =
  | { kind: "choose" }
  | { kind: "receipt" }
  | { kind: "confirm"; method: ReceptionPaymentMethod }
  | { kind: "confirmed" }
  | { kind: "unconfirmed"; outcome: ManualPaymentOutcome };

type Props = {
  bookingId: string;
  /** Exactly what is due: the API refuses any other amount. */
  amount: number;
  /** The amount as the officer sees it, e.g. "₦12,500.00". */
  amountLabel: string;
  /** Runs once the booking is confirmed, with "in cash" or "by POS, receipt N". */
  onConfirmed: (tender: string) => Promise<void>;
};

const DUPLICATE_RECEIPT_CODE = "DUPLICATE_RECEIPT_REFERENCE";
const NETWORK_ERROR_CODE = "NETWORK_ERROR";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#23055c]";
const BUTTON_SHAPE = `px-5 rounded-xl font-bold flex items-center justify-center gap-2 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
const TENDER_BUTTON = `${BUTTON_SHAPE} min-h-[64px] text-base bg-[#23055c] hover:bg-[#392271] text-white shadow-sm`;
const BACK_BUTTON = `${BUTTON_SHAPE} min-h-[52px] text-sm bg-white hover:bg-slate-50 text-slate-800 border-2 border-slate-300`;
const CONTINUE_BUTTON = `${BUTTON_SHAPE} min-h-[52px] flex-1 text-sm bg-[#23055c] hover:bg-[#392271] text-white shadow-sm`;
const CONFIRM_BUTTON = `${BUTTON_SHAPE} min-h-[52px] flex-1 text-sm bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm`;

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === NETWORK_ERROR_CODE) {
    return "Could not reach the server. Check the connection, then try again.";
  }
  if (err instanceof Error && err.message) return err.message;
  return "The payment could not be recorded. Please try again.";
}

function InlineError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="p-3 rounded-xl border border-rose-300 bg-rose-50 text-sm font-medium text-rose-900 flex items-start gap-2"
    >
      <AlertTriangle
        className="w-4 h-4 mt-0.5 shrink-0 text-rose-700"
        aria-hidden="true"
      />
      <span>{message}</span>
    </div>
  );
}

/** Cash or POS collection for one unpaid booking: choose, (receipt), confirm, outcome. */
export function CollectPaymentFlow({
  bookingId,
  amount,
  amountLabel,
  onConfirmed,
}: Props) {
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [receiptNumber, setReceiptNumber] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Blocks a second request even before the disabled button re-renders
  const isRecordingRef = useRef(false);
  const focusTargetRef = useRef<HTMLElement | null>(null);
  const hasNavigatedRef = useRef(false);
  const receiptInputId = useId();
  const receiptHintId = useId();

  // Focus each new step, but not on first render: the USB scanner field keeps focus until the officer acts
  useEffect(() => {
    if (hasNavigatedRef.current) focusTargetRef.current?.focus();
  }, [step.kind]);

  const setFocusTarget = (el: HTMLElement | null) => {
    focusTargetRef.current = el;
  };

  const goTo = (next: Step, nextError: string | null = null) => {
    hasNavigatedRef.current = true;
    setError(nextError);
    setStep(next);
  };

  const handleReceiptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setReceiptNumber(e.target.value);
    setError(null);
  };

  const handleReceiptSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isValidReceiptNumber(receiptNumber)) return;
    goTo({ kind: "confirm", method: PaymentMethod.POS_TERMINAL });
  };

  const handleConfirm = async (method: ReceptionPaymentMethod) => {
    if (isRecordingRef.current) return;
    isRecordingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    const receiptReference = receiptNumber.trim();

    let outcome: ManualPaymentOutcome;
    try {
      outcome = await api.payments.recordReceptionPayment(bookingId, {
        method,
        amountReceived: amount,
        receiptReference:
          method === PaymentMethod.POS_TERMINAL ? receiptReference : undefined,
      });
    } catch (err) {
      isRecordingRef.current = false;
      setIsSubmitting(false);
      const message = getErrorMessage(err);
      // A receipt number already used elsewhere is fixed on the receipt step, value kept
      if (err instanceof ApiError && err.code === DUPLICATE_RECEIPT_CODE) {
        goTo({ kind: "receipt" }, message);
      } else {
        setError(message);
      }
      return;
    }

    // The payment is on record, so the lock stays set: this panel cannot record it twice
    setIsSubmitting(false);
    if (!outcome.confirmed) {
      goTo({ kind: "unconfirmed", outcome });
      return;
    }
    goTo({ kind: "confirmed" });
    await onConfirmed(describeTender(method, receiptReference));
  };

  switch (step.kind) {
    case "choose":
      return (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            Collect exactly{" "}
            <span className="font-bold text-slate-900">{amountLabel}</span>,
            then record how the member paid.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              ref={setFocusTarget}
              type="button"
              onClick={() =>
                goTo({ kind: "confirm", method: PaymentMethod.CASH })
              }
              className={TENDER_BUTTON}
            >
              <Banknote className="w-5 h-5" aria-hidden="true" />
              Took cash
            </button>
            <button
              type="button"
              onClick={() => goTo({ kind: "receipt" })}
              className={TENDER_BUTTON}
            >
              <CreditCard className="w-5 h-5" aria-hidden="true" />
              Took card (POS)
            </button>
          </div>
        </div>
      );

    case "receipt": {
      const hasBadCharacters = hasDisallowedReceiptCharacters(receiptNumber);
      const isFlagged = hasBadCharacters || error !== null;
      return (
        <form onSubmit={handleReceiptSubmit} noValidate className="space-y-3">
          <div>
            <label
              htmlFor={receiptInputId}
              className="block text-sm font-bold text-slate-900"
            >
              POS receipt number
            </label>
            <input
              ref={setFocusTarget}
              id={receiptInputId}
              type="text"
              value={receiptNumber}
              onChange={handleReceiptChange}
              maxLength={RECEIPT_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={receiptHintId}
              aria-invalid={isFlagged}
              className={`mt-1.5 w-full min-h-[52px] px-4 rounded-xl border-2 bg-white text-base font-mono text-slate-900 focus:outline-none focus:ring-2 ${
                isFlagged
                  ? "border-rose-500 focus:border-rose-600 focus:ring-rose-500/30"
                  : "border-slate-300 focus:border-[#23055c] focus:ring-[#23055c]/40"
              }`}
            />
            <p
              id={receiptHintId}
              className={`mt-1.5 text-xs font-medium ${
                hasBadCharacters ? "text-rose-700" : "text-slate-600"
              }`}
            >
              {hasBadCharacters
                ? "Use letters, digits and - _ / . : # only."
                : "As printed on the POS slip: 3 to 100 letters, digits and - _ / . : #"}
            </p>
          </div>
          {error && <InlineError message={error} />}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => goTo({ kind: "choose" })}
              className={BACK_BUTTON}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back
            </button>
            <button
              type="submit"
              disabled={!isValidReceiptNumber(receiptNumber)}
              className={CONTINUE_BUTTON}
            >
              Continue
            </button>
          </div>
        </form>
      );
    }

    case "confirm": {
      const { method } = step;
      const previousStep: Step =
        method === PaymentMethod.POS_TERMINAL
          ? { kind: "receipt" }
          : { kind: "choose" };
      return (
        <div className="space-y-3">
          <p
            ref={setFocusTarget}
            tabIndex={-1}
            className="text-base font-bold text-slate-900 focus:outline-none"
          >
            Confirm you collected {amountLabel}{" "}
            {describeTender(method, receiptNumber.trim())}
          </p>
          {error && <InlineError message={error} />}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => goTo(previousStep)}
              disabled={isSubmitting}
              className={BACK_BUTTON}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm(method)}
              disabled={isSubmitting}
              className={CONFIRM_BUTTON}
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
              )}
              {isSubmitting ? "Recording payment…" : "Confirm"}
            </button>
          </div>
        </div>
      );
    }

    case "confirmed":
      return (
        <div
          role="status"
          className="p-4 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 flex items-start gap-3"
        >
          <CheckCircle2
            className="w-6 h-6 shrink-0 text-emerald-700"
            aria-hidden="true"
          />
          <div>
            <p
              ref={setFocusTarget}
              tabIndex={-1}
              className="text-base font-bold focus:outline-none"
            >
              Payment recorded — booking confirmed
            </p>
            <p className="mt-1 text-sm flex items-center gap-1.5">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Refreshing the booking for check-in…
            </p>
          </div>
        </div>
      );

    case "unconfirmed":
      return (
        <div
          role="alert"
          className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 flex items-start gap-3"
        >
          <AlertTriangle
            className="w-6 h-6 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <div className="space-y-1.5 text-sm">
            <p
              ref={setFocusTarget}
              tabIndex={-1}
              className="text-base font-bold focus:outline-none"
            >
              Payment recorded, but the booking was not confirmed
            </p>
            <p>{step.outcome.message}</p>
            <p>
              Don&apos;t collect payment again. Note payment reference{" "}
              <span className="font-mono font-bold">
                {step.outcome.reference}
              </span>{" "}
              for finance.
            </p>
          </div>
        </div>
      );
  }
}

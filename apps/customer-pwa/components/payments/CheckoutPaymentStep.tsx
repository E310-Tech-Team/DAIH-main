"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import Link from "next/link";
import { api } from "@daih/api-client";
import { AvailablePaymentOption, PaymentOption } from "@daih/types";
import { ArrowRight, LifeBuoy, Loader2, Lock, RefreshCw } from "lucide-react";
import {
  HOLD_LAPSED_MESSAGE,
  getErrorCode,
  getErrorMessage,
} from "../../lib/apiErrors";
import { InlineAlert } from "./InlineAlert";
import {
  ManualCheckoutConfirmation,
  ManualCheckoutResult,
} from "./ManualCheckoutConfirmation";
import {
  PaymentOptionPicker,
  isKnownPaymentOption,
} from "./PaymentOptionPicker";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./buttonStyles";
import { useFocusOnMount } from "./useFocusOnMount";

const OPTIONS_LOAD_ERROR =
  "We couldn't load the ways to pay. Please try again.";
const CHECKOUT_ERROR = "We couldn't start your payment. Please try again.";
const PAYSTACK_REDIRECT_ERROR =
  "We couldn't open the secure payment page. Please try again.";

/** Codes meaning this hold can no longer be paid for: only a new booking helps. */
const CLOSED_BOOKING_CODES: ReadonlySet<string> = new Set([
  "HOLD_LAPSED",
  "INVALID_BOOKING_STATE",
]);

interface SubmitLabel {
  idle: string;
  busy: string;
}

const SUBMIT_LABELS: Readonly<Record<PaymentOption, SubmitLabel>> = {
  [PaymentOption.PAYSTACK]: {
    idle: "Continue to secure payment",
    busy: "Connecting to secure checkout...",
  },
  [PaymentOption.BANK_TRANSFER]: {
    idle: "Get transfer details",
    busy: "Getting transfer details...",
  },
  [PaymentOption.PAY_AT_RECEPTION]: {
    idle: "Reserve and pay at reception",
    busy: "Reserving your booking...",
  },
};

const DEFAULT_SUBMIT_LABEL: SubmitLabel = {
  idle: "Continue",
  busy: "Please wait...",
};

type OptionsState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; options: AvailablePaymentOption[] };

interface CheckoutPaymentStepProps {
  bookingId: string;
  /** The member chose transfer or reception, so the amount must not change any more. */
  onManualCheckoutStarted?: () => void;
  /** The hold can no longer be paid for: take the member back to pick a slot. */
  onBookAgain: () => void;
}

/** Same return page as the original Paystack checkout: /bookings verifies `?reference=`. */
function getPaymentCallbackUrl(): string | undefined {
  return typeof window !== "undefined"
    ? `${window.location.origin}/bookings`
    : undefined;
}

/** Keeps a choice that is still offered, and preselects a lone option. */
function resolveSelection(
  current: PaymentOption | null,
  options: AvailablePaymentOption[],
): PaymentOption | null {
  if (current && options.some((option) => option.option === current)) {
    return current;
  }
  return options.length === 1 ? options[0].option : null;
}

/** The reserved step's "how would you like to pay?" choice and its outcome. */
export function CheckoutPaymentStep({
  bookingId,
  onManualCheckoutStarted,
  onBookAgain,
}: CheckoutPaymentStepProps) {
  const errorId = useId();
  const [optionsRequest, setOptionsRequest] = useState(0);
  const [optionsState, setOptionsState] = useState<OptionsState>({
    status: "loading",
  });
  const [selected, setSelected] = useState<PaymentOption | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [closedMessage, setClosedMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ManualCheckoutResult | null>(null);

  useEffect(() => {
    let isCurrent = true;
    api.payments
      .getOptions()
      .then((response) => {
        if (!isCurrent) return;
        if (!Array.isArray(response?.options)) {
          setOptionsState({ status: "failed", message: OPTIONS_LOAD_ERROR });
          return;
        }
        const options = response.options.filter(isKnownPaymentOption);
        setOptionsState({ status: "ready", options });
        setSelected((current) => resolveSelection(current, options));
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        setOptionsState({
          status: "failed",
          message: getErrorMessage(error, OPTIONS_LOAD_ERROR),
        });
      });
    return () => {
      isCurrent = false;
    };
  }, [optionsRequest]);

  const handleRetryOptions = () => {
    setOptionsState({ status: "loading" });
    setOptionsRequest((count) => count + 1);
  };

  const handleSelect = (option: PaymentOption) => {
    setSelected(option);
    setSubmitError(null);
  };

  const handleCheckoutError = (error: unknown) => {
    const code = getErrorCode(error);
    if (code && CLOSED_BOOKING_CODES.has(code)) {
      setClosedMessage(getErrorMessage(error, HOLD_LAPSED_MESSAGE));
      return;
    }
    setSubmitError(getErrorMessage(error, CHECKOUT_ERROR));
    // The option may have just been switched off: refresh what is offered.
    if (code === "PAYMENT_OPTION_UNAVAILABLE") {
      setOptionsRequest((count) => count + 1);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    if (!selected) {
      setSubmitError("Choose how you'd like to pay.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const checkout = await api.payments.startCheckout(
        bookingId,
        selected,
        getPaymentCallbackUrl(),
      );
      if (checkout.option === PaymentOption.PAYSTACK) {
        if (checkout.authorization_url) {
          window.location.href = checkout.authorization_url;
          return; // Stay busy while the browser leaves for Paystack.
        }
        setSubmitError(PAYSTACK_REDIRECT_ERROR);
      } else if (
        checkout.option === PaymentOption.BANK_TRANSFER ||
        checkout.option === PaymentOption.PAY_AT_RECEPTION
      ) {
        setResult(checkout);
        onManualCheckoutStarted?.();
      } else {
        setSubmitError(CHECKOUT_ERROR);
      }
    } catch (error: unknown) {
      handleCheckoutError(error);
    }
    setIsSubmitting(false);
  };

  if (result) {
    return <ManualCheckoutConfirmation result={result} />;
  }
  if (closedMessage) {
    return (
      <ClosedBookingNotice message={closedMessage} onBookAgain={onBookAgain} />
    );
  }

  const submitLabel = selected ? SUBMIT_LABELS[selected] : DEFAULT_SUBMIT_LABEL;
  const SubmitIcon = selected === PaymentOption.PAYSTACK ? Lock : ArrowRight;

  return (
    <div className="space-y-3 text-left">
      {optionsState.status === "loading" && (
        <p
          role="status"
          className="flex items-center justify-center gap-2 rounded-xl border border-[#EBE7F5] bg-[#faf9ff] p-4 text-sm font-medium text-slate-700"
        >
          <Loader2
            className="h-4 w-4 animate-spin text-[#23055c]"
            aria-hidden="true"
          />
          <span>Loading ways to pay...</span>
        </p>
      )}

      {optionsState.status === "failed" && (
        <>
          <InlineAlert message={optionsState.message} />
          <button
            type="button"
            onClick={handleRetryOptions}
            className={`${SECONDARY_BUTTON} w-full`}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>Try again</span>
          </button>
        </>
      )}

      {optionsState.status === "ready" && optionsState.options.length === 0 && (
        <>
          <InlineAlert
            tone="warning"
            role="status"
            message="Online payment is temporarily unavailable. Please contact support."
          />
          <Link href="/support" className={`${SECONDARY_BUTTON} w-full`}>
            <LifeBuoy className="h-4 w-4" aria-hidden="true" />
            <span>Contact support</span>
          </Link>
        </>
      )}

      {optionsState.status === "ready" && optionsState.options.length > 0 && (
        <form onSubmit={handleSubmit} noValidate className="space-y-3">
          <PaymentOptionPicker
            options={optionsState.options}
            selected={selected}
            onSelect={handleSelect}
            errorId={submitError ? errorId : undefined}
          />
          {submitError && <InlineAlert id={errorId} message={submitError} />}
          <button
            type="submit"
            aria-disabled={isSubmitting}
            className={`${PRIMARY_BUTTON} w-full`}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <SubmitIcon className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{isSubmitting ? submitLabel.busy : submitLabel.idle}</span>
          </button>
        </form>
      )}

      <Link href="/bookings" className={`${SECONDARY_BUTTON} w-full`}>
        View in My Bookings
      </Link>
    </div>
  );
}

interface ClosedBookingNoticeProps {
  message: string;
  onBookAgain: () => void;
}

/** The hold lapsed (or the booking changed state) before payment could start. */
function ClosedBookingNotice({
  message,
  onBookAgain,
}: ClosedBookingNoticeProps) {
  const focusBookAgain = useFocusOnMount<HTMLButtonElement>();
  return (
    <div className="space-y-3 text-left">
      <InlineAlert tone="warning" message={message} />
      <button
        ref={focusBookAgain}
        type="button"
        onClick={onBookAgain}
        className={`${PRIMARY_BUTTON} w-full`}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        <span>Book again</span>
      </button>
      <Link href="/bookings" className={`${SECONDARY_BUTTON} w-full`}>
        View in My Bookings
      </Link>
    </div>
  );
}

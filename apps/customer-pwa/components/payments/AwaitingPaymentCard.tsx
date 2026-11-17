"use client";

import { ReactNode, useEffect, useId, useState } from "react";
import Link from "next/link";
import { api } from "@daih/api-client";
import {
  BankTransferCheckoutResult,
  BookingSummary,
  PaymentOption,
} from "@daih/types";
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  ChevronDown,
  Clock,
  CreditCard,
  Hourglass,
  Landmark,
  Loader2,
  Store,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  HOLD_LAPSED_MESSAGE,
  getErrorMessage,
  isHoldLapsedError,
} from "../../lib/apiErrors";
import { getAmountDue, getHoldDeadlineMs } from "../../lib/awaitingPayment";
import {
  formatLagosDateTime,
  formatLagosSessionWindow,
  formatNaira,
} from "../../lib/paymentFormat";
import { BankTransferDetails } from "./BankTransferDetails";
import { InlineAlert } from "./InlineAlert";
import {
  DANGER_BUTTON,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from "./buttonStyles";

/** setTimeout's ceiling (about 24.8 days); no hold runs that long. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const TRANSFER_DETAILS_ERROR =
  "We couldn't load the transfer details. Please try again.";

/** A failed "Pay now" for one booking, shown on that booking's card. */
export interface PayNowError {
  bookingId: string;
  message: string;
  /** HOLD_LAPSED: the hold ran out, so only a new booking helps. */
  isHoldLapsed: boolean;
}

interface OptionPresentation {
  badge: string;
  deadlineLabel: string;
  Icon: LucideIcon;
}

const OPTION_PRESENTATION: Readonly<Record<PaymentOption, OptionPresentation>> =
  {
    [PaymentOption.PAYSTACK]: {
      badge: "Online payment",
      deadlineLabel: "Pay by",
      Icon: CreditCard,
    },
    [PaymentOption.BANK_TRANSFER]: {
      badge: "Bank transfer",
      deadlineLabel: "Transfer by",
      Icon: Landmark,
    },
    [PaymentOption.PAY_AT_RECEPTION]: {
      badge: "Pay at reception",
      deadlineLabel: "Pay at reception by",
      Icon: Store,
    },
  };

interface AwaitingPaymentCardProps {
  booking: BookingSummary;
  isPaying: boolean;
  payNowError: PayNowError | null;
  onPayNow: (bookingId: string) => void;
  onCancel: (bookingId: string) => void;
}

/** One unpaid booking: what is owed, by when, and how to pay or cancel it. */
export function AwaitingPaymentCard({
  booking,
  isPaying,
  payNowError,
  onPayNow,
  onCancel,
}: AwaitingPaymentCardProps) {
  const titleId = useId();
  const deadlineMs = getHoldDeadlineMs(booking);
  const [hasHoldLapsed, setHasHoldLapsed] = useState(false);
  const [lapsedApiMessage, setLapsedApiMessage] = useState<string | null>(null);

  // Swap the payment actions for "Book again" the moment the hold lapses.
  useEffect(() => {
    if (deadlineMs === null) return;
    const msLeft = deadlineMs - Date.now();
    if (msLeft > MAX_TIMER_DELAY_MS) return;
    const timer = setTimeout(() => setHasHoldLapsed(true), Math.max(0, msLeft));
    return () => clearTimeout(timer);
  }, [deadlineMs]);

  const presentation: OptionPresentation | undefined = booking.paymentOption
    ? OPTION_PRESENTATION[booking.paymentOption]
    : undefined;
  const BadgeIcon = presentation?.Icon;
  const deadlineIso = booking.holdExpiresAt ?? "";
  const lapsedNotice = payNowError?.isHoldLapsed
    ? payNowError.message
    : (lapsedApiMessage ?? (hasHoldLapsed ? HOLD_LAPSED_MESSAGE : null));

  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-xl border border-[#EBE7F5] border-l-4 border-l-amber-400 bg-white p-5 shadow-sm"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm text-slate-600">
            {booking.reference}
          </p>
          <h3
            id={titleId}
            className="break-words text-base font-bold text-slate-900"
          >
            {booking.resourceName}
          </h3>
        </div>
        {presentation && BadgeIcon && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#23055c]/15 bg-[#ebe7f5] px-2.5 py-1 text-sm font-semibold text-[#23055c]">
            <BadgeIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {presentation.badge}
          </span>
        )}
      </header>

      <dl className="space-y-2.5 rounded-xl border border-[#EBE7F5] bg-[#faf9ff] p-4 text-sm">
        <DetailRow
          Icon={Calendar}
          label="When"
          value={formatLagosSessionWindow(booking.startTime, booking.endTime)}
        />
        <DetailRow
          Icon={Wallet}
          label="Amount due"
          value={formatNaira(getAmountDue(booking))}
          isEmphasized
        />
        <DetailRow
          Icon={Clock}
          label={presentation?.deadlineLabel ?? "Pay by"}
          value={
            <time dateTime={deadlineIso}>
              {formatLagosDateTime(deadlineIso)}
            </time>
          }
        />
      </dl>

      {lapsedNotice ? (
        <div className="space-y-3">
          <InlineAlert tone="warning" role="status" message={lapsedNotice} />
          <Link href="/book" className={`${PRIMARY_BUTTON} w-full`}>
            <span>Book again</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <PaymentActions
          booking={booking}
          isPaying={isPaying}
          payNowError={payNowError}
          onPayNow={onPayNow}
          onCancel={onCancel}
          onHoldLapsed={setLapsedApiMessage}
        />
      )}
    </article>
  );
}

interface PaymentActionsProps {
  booking: BookingSummary;
  isPaying: boolean;
  payNowError: PayNowError | null;
  onPayNow: (bookingId: string) => void;
  onCancel: (bookingId: string) => void;
  onHoldLapsed: (message: string) => void;
}

/** What the member can do next, which depends on how they chose to pay. */
function PaymentActions({
  booking,
  isPaying,
  payNowError,
  onPayNow,
  onCancel,
  onHoldLapsed,
}: PaymentActionsProps) {
  const cancelButton = (
    <button
      type="button"
      onClick={() => onCancel(booking.id)}
      className={DANGER_BUTTON}
    >
      Cancel booking
    </button>
  );

  switch (booking.paymentOption) {
    case PaymentOption.BANK_TRANSFER:
      return (
        <BankTransferActions
          bookingId={booking.id}
          cancelButton={cancelButton}
          onHoldLapsed={onHoldLapsed}
        />
      );
    case PaymentOption.PAY_AT_RECEPTION: {
      const deadlineIso = booking.holdExpiresAt ?? "";
      return (
        <div className="space-y-3">
          <StatusLine Icon={Store} tone="text-slate-800">
            Pay {formatNaira(getAmountDue(booking))} at reception before{" "}
            <time dateTime={deadlineIso}>
              {formatLagosDateTime(deadlineIso)}
            </time>
          </StatusLine>
          <div className="flex flex-wrap gap-2">{cancelButton}</div>
        </div>
      );
    }
    default:
      return (
        <div className="space-y-3">
          <StatusLine Icon={AlertCircle} tone="text-rose-700">
            Payment not completed
          </StatusLine>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (!isPaying) onPayNow(booking.id);
              }}
              aria-disabled={isPaying}
              className={`${PRIMARY_BUTTON} flex-1`}
            >
              {isPaying ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CreditCard className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{isPaying ? "Connecting..." : "Pay now"}</span>
            </button>
            {cancelButton}
          </div>
          {payNowError && <InlineAlert message={payNowError.message} />}
        </div>
      );
  }
}

interface BankTransferActionsProps {
  bookingId: string;
  cancelButton: ReactNode;
  onHoldLapsed: (message: string) => void;
}

/** "Awaiting transfer confirmation", with the transfer details on demand. */
function BankTransferActions({
  bookingId,
  cancelButton,
  onHoldLapsed,
}: BankTransferActionsProps) {
  const panelId = useId();
  const [transfer, setTransfer] = useState<BankTransferCheckoutResult | null>(
    null,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async () => {
    if (isLoading) return;
    if (transfer) {
      setIsOpen((open) => !open);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      // Asking again returns the same reference and deadline; it never extends the hold.
      const result = await api.payments.startCheckout(
        bookingId,
        PaymentOption.BANK_TRANSFER,
      );
      if (result.option === PaymentOption.BANK_TRANSFER) {
        setTransfer(result);
        setIsOpen(true);
      } else {
        setError(TRANSFER_DETAILS_ERROR);
      }
    } catch (caught: unknown) {
      if (isHoldLapsedError(caught)) {
        onHoldLapsed(getErrorMessage(caught, HOLD_LAPSED_MESSAGE));
      } else {
        setError(getErrorMessage(caught, TRANSFER_DETAILS_ERROR));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <StatusLine Icon={Hourglass} tone="text-amber-800">
        Awaiting transfer confirmation
      </StatusLine>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleToggle()}
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-disabled={isLoading}
          className={`${SECONDARY_BUTTON} flex-1`}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ChevronDown
              className={`h-4 w-4 transition-transform motion-reduce:transition-none ${
                isOpen ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            />
          )}
          <span>
            {isOpen ? "Hide transfer details" : "Show transfer details"}
          </span>
        </button>
        {cancelButton}
      </div>
      {error && <InlineAlert message={error} />}
      <div id={panelId} hidden={!isOpen}>
        {transfer && <BankTransferDetails transfer={transfer} />}
      </div>
    </div>
  );
}

interface StatusLineProps {
  Icon: LucideIcon;
  /** Text colour class, e.g. "text-amber-800". */
  tone: string;
  children: ReactNode;
}

function StatusLine({ Icon, tone, children }: StatusLineProps) {
  return (
    <p className={`flex items-start gap-2 text-sm font-semibold ${tone}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

interface DetailRowProps {
  Icon: LucideIcon;
  label: string;
  value: ReactNode;
  isEmphasized?: boolean;
}

function DetailRow({
  Icon,
  label,
  value,
  isEmphasized = false,
}: DetailRowProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="flex shrink-0 items-center gap-2 text-slate-600">
        <Icon className="h-4 w-4 text-[#23055c]" aria-hidden="true" />
        {label}
      </dt>
      <dd
        className={`min-w-0 text-right ${
          isEmphasized
            ? "font-extrabold text-[#23055c]"
            : "font-semibold text-slate-900"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

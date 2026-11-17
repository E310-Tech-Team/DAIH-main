"use client";

import { useId } from "react";
import { AvailablePaymentOption, PaymentOption } from "@daih/types";
import { CreditCard, Landmark, Store, type LucideIcon } from "lucide-react";

const KNOWN_OPTIONS: ReadonlySet<string> = new Set(
  Object.values(PaymentOption),
);

/** Drops options this version of the app does not know how to offer. */
export function isKnownPaymentOption(
  option: AvailablePaymentOption | null | undefined,
): option is AvailablePaymentOption {
  return Boolean(option && KNOWN_OPTIONS.has(option.option));
}

interface PaymentOptionCopy {
  title: string;
  description: string;
  Icon: LucideIcon;
}

function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function describePaymentOption(
  option: AvailablePaymentOption,
): PaymentOptionCopy {
  switch (option.option) {
    case PaymentOption.PAYSTACK:
      return {
        title: "Pay online now",
        description:
          "Card, bank transfer or USSD through Paystack. Confirmed instantly.",
        Icon: CreditCard,
      };
    case PaymentOption.BANK_TRANSFER:
      return {
        title: "Bank transfer",
        description: `Transfer to DAIH's account. We confirm it within ${pluralize(option.transferWindowHours, "hour")} and hold your booking until then.`,
        Icon: Landmark,
      };
    case PaymentOption.PAY_AT_RECEPTION:
      return {
        title: "Pay at reception",
        description:
          option.graceMinutes > 0
            ? `Pay cash or card when you arrive. We hold your booking until ${pluralize(option.graceMinutes, "minute")} after it starts.`
            : "Pay cash or card when you arrive. We hold your booking until it starts.",
        Icon: Store,
      };
  }
}

interface PaymentOptionPickerProps {
  options: AvailablePaymentOption[];
  selected: PaymentOption | null;
  onSelect: (option: PaymentOption) => void;
  /** Id of an error message about the choice, read out with the group. */
  errorId?: string;
}

/**
 * A native radio group: arrow keys move between options, and screen readers
 * announce the legend, each option's name and its description.
 */
export function PaymentOptionPicker({
  options,
  selected,
  onSelect,
  errorId,
}: PaymentOptionPickerProps) {
  const groupName = useId();

  return (
    <fieldset aria-describedby={errorId} className="min-w-0 space-y-3">
      <legend className="text-sm font-bold text-slate-900">
        How would you like to pay?
      </legend>
      <div className="space-y-2.5">
        {options.map((option) => {
          const { title, description, Icon } = describePaymentOption(option);
          const isSelected = selected === option.option;
          const inputId = `${groupName}-${option.option}`;
          const titleId = `${inputId}-title`;
          const descriptionId = `${inputId}-description`;

          return (
            <label
              key={option.option}
              htmlFor={inputId}
              className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#23055c] has-[:focus-visible]:ring-offset-2 ${
                isSelected
                  ? "border-[#23055c] bg-[#ebe7f5]/60 ring-1 ring-[#23055c]"
                  : "border-[#EBE7F5] bg-white hover:border-[#23055c]/40"
              }`}
            >
              <input
                id={inputId}
                type="radio"
                name={groupName}
                value={option.option}
                checked={isSelected}
                onChange={() => onSelect(option.option)}
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[#23055c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#23055c]"
              />
              <span
                aria-hidden="true"
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  isSelected
                    ? "bg-[#23055c] text-white"
                    : "bg-[#ebe7f5] text-[#23055c]"
                }`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span
                  id={titleId}
                  className="block text-sm font-bold text-slate-900"
                >
                  {title}
                </span>
                <span
                  id={descriptionId}
                  className="mt-0.5 block text-sm text-slate-600"
                >
                  {description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

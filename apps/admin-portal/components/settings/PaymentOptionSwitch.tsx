"use client";

import React from "react";
import { cn } from "@daih/ui";

interface PaymentOptionSwitchProps {
  id: string;
  label: string;
  description: string;
  isOn: boolean;
  isDisabled?: boolean;
  onChange: (isOn: boolean) => void;
  /** Extra content under the description, e.g. a configuration warning. */
  children?: React.ReactNode;
}

/** An on/off row for one checkout option: a labelled `role="switch"` button. */
export function PaymentOptionSwitch({
  id,
  label,
  description,
  isOn,
  isDisabled = false,
  onChange,
  children,
}: PaymentOptionSwitchProps) {
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;

  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 space-y-1">
        <label
          id={labelId}
          htmlFor={id}
          className={cn(
            "text-sm font-bold text-slate-900",
            isDisabled ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          {label}
        </label>
        <p id={descriptionId} className="text-sm text-slate-600">
          {description}
        </p>
        {children}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        disabled={isDisabled}
        onClick={() => onChange(!isOn)}
        className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 rounded-xl px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#23055c] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className={cn(
            "w-7 text-right text-xs font-bold",
            isOn ? "text-[#23055c]" : "text-slate-600",
          )}
        >
          {isOn ? "On" : "Off"}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "relative inline-block h-6 w-11 rounded-full transition-colors",
            isOn ? "bg-[#23055c]" : "bg-slate-500",
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none",
              isOn ? "translate-x-5" : "translate-x-0",
            )}
          />
        </span>
      </button>
    </div>
  );
}

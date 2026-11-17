import React from "react";
import { BookingState } from "@daih/types";
import { cn } from "@daih/ui";

const AMBER = "border-amber-200 bg-amber-50 text-amber-800";
const ROSE = "border-rose-200 bg-rose-50 text-rose-700";
const PURPLE = "border-purple-200 bg-purple-50 text-[#23055c]";
const BLUE = "border-blue-200 bg-blue-50 text-blue-700";
const EMERALD = "border-emerald-200 bg-emerald-50 text-emerald-800";
const SLATE = "border-slate-200 bg-slate-100 text-slate-700";

const STATE_STYLES: Readonly<Record<string, string>> = {
  [BookingState.HELD]: AMBER,
  [BookingState.PENDING_PAYMENT]: AMBER,
  [BookingState.REFUND_PENDING]: AMBER,
  [BookingState.CONFIRMED]: PURPLE,
  [BookingState.COMPLETED]: PURPLE,
  [BookingState.ACTIVE]: EMERALD,
  [BookingState.CHECKED_IN]: BLUE,
  [BookingState.CHECKED_OUT]: BLUE,
  [BookingState.EXPIRED]: ROSE,
  [BookingState.CANCELLED]: ROSE,
  [BookingState.NO_SHOW]: ROSE,
};

interface BookingStateBadgeProps {
  state: string;
}

/** The booking's current state, as a small badge (e.g. "PENDING PAYMENT"). */
export function BookingStateBadge({ state }: BookingStateBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        STATE_STYLES[state] ?? SLATE,
      )}
    >
      <span className="sr-only">Booking state: </span>
      {state.replace(/_/g, " ")}
    </span>
  );
}

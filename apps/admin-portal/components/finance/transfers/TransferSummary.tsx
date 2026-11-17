import React from "react";
import type { PendingBankTransfer } from "@daih/types";
import {
  formatLagosDate,
  formatLagosTime,
  formatNaira,
} from "../../../lib/formatters";
import { BookingStateBadge } from "./BookingStateBadge";

interface TransferSummaryProps {
  transfer: PendingBankTransfer;
}

/** What finance needs to match a transfer against the bank statement. */
export function TransferSummary({ transfer }: TransferSummaryProps) {
  const { member, booking } = transfer;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-3 rounded-xl border border-[#EBE7F5] bg-[#F8F9FA] p-4 text-sm sm:grid-cols-2">
      <SummaryItem label="Payment reference">
        <span className="break-all font-mono font-bold text-[#23055c]">
          {transfer.reference}
        </span>
      </SummaryItem>
      <SummaryItem label="Amount due">
        <span className="text-base font-extrabold text-slate-900">
          {formatNaira(transfer.amount)}
        </span>
      </SummaryItem>
      <SummaryItem label="Member">
        <span className="font-semibold text-slate-900">{member.name}</span>
        <span className="block font-mono text-xs text-slate-600">
          {member.clientId}
        </span>
      </SummaryItem>
      <SummaryItem label="Booking">
        <span className="font-semibold text-slate-900">
          {booking.resourceName}
        </span>
        <span className="block text-slate-700">
          {formatLagosDate(booking.startTime)} at{" "}
          {formatLagosTime(booking.startTime)}
        </span>
        <span className="mt-1 block">
          <BookingStateBadge state={booking.state} />
        </span>
      </SummaryItem>
    </dl>
  );
}

function SummaryItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
        {label}
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

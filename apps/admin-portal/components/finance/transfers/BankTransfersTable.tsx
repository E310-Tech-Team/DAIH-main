"use client";

import React from "react";
import { Inbox } from "lucide-react";
import type { PendingBankTransfer } from "@daih/types";
import {
  DANGER_OUTLINE_BUTTON,
  PRIMARY_BUTTON,
} from "../../common/buttonStyles";
import {
  formatLagosDate,
  formatLagosDateTime,
  formatLagosTime,
  formatNaira,
} from "../../../lib/formatters";
import { BookingStateBadge } from "./BookingStateBadge";

const SKELETON_ROW_COUNT = 4;
const HEADER_CELL = "px-4 py-3";

interface BankTransfersTableProps {
  transfers: PendingBankTransfer[];
  isLoading: boolean;
  /** Show the Confirm / Reject actions. */
  isActionable: boolean;
  emptyMessage: string;
  /** Rows for the signed-in staff member's own bookings are flagged: they cannot confirm them. */
  currentUserId?: string;
  onConfirm: (transfer: PendingBankTransfer) => void;
  onReject: (transfer: PendingBankTransfer) => void;
}

export function BankTransfersTable({
  transfers,
  isLoading,
  isActionable,
  emptyMessage,
  currentUserId,
  onConfirm,
  onReject,
}: BankTransfersTableProps) {
  const columnCount = isActionable ? 7 : 6;

  let body: React.ReactNode;
  if (isLoading) {
    body = <SkeletonRows columnCount={columnCount} />;
  } else if (transfers.length === 0) {
    body = <EmptyRow columnCount={columnCount} message={emptyMessage} />;
  } else {
    body = transfers.map((transfer) => (
      <TransferRow
        key={transfer.transactionId}
        transfer={transfer}
        isActionable={isActionable}
        isOwnBooking={!!currentUserId && transfer.member.id === currentUserId}
        onConfirm={onConfirm}
        onReject={onReject}
      />
    ));
  }

  return (
    <div
      role="region"
      aria-label="Bank transfers table"
      tabIndex={0}
      className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#23055c]"
    >
      <table
        aria-busy={isLoading}
        className="w-full min-w-[1000px] border-collapse text-left text-xs"
      >
        <caption className="sr-only">
          Bank transfers. Times are Lagos time (WAT).
        </caption>
        <thead>
          <tr className="border-b border-[#EBE7F5] bg-[#F8F9FA] text-[11px] font-extrabold uppercase tracking-wide text-slate-600">
            <th scope="col" className={HEADER_CELL}>
              Reference
            </th>
            <th scope="col" className={HEADER_CELL}>
              Member
            </th>
            <th scope="col" className={HEADER_CELL}>
              Booking
            </th>
            <th scope="col" className={`${HEADER_CELL} text-right`}>
              Amount
            </th>
            <th scope="col" className={HEADER_CELL}>
              Created
            </th>
            <th scope="col" className={HEADER_CELL}>
              Holds until
            </th>
            {isActionable && (
              <th scope="col" className={`${HEADER_CELL} text-right`}>
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#EBE7F5]">{body}</tbody>
      </table>
    </div>
  );
}

interface TransferRowProps {
  transfer: PendingBankTransfer;
  isActionable: boolean;
  isOwnBooking: boolean;
  onConfirm: (transfer: PendingBankTransfer) => void;
  onReject: (transfer: PendingBankTransfer) => void;
}

function TransferRow({
  transfer,
  isActionable,
  isOwnBooking,
  onConfirm,
  onReject,
}: TransferRowProps) {
  const { member, booking } = transfer;

  return (
    <tr className="align-top transition-colors hover:bg-slate-50/75">
      <th scope="row" className="px-4 py-4 text-left font-normal">
        <span className="break-all font-mono text-xs font-bold text-[#23055c]">
          {transfer.reference}
        </span>
      </th>
      <td className="px-4 py-4">
        <p className="font-bold text-slate-900">{member.name}</p>
        <p className="font-mono text-[11px] text-slate-600">
          {member.clientId}
        </p>
        <p className="break-all text-slate-600">{member.email}</p>
        {isOwnBooking && (
          <span className="mt-1.5 inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
            Your booking
          </span>
        )}
      </td>
      <td className="px-4 py-4">
        <p className="font-bold text-slate-900">{booking.resourceName}</p>
        <p className="text-slate-700">
          {formatLagosDate(booking.startTime)} ·{" "}
          {formatLagosTime(booking.startTime)}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-slate-600">
            {booking.reference}
          </span>
          <BookingStateBadge state={booking.state} />
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-extrabold text-slate-900">
        {formatNaira(transfer.amount)}
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-slate-700">
        {formatLagosDateTime(transfer.createdAt)}
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-slate-700">
        {transfer.expiresAt
          ? formatLagosDateTime(transfer.expiresAt)
          : "No hold"}
      </td>
      {isActionable && (
        <td className="px-4 py-4">
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => onConfirm(transfer)}
              className={PRIMARY_BUTTON}
            >
              Confirm received
              <span className="sr-only"> for {transfer.reference}</span>
            </button>
            <button
              type="button"
              onClick={() => onReject(transfer)}
              className={DANGER_OUTLINE_BUTTON}
            >
              Reject
              <span className="sr-only"> transfer {transfer.reference}</span>
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

function SkeletonRows({ columnCount }: { columnCount: number }) {
  const rows = Array.from({ length: SKELETON_ROW_COUNT }, (_, row) => row);
  const cells = Array.from({ length: columnCount }, (_, cell) => cell);
  return (
    <>
      {rows.map((row) => (
        <tr key={row} aria-hidden="true" className="animate-pulse">
          {cells.map((cell) => (
            <td key={cell} className="px-4 py-5">
              <div className="h-3.5 w-24 rounded bg-slate-200" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function EmptyRow({
  columnCount,
  message,
}: {
  columnCount: number;
  message: string;
}) {
  return (
    <tr>
      <td colSpan={columnCount} className="px-4 py-14 text-center">
        <Inbox
          aria-hidden="true"
          className="mx-auto mb-2 h-8 w-8 text-slate-400"
        />
        <p className="text-sm font-bold text-slate-800">{message}</p>
      </td>
    </tr>
  );
}

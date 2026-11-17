"use client";

import { useEffect, useRef, useState } from "react";
import { BankTransferCheckoutResult } from "@daih/types";
import { Check, Clock, Copy } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import {
  formatAmountForCopy,
  formatLagosDateTime,
  formatNaira,
} from "../../lib/paymentFormat";
import { FOCUS_RING } from "./buttonStyles";

const COPIED_RESET_MS = 2500;

/** What a member needs to make the transfer. */
export type BankTransferInstructions = Pick<
  BankTransferCheckoutResult,
  "amount" | "reference" | "expiresAt" | "bankAccount"
>;

type CopyField =
  "amount" | "bankName" | "accountNumber" | "accountName" | "reference";

interface CopyTarget {
  field: CopyField;
  /** Lower-case name used in "Copy account number" and the announcement. */
  label: string;
  value: string;
}

interface BankTransferDetailsProps {
  transfer: BankTransferInstructions;
}

export function BankTransferDetails({ transfer }: BankTransferDetailsProps) {
  const { amount, reference, expiresAt, bankAccount } = transfer;
  const [copiedField, setCopiedField] = useState<CopyField | null>(null);
  const [hasCopyFailed, setHasCopyFailed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const handleCopy = async ({ field, label, value }: CopyTarget) => {
    const isCopied = await copyTextToClipboard(value);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setCopiedField(isCopied ? field : null);
    setHasCopyFailed(!isCopied);
    setAnnouncement(isCopied ? `Copied ${label}` : `Couldn't copy ${label}`);
    // Clearing the message lets a second copy of the same value be announced.
    resetTimerRef.current = setTimeout(() => {
      setCopiedField(null);
      setAnnouncement("");
    }, COPIED_RESET_MS);
  };

  const accountRows: Array<CopyTarget & { title: string; isMono?: boolean }> = [
    {
      field: "bankName",
      title: "Bank",
      label: "bank name",
      value: bankAccount.bankName,
    },
    {
      field: "accountNumber",
      title: "Account number",
      label: "account number",
      value: bankAccount.accountNumber,
      isMono: true,
    },
    {
      field: "accountName",
      title: "Account name",
      label: "account name",
      value: bankAccount.accountName,
    },
  ];

  return (
    <div className="space-y-3 text-left">
      <div className="rounded-xl border border-[#EBE7F5] bg-[#faf9ff] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-600">
              Amount to transfer
            </p>
            <p className="text-2xl font-extrabold tracking-tight text-[#23055c]">
              {formatNaira(amount)}
            </p>
          </div>
          <CopyButton
            label="amount"
            isCopied={copiedField === "amount"}
            onCopy={() =>
              void handleCopy({
                field: "amount",
                label: "amount",
                value: formatAmountForCopy(amount),
              })
            }
          />
        </div>
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-amber-800">
          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Transfer by{" "}
            <time dateTime={expiresAt}>{formatLagosDateTime(expiresAt)}</time>
          </span>
        </p>
      </div>

      <dl className="divide-y divide-[#EBE7F5] rounded-xl border border-[#EBE7F5] bg-white">
        {accountRows.map((row) => (
          <div key={row.field} className="px-4 py-3">
            <dt className="text-sm font-medium text-slate-600">{row.title}</dt>
            <dd className="mt-0.5 flex items-center justify-between gap-3">
              <span
                className={`min-w-0 select-all break-words font-bold text-slate-900 ${
                  row.isMono ? "font-mono text-base tracking-wider" : "text-sm"
                }`}
              >
                {row.value}
              </span>
              <CopyButton
                label={row.label}
                isCopied={copiedField === row.field}
                onCopy={() => void handleCopy(row)}
              />
            </dd>
          </div>
        ))}
      </dl>

      <div className="rounded-xl border-2 border-[#23055c] bg-[#ebe7f5] p-4">
        <p className="text-sm font-bold text-[#23055c]">Payment reference</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 select-all break-all font-mono text-lg font-extrabold tracking-wider text-[#23055c] sm:text-2xl">
            {reference}
          </p>
          <CopyButton
            label="payment reference"
            isCopied={copiedField === "reference"}
            onCopy={() =>
              void handleCopy({
                field: "reference",
                label: "payment reference",
                value: reference,
              })
            }
          />
        </div>
        <p className="mt-3 text-sm text-slate-800">
          Put <strong className="font-mono font-bold">{reference}</strong> in
          the transfer description so we can match your payment. Your booking is
          confirmed once our team sees the money in our account.
        </p>
      </div>

      {hasCopyFailed && (
        <p className="text-sm font-medium text-rose-700">
          Couldn&apos;t copy automatically. Select the text and copy it instead.
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

interface CopyButtonProps {
  label: string;
  isCopied: boolean;
  onCopy: () => void;
}

function CopyButton({ label, isCopied, onCopy }: CopyButtonProps) {
  const Icon = isCopied ? Check : Copy;
  return (
    <button
      type="button"
      onClick={onCopy}
      className={`inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[#23055c]/25 bg-white px-3 text-sm font-bold text-[#23055c] transition-colors hover:bg-[#ebe7f5] ${FOCUS_RING}`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{isCopied ? "Copied" : "Copy"}</span>
      <span className="sr-only">{` ${label}`}</span>
    </button>
  );
}

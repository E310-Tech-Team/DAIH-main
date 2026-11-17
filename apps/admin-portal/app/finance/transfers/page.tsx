"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Landmark, RefreshCw, Search, Wallet } from "lucide-react";
import { cn, useToast } from "@daih/ui";
import { api, useAuth } from "@daih/api-client";
import { PaymentStatus, type PendingBankTransfer } from "@daih/types";
import {
  BankTransfersTable,
  ConfirmTransferModal,
  RejectTransferModal,
  TransferStatusTabs,
  TRANSFER_TABS,
  matchesTransferSearch,
  transferTabId,
  type TransferListStatus,
} from "../../../components/finance/transfers";
import { INPUT_CLASS } from "../../../components/common/FormField";
import { InlineAlert } from "../../../components/common/InlineAlert";
import { SECONDARY_BUTTON } from "../../../components/common/buttonStyles";
import { apiErrorMessage } from "../../../lib/api-errors";
import { hasRouteAccess } from "../../../lib/rbac";

const PANEL_ID = "bank-transfers-panel";
const SEARCH_INPUT_ID = "bank-transfers-search";

function countLabel(visible: number, total: number, query: string): string {
  const noun = total === 1 ? "transfer" : "transfers";
  if (query.trim() === "") return `${total} ${noun}`;
  return `${visible} of ${total} ${noun} match “${query.trim()}”`;
}

export default function BankTransfersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [activeStatus, setActiveStatus] = useState<TransferListStatus>(
    PaymentStatus.PENDING,
  );
  const [transfers, setTransfers] = useState<PendingBankTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [confirmTarget, setConfirmTarget] =
    useState<PendingBankTransfer | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingBankTransfer | null>(
    null,
  );
  // Only the latest request may update the list (switching tabs quickly).
  const latestRequestId = useRef(0);

  const loadTransfers = useCallback(async () => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setIsLoading(true);
    setLoadError(null);
    try {
      const rows = await api.payments.listBankTransfers(activeStatus);
      if (requestId === latestRequestId.current) setTransfers(rows);
    } catch (err: unknown) {
      if (requestId === latestRequestId.current) {
        setTransfers([]);
        setLoadError(apiErrorMessage(err, "Could not load bank transfers."));
      }
    } finally {
      if (requestId === latestRequestId.current) setIsLoading(false);
    }
  }, [activeStatus]);

  useEffect(() => {
    void loadTransfers();
  }, [loadTransfers]);

  const activeTab =
    TRANSFER_TABS.find((tab) => tab.status === activeStatus) ??
    TRANSFER_TABS[0];
  const visibleTransfers = transfers.filter((transfer) =>
    matchesTransferSearch(transfer, search),
  );
  const canViewPaymentMethods = hasRouteAccess(
    user?.role,
    "/settings/payments",
  );

  const handleRejected = (transfer: PendingBankTransfer) => {
    setRejectTarget(null);
    toast.success(`Transfer ${transfer.reference} has been rejected.`, {
      title: "Transfer rejected",
    });
    void loadTransfers();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-[#23055c] shadow-xs">
            <Landmark aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
              Bank transfers
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Members pay into the hub&apos;s account and quote their payment
              reference. Match each transfer against the bank statement before
              confirming it.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canViewPaymentMethods && (
            <Link href="/settings/payments" className={SECONDARY_BUTTON}>
              <Wallet aria-hidden="true" className="h-4 w-4 text-[#23055c]" />
              Payment methods
            </Link>
          )}
          <button
            type="button"
            onClick={() => void loadTransfers()}
            disabled={isLoading}
            className={SECONDARY_BUTTON}
          >
            <RefreshCw
              aria-hidden="true"
              className={cn(
                "h-4 w-4 text-[#23055c]",
                isLoading && "animate-spin",
              )}
            />
            Refresh
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TransferStatusTabs
            tabs={TRANSFER_TABS}
            activeStatus={activeStatus}
            panelId={PANEL_ID}
            onChange={setActiveStatus}
          />
          <div className="relative w-full lg:w-80">
            <label htmlFor={SEARCH_INPUT_ID} className="sr-only">
              Search transfers
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            />
            <input
              id={SEARCH_INPUT_ID}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Reference, member or booking"
              autoComplete="off"
              className={cn(INPUT_CLASS, "pl-10")}
            />
          </div>
        </div>
        <p className="text-sm text-slate-600">{activeTab.summary}</p>
      </div>

      <section
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={transferTabId(activeStatus)}
        className="overflow-hidden rounded-xl border border-[#EBE7F5] bg-white shadow-xs"
      >
        {loadError ? (
          <div className="p-4">
            <InlineAlert
              tone="error"
              role="alert"
              title="Couldn't load transfers"
            >
              <p>{loadError}</p>
              <button
                type="button"
                onClick={() => void loadTransfers()}
                className={cn(SECONDARY_BUTTON, "mt-3")}
              >
                Try again
              </button>
            </InlineAlert>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1 border-b border-[#EBE7F5] bg-[#F8F9FA]/60 px-4 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
              <p role="status" className="font-semibold text-slate-700">
                {isLoading
                  ? "Loading transfers…"
                  : countLabel(
                      visibleTransfers.length,
                      transfers.length,
                      search,
                    )}
              </p>
              <p>Times are Lagos time (WAT).</p>
            </div>
            <BankTransfersTable
              transfers={visibleTransfers}
              isLoading={isLoading}
              isActionable={activeTab.isActionable}
              emptyMessage={
                transfers.length > 0
                  ? "No transfers match your search."
                  : activeTab.emptyMessage
              }
              currentUserId={user?.id}
              onConfirm={setConfirmTarget}
              onReject={setRejectTarget}
            />
          </>
        )}
      </section>

      <ConfirmTransferModal
        transfer={confirmTarget}
        currentUserId={user?.id}
        onClose={() => setConfirmTarget(null)}
        onListChanged={() => void loadTransfers()}
      />
      <RejectTransferModal
        transfer={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onRejected={handleRejected}
        onListChanged={() => void loadTransfers()}
      />
    </div>
  );
}

"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  Search,
  Filter,
  RotateCw,
  CheckCircle2,
  Clock,
  XCircle,
  ChevronLeft,
  ChevronRight,
  X,
  FileText,
  Loader2,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import { useToast } from "@daih/ui";
import { api } from "@daih/api-client";
import { PaymentTransaction, PaymentStatus } from "@daih/types";
import {
  isManualPaymentMethod,
  paymentMethodLabel,
} from "../../lib/payment-labels";

/**
 * How a transaction was paid, for the member column: "Paid via card",
 * "Paid via Bank transfer", "Method: Cash". Bank transfer, cash and POS
 * payments store their channel as "bank_transfer", "cash" or "pos", so their
 * readable method label is shown instead.
 */
function describePaymentSource(tx: {
  method?: string | null;
  paystackChannel?: string | null;
}): string {
  const methodLabel = paymentMethodLabel(tx.method);
  if (tx.paystackChannel) {
    const via =
      isManualPaymentMethod(tx.method) && methodLabel
        ? methodLabel
        : tx.paystackChannel;
    return `Paid via ${via}`;
  }
  return methodLabel ? `Method: ${methodLabel}` : "Paystack";
}

export interface FinanceTransaction {
  id: string;
  reference: string;
  date: string;
  memberName: string;
  memberEntity: string;
  avatarColorClass: string;
  avatarLetter: string;
  resourcePlan: string;
  amount: string;
  rawAmount: number;
  status: "Paid" | "Pending" | "Failed" | "Refunded";
  refundAmount?: string;
  rawRefundAmount?: number;
  refundReason?: string;
  refundedAt?: string;
}

interface TransactionLedgerTableProps {
  initialStatusFilter?: string;
  startDate?: string;
  endDate?: string;
  dateRangeLabel?: string;
}

export const TransactionLedgerTable: React.FC<TransactionLedgerTableProps> = ({
  initialStatusFilter = "ALL",
  startDate,
  endDate,
  dateRangeLabel,
}) => {
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const isFirstMount = React.useRef(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isBusy = initialLoading || isRefreshing;
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<FinanceTransaction | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 20;
  const toast = useToast();

  const loadTransactions = useCallback(async () => {
    if (isFirstMount.current) {
      setInitialLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const res = await api.payments.getAdminTransactions({
        page: currentPage,
        limit: pageSize,
        search: searchQuery || undefined,
        status: statusFilter !== "ALL" ? (statusFilter as any) : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });

      const txList: PaymentTransaction[] = res.transactions || [];
      setTotalCount(res.total ?? txList.length);

      const mapped: FinanceTransaction[] = txList.map((tx: any) => {
        let status: FinanceTransaction["status"] = "Pending";
        const isRefunded =
          tx.status === PaymentStatus.REFUNDED ||
          tx.status === PaymentStatus.PARTIALLY_REFUNDED ||
          (tx.refundAmount != null && Number(tx.refundAmount) > 0);

        if (isRefunded) {
          status = "Refunded";
        } else if (
          tx.status === PaymentStatus.SUCCESSFUL ||
          tx.status === "SUCCESS"
        ) {
          status = "Paid";
        } else if (tx.status === PaymentStatus.FAILED) {
          status = "Failed";
        }

        const userName =
          tx.customerName ||
          (tx.user
            ? `${tx.user.firstName || ""} ${tx.user.lastName || ""}`.trim() ||
              tx.user.email
            : null) ||
          tx.booking?.customerName ||
          tx.booking?.resource?.name ||
          "Workspace Client";

        const refundAmt = Number(tx.refundAmount || 0);

        return {
          id: tx.id,
          reference: tx.reference,
          date: new Date(tx.createdAt).toLocaleDateString("en-NG", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
          memberName: userName,
          memberEntity: describePaymentSource(tx),
          avatarColorClass: isRefunded
            ? "bg-rose-600 text-white"
            : "bg-[#23055c] text-white",
          avatarLetter: (userName.charAt(0) || "M").toUpperCase(),
          resourcePlan:
            tx.resourceName ||
            tx.booking?.resource?.name ||
            tx.booking?.resourceName ||
            "Workspace Reservation",
          amount: `₦${Number(tx.amount || 0).toLocaleString("en-NG", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`,
          rawAmount: Number(tx.amount || 0),
          status,
          refundAmount:
            refundAmt > 0
              ? `₦${refundAmt.toLocaleString("en-NG", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`
              : undefined,
          rawRefundAmount: refundAmt,
          refundReason: tx.refundReason || undefined,
          refundedAt: tx.refundedAt
            ? new Date(tx.refundedAt).toLocaleDateString("en-NG", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : undefined,
        };
      });

      setTransactions(mapped);
    } catch (err: any) {
      console.warn("Error fetching live transactions from backend:", err);
      if (isFirstMount.current) {
        setTransactions([]);
      }
    } finally {
      setInitialLoading(false);
      setIsRefreshing(false);
      isFirstMount.current = false;
    }
  }, [currentPage, searchQuery, statusFilter, startDate, endDate]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const getStatusBadge = (status: FinanceTransaction["status"]) => {
    switch (status) {
      case "Paid":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/80">
            <CheckCircle2 className="w-3 h-3" />
            Paid
          </span>
        );
      case "Refunded":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200/80">
            <RotateCw className="w-3 h-3" />
            Refunded
          </span>
        );
      case "Pending":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/80">
            <Clock className="w-3 h-3" />
            Pending
          </span>
        );
      case "Failed":
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200/80">
            <XCircle className="w-3 h-3" />
            Failed
          </span>
        );
    }
  };

  return (
    <div className="bg-white/80 backdrop-blur-md border border-[#EBE7F5] rounded-xl overflow-hidden shadow-xs">
      {/* Controls Bar: Search & Filter */}
      <div className="p-4 border-b border-[#EBE7F5] flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#F8F9FA]/60">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          {/* Search Box */}
          <div className="relative flex-1 sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search reference, member name..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-9 pr-4 py-2 bg-white border border-[#EBE7F5] rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#23055c] focus:border-transparent transition-all shadow-xs"
            />
          </div>

          {/* Status Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className="px-3.5 py-2 bg-white border border-[#EBE7F5] rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-between gap-2 shadow-xs transition-colors cursor-pointer w-full sm:w-auto"
            >
              <div className="flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  Status:{" "}
                  <span className="text-[#23055c] font-bold">
                    {statusFilter}
                  </span>
                </span>
              </div>
            </button>

            {filterOpen && (
              <div className="absolute top-full left-0 mt-1 w-36 bg-white rounded-xl shadow-lg border border-[#EBE7F5] py-1 z-20">
                {["ALL", "PAID", "REFUNDED", "PENDING", "FAILED"].map((st) => (
                  <button
                    key={st}
                    onClick={() => {
                      setStatusFilter(st);
                      setCurrentPage(1);
                      setFilterOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 transition-colors cursor-pointer ${
                      statusFilter === st
                        ? "text-[#23055c] font-bold bg-purple-50/50"
                        : "text-slate-600"
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={() => loadTransactions()}
          className="p-2 border border-[#EBE7F5] rounded-xl text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer self-end md:self-auto"
          title="Refresh Ledger"
        >
          <RotateCw className={`w-4 h-4 ${isBusy ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-[#F8F9FA] text-slate-500 font-extrabold uppercase border-b border-[#EBE7F5]">
              <th className="py-3 px-6">Reference</th>
              <th className="py-3 px-6">Date</th>
              <th className="py-3 px-6">Member / Entity</th>
              <th className="py-3 px-6">Plan / Resource</th>
              <th className="py-3 px-6 text-right">Amount</th>
              <th className="py-3 px-6 text-center">Status</th>
              <th className="py-3 px-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody
            className={`divide-y divide-[#EBE7F5] transition-opacity duration-200 ${isRefreshing ? "opacity-60" : "opacity-100"}`}
          >
            {initialLoading ? (
              [1, 2, 3, 4, 5].map((i) => (
                <tr key={i} className="animate-pulse">
                  <td className="py-4 px-6">
                    <div className="h-4 w-28 bg-slate-200 rounded" />
                  </td>
                  <td className="py-4 px-6">
                    <div className="h-4 w-20 bg-slate-100 rounded" />
                  </td>
                  <td className="py-4 px-6">
                    <div className="h-4 w-32 bg-slate-200 rounded" />
                  </td>
                  <td className="py-4 px-6">
                    <div className="h-4 w-24 bg-slate-100 rounded" />
                  </td>
                  <td className="py-4 px-6 text-right">
                    <div className="h-4 w-20 bg-slate-200 rounded ml-auto" />
                  </td>
                  <td className="py-4 px-6 text-center">
                    <div className="h-5 w-16 bg-slate-200 rounded-full mx-auto" />
                  </td>
                  <td className="py-4 px-6 text-right">
                    <div className="h-4 w-16 bg-slate-200 rounded ml-auto" />
                  </td>
                </tr>
              ))
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  <div className="space-y-2">
                    <Receipt className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="font-bold text-slate-700">
                      No Transactions Found
                    </p>
                    <p className="text-[11px] text-slate-400">
                      No payment records match the selected filters.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              transactions.map((tx) => (
                <tr
                  key={tx.id}
                  className="hover:bg-slate-50/75 transition-colors group"
                >
                  <td className="py-4 px-6 font-mono font-bold text-[#23055c]">
                    {tx.reference}
                  </td>
                  <td className="py-4 px-6 text-slate-500">{tx.date}</td>
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs ${tx.avatarColorClass}`}
                      >
                        {tx.avatarLetter}
                      </div>
                      <div>
                        <p className="font-bold text-slate-800">
                          {tx.memberName}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {tx.memberEntity}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-slate-600 font-medium">
                    {tx.resourcePlan}
                  </td>
                  <td className="py-4 px-6 text-right">
                    <div
                      className={`font-extrabold ${tx.status === "Refunded" ? "text-rose-700" : "text-slate-900"}`}
                    >
                      {tx.amount}
                    </div>
                    {tx.refundAmount && (
                      <div className="text-[10px] text-rose-600 font-bold">
                        -{tx.refundAmount} refunded
                      </div>
                    )}
                  </td>
                  <td className="py-4 px-6 text-center">
                    {getStatusBadge(tx.status)}
                  </td>
                  <td className="py-4 px-6 text-right">
                    <button
                      onClick={() => setSelectedTx(tx)}
                      className="text-[#23055c] hover:text-[#392271] font-bold transition-opacity cursor-pointer group-hover:opacity-100 opacity-90"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-4 border-t border-[#EBE7F5] flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#F8F9FA]">
        <p className="text-xs text-slate-500 font-medium">
          Showing{" "}
          {transactions.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{" "}
          {Math.min(currentPage * pageSize, totalCount)} of {totalCount} entries
        </p>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1 || isBusy}
            className="px-2.5 py-1 border border-[#EBE7F5] rounded text-xs text-slate-600 hover:bg-white disabled:opacity-40 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {Array.from({ length: totalPages }, (_, i) => i + 1).map(
            (pageNum) => (
              <button
                key={pageNum}
                onClick={() => setCurrentPage(pageNum)}
                className={`px-3 py-1 rounded text-xs font-bold transition-colors cursor-pointer ${
                  currentPage === pageNum
                    ? "bg-[#23055c] text-white shadow-xs"
                    : "border border-[#EBE7F5] bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {pageNum}
              </button>
            ),
          )}

          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages || isBusy}
            className="px-2.5 py-1 border border-[#EBE7F5] rounded text-xs text-slate-600 hover:bg-white disabled:opacity-40 transition-colors cursor-pointer"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Transaction Details Modal */}
      {selectedTx && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 relative">
            <button
              onClick={() => setSelectedTx(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-[#23055c] flex items-center justify-center">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">
                  Transaction &amp; Invoice Ledger
                </h4>
                <p className="text-[11px] font-mono text-slate-400">
                  {selectedTx.reference}
                </p>
              </div>
            </div>

            <div className="space-y-3 border-y border-slate-100 py-4 my-4 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Billed To:</span>
                <span className="font-bold text-slate-900">
                  {selectedTx.memberName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">
                  Workspace Resource:
                </span>
                <span className="font-semibold text-slate-800">
                  {selectedTx.resourcePlan}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">
                  Date &amp; Timestamp:
                </span>
                <span className="text-slate-700">{selectedTx.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">
                  Payment Status:
                </span>
                <div>{getStatusBadge(selectedTx.status)}</div>
              </div>

              {/* Refund Metadata if Refunded */}
              {selectedTx.refundAmount && (
                <div className="p-3 bg-rose-50/70 rounded-xl border border-rose-100 space-y-1.5">
                  <div className="flex justify-between font-bold text-rose-700">
                    <span>Refund Disbursed:</span>
                    <span>-{selectedTx.refundAmount}</span>
                  </div>
                  {selectedTx.refundReason && (
                    <div className="flex justify-between text-[11px] text-slate-600">
                      <span className="text-slate-400">Reason:</span>
                      <span className="font-medium text-slate-800 text-right truncate max-w-[200px]">
                        {selectedTx.refundReason}
                      </span>
                    </div>
                  )}
                  {selectedTx.refundedAt && (
                    <div className="flex justify-between text-[11px] text-slate-600">
                      <span className="text-slate-400">Refunded On:</span>
                      <span>{selectedTx.refundedAt}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-between pt-2 border-t border-slate-100 text-sm font-extrabold">
                <span className="text-slate-800">Total Settled:</span>
                <span className="text-[#23055c]">{selectedTx.amount}</span>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setSelectedTx(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={() => {
                  toast.success(
                    `Printing official invoice record for ${selectedTx.reference}`,
                    { title: "Invoice Printed" },
                  );
                }}
                className="px-4 py-2 bg-[#23055c] hover:bg-[#35089e] text-white rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
              >
                Print Invoice
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

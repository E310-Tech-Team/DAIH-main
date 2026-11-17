"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  RotateCcw,
  ShieldCheck,
  PlusCircle,
  RefreshCw,
  Clock,
  CheckCircle2,
  Coins,
  CreditCard,
  HelpCircle,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@daih/ui";
import { api } from "@daih/api-client";
import { RefundRequestItemDTO, RefundStatus } from "@daih/types";
import {
  RefundsTable,
  RefundDetailModal,
  RaiseRefundModal,
} from "../../../components/finance/refunds";

export default function RefundsAdminPage() {
  const toast = useToast();
  const [refunds, setRefunds] = useState<RefundRequestItemDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);

  const [selectedRefund, setSelectedRefund] =
    useState<RefundRequestItemDTO | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [raiseModalOpen, setRaiseModalOpen] = useState(false);

  const fetchRefunds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.payments.listRefunds({
        status: statusFilter === "ALL" ? undefined : statusFilter,
        page,
        limit,
      });
      setRefunds(res.items || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load refund requests");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, limit, toast]);

  useEffect(() => {
    fetchRefunds();
  }, [fetchRefunds]);

  // Compute live KPIs
  const kpis = useMemo(() => {
    let pendingCount = 0;
    let inquiryCount = 0;
    let totalDisbursedNgn = 0;
    let totalClawedBackCoins = 0;

    refunds.forEach((r) => {
      if (r.status === RefundStatus.PENDING) pendingCount++;
      if (r.status === RefundStatus.INFO_REQUESTED) inquiryCount++;
      if (
        r.status === RefundStatus.APPROVED ||
        r.status === RefundStatus.PROCESSED
      ) {
        totalDisbursedNgn += Number(r.amount || 0);
        totalClawedBackCoins +=
          Number(r.coinsToClawback || 0) +
          Number(r.referralCoinsToClawback || 0);
      }
    });

    return {
      pendingCount,
      inquiryCount,
      totalDisbursedNgn,
      totalClawedBackCoins,
    };
  }, [refunds]);

  const handleSelectRefund = (item: RefundRequestItemDTO) => {
    setSelectedRefund(item);
    setDetailModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              Dual-Authorization Refund Approvals
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-100 text-[#23055c] border border-purple-200">
              Segregation of Duties
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Operations initiates requests with audit justification &ge; 20
            chars; Finance authorizes Paystack disbursement and automatic coin
            clawbacks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchRefunds}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold transition-all cursor-pointer"
            title="Refresh List"
          >
            <RefreshCw
              className={`w-4 h-4 ${loading ? "animate-spin text-[#23055c]" : ""}`}
            />
          </button>
          <button
            type="button"
            onClick={() => setRaiseModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-[#23055c] hover:bg-[#392271] text-white text-xs font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Raise Refund Request</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Pending Approval */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-2">
            <span className="font-bold">Pending Review</span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">
            {kpis.pendingCount}
          </div>
          <div className="text-[11px] text-amber-600 font-semibold mt-1">
            Awaiting Finance Officer
          </div>
        </div>

        {/* Inquiry Loop */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-2">
            <span className="font-bold">Active Inquiries</span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
              <HelpCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">
            {kpis.inquiryCount}
          </div>
          <div className="text-[11px] text-blue-600 font-semibold mt-1">
            Clarification thread active
          </div>
        </div>

        {/* Disbursed Fiat */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-2">
            <span className="font-bold">Disbursed (This View)</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">
            ₦{kpis.totalDisbursedNgn.toLocaleString()}
          </div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-1">
            Paystack & manual payouts
          </div>
        </div>

        {/* Loyalty Coins Clawed Back */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-2">
            <span className="font-bold">Coins Clawed Back</span>
            <div className="w-7 h-7 rounded-lg bg-purple-50 text-[#23055c] flex items-center justify-center">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">
            {kpis.totalClawedBackCoins.toLocaleString()}{" "}
            <span className="text-sm font-normal text-slate-500">PD</span>
          </div>
          <div className="text-[11px] text-purple-700 font-semibold mt-1">
            Earned & referrer rewards
          </div>
        </div>
      </div>

      {/* Refunds Table */}
      <RefundsTable
        items={refunds}
        total={total}
        page={page}
        limit={limit}
        loading={loading}
        onPageChange={setPage}
        statusFilter={statusFilter}
        onStatusFilterChange={(s) => {
          setStatusFilter(s);
          setPage(1);
        }}
        onSelectRefund={handleSelectRefund}
      />

      {/* Detail Inspector Modal: keyed so each opened refund starts with a fresh form */}
      <RefundDetailModal
        key={selectedRefund?.id ?? "none"}
        isOpen={detailModalOpen}
        onClose={() => {
          setDetailModalOpen(false);
          setSelectedRefund(null);
        }}
        refund={selectedRefund}
        onUpdated={fetchRefunds}
      />

      {/* Raise Refund Modal */}
      <RaiseRefundModal
        isOpen={raiseModalOpen}
        onClose={() => setRaiseModalOpen(false)}
        onSuccess={fetchRefunds}
      />
    </div>
  );
}

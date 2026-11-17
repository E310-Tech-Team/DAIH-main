"use client";

import React, { useId, useState } from "react";
import {
  X,
  RotateCcw,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  ShieldCheck,
  ShieldAlert,
  Coins,
  CreditCard,
  User,
  Calendar,
  FileText,
  Loader2,
  MessageSquare,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@daih/ui";
import { api, useAuth } from "@daih/api-client";
import {
  RefundRequestItemDTO,
  RefundStatus,
  UserRole,
  Permission,
} from "@daih/types";
import { RequestInfoModal } from "./RequestInfoModal";
import { ProvideInfoModal } from "./ProvideInfoModal";
import { RejectRefundModal } from "./RejectRefundModal";
import { FormField, INPUT_CLASS } from "../../common/FormField";
import { InlineAlert } from "../../common/InlineAlert";
import { apiErrorCode, apiErrorMessage } from "../../../lib/api-errors";
import {
  isManualPaymentMethod,
  paymentMethodLabel,
} from "../../../lib/payment-labels";
import {
  REFERENCE_INPUT_PATTERN,
  REFERENCE_MAX_LENGTH,
  referenceCharacterProblem,
  validateReference,
} from "../../../lib/reference-validation";

/** Mirrors the API: a manual payout reference is at least 3 characters. */
const PAYOUT_REFERENCE_MIN_LENGTH = 3;

export interface RefundDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  refund: RefundRequestItemDTO | null;
  onUpdated?: () => void;
}

export const RefundDetailModal: React.FC<RefundDetailModalProps> = ({
  isOpen,
  onClose,
  refund,
  onUpdated,
}) => {
  const toast = useToast();
  const { user } = useAuth();
  const [isApproving, setIsApproving] = useState(false);
  const [requestInfoOpen, setRequestInfoOpen] = useState(false);
  const [provideInfoOpen, setProvideInfoOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const payoutInputId = useId();
  const [payoutReference, setPayoutReference] = useState("");
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  // Set if the API asks for a payout reference this screen did not expect.
  const [isPayoutRequiredByApi, setIsPayoutRequiredByApi] = useState(false);

  if (!isOpen || !refund) return null;

  // Bank transfer, cash and POS payments are refunded by hand, so finance
  // records how the money went back (API: PAYOUT_REFERENCE_REQUIRED).
  const isManualPayout =
    isManualPaymentMethod(refund.transactionMethod) || isPayoutRequiredByApi;
  const paidWithLabel = paymentMethodLabel(refund.transactionMethod);
  const payoutChannelLabel = isManualPayout
    ? `Paid back by hand${paidWithLabel ? ` · ${paidWithLabel}` : ""}`
    : "Via Paystack Gateway";
  const shownPayoutError =
    payoutError ?? referenceCharacterProblem(payoutReference);

  const isSelf = user?.id === refund.requestedByUserId;
  const isFinanceOrSuperAdmin =
    user?.role === UserRole.FINANCE_OFFICER ||
    user?.role === UserRole.SUPER_ADMIN;

  const canApprove =
    isFinanceOrSuperAdmin &&
    !isSelf &&
    (refund.status === RefundStatus.PENDING ||
      refund.status === RefundStatus.INFO_REQUESTED);

  const canRequestInfo =
    isFinanceOrSuperAdmin &&
    (refund.status === RefundStatus.PENDING ||
      refund.status === RefundStatus.INFO_REQUESTED);

  const canProvideInfo =
    refund.status === RefundStatus.INFO_REQUESTED &&
    Boolean(refund.infoRequested);

  const handleApprove = async () => {
    if (isSelf) {
      setApproveError(
        "Segregation of duties: You cannot approve a refund request that you raised.",
      );
      return;
    }

    const trimmedPayoutReference = payoutReference.trim();
    if (isManualPayout) {
      const problem = validateReference(payoutReference, {
        minLength: PAYOUT_REFERENCE_MIN_LENGTH,
        label: "payout reference",
      });
      if (problem) {
        setPayoutError(problem);
        document.getElementById(payoutInputId)?.focus();
        return;
      }
    }

    setIsApproving(true);
    setApproveError(null);
    try {
      await api.payments.approveRefund(
        refund.id,
        isManualPayout ? trimmedPayoutReference : undefined,
      );
      toast.success(
        isManualPayout
          ? `Refund approved and payout ${trimmedPayoutReference} recorded. Coins reversed & clawbacks applied.`
          : "Refund approved and disbursed via Paystack! Coins reversed & clawbacks applied.",
      );
      onUpdated?.();
      onClose();
    } catch (err: unknown) {
      // e.g. SELF_APPROVAL_PROHIBITED (you confirmed this payment) or
      // DUPLICATE_PAYOUT_REFERENCE: shown in place, in the API's words.
      if (apiErrorCode(err) === "PAYOUT_REFERENCE_REQUIRED") {
        setIsPayoutRequiredByApi(true);
      }
      setApproveError(apiErrorMessage(err, "Failed to approve refund"));
    } finally {
      setIsApproving(false);
    }
  };

  const getStatusBadge = (status: RefundStatus) => {
    switch (status) {
      case RefundStatus.PENDING:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3.5 h-3.5" />
            Pending Approval
          </span>
        );
      case RefundStatus.INFO_REQUESTED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <HelpCircle className="w-3.5 h-3.5" />
            Clarification Requested
          </span>
        );
      case RefundStatus.APPROVED:
      case RefundStatus.PROCESSED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Disbursed / Processed
          </span>
        );
      case RefundStatus.REJECTED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3.5 h-3.5" />
            Rejected
          </span>
        );
      case RefundStatus.FAILED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            Gateway Failed
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 relative my-8">
          {/* Top Bar */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-[#23055c] flex items-center justify-center font-bold">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900">
                    Refund Request Detail
                  </h3>
                  {getStatusBadge(refund.status)}
                </div>
                <p className="text-[11px] text-slate-500 font-mono">
                  ID: {refund.id}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Segregation Warning Banner if Self-Raised */}
          {isSelf && refund.status === RefundStatus.PENDING && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-800">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Segregation of Duties Enforced</p>
                <p className="text-[11px] text-amber-700">
                  You initiated this refund request. A different authorized
                  staff member (Finance Officer or Super Admin) must review and
                  approve it.
                </p>
              </div>
            </div>
          )}

          {/* Booking & Financial Summary Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* Booking Card */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1.5">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Booking Information
              </div>
              <div className="font-mono font-bold text-slate-800 text-sm">
                #{refund.booking?.reference || refund.bookingId.slice(0, 8)}
              </div>
              <div className="text-slate-600">
                Customer:{" "}
                <span className="font-semibold text-slate-900">
                  {refund.booking?.user
                    ? `${refund.booking.user.firstName} ${refund.booking.user.lastName}`
                    : "Customer"}
                </span>
              </div>
              <div className="text-slate-500 text-[11px]">
                {refund.booking?.user?.email}
              </div>
            </div>

            {/* Financial Card */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1.5">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Refund Amount
              </div>
              <div className="font-bold text-emerald-600 text-lg">
                ₦{Number(refund.amount).toLocaleString()}
              </div>
              <div className="text-slate-600 text-[11px] flex items-center gap-1">
                <CreditCard className="w-3.5 h-3.5" />
                <span>{payoutChannelLabel}</span>
              </div>
            </div>
          </div>

          {/* Loyalty Coin Ledger Impact */}
          <div className="bg-purple-50/70 border border-purple-100 rounded-xl p-3.5 space-y-2 text-xs">
            <div className="font-bold text-[#23055c] flex items-center gap-1.5">
              <Coins className="w-4 h-4" />
              <span>Loyalty Coins Ledger Impact:</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
              <div className="bg-white/80 rounded-lg p-2.5 border border-purple-100">
                <div className="text-slate-500 text-[10px]">
                  Coins Returned to User
                </div>
                <div className="font-bold text-purple-700 text-sm">
                  +{Number(refund.coinsToReverse || 0).toLocaleString()} PD
                </div>
              </div>
              <div className="bg-white/80 rounded-lg p-2.5 border border-purple-100">
                <div className="text-slate-500 text-[10px]">
                  Earned Coins Clawback
                </div>
                <div className="font-bold text-rose-600 text-sm">
                  -{Number(refund.coinsToClawback || 0).toLocaleString()} PD
                </div>
              </div>
              <div className="bg-white/80 rounded-lg p-2.5 border border-purple-100">
                <div className="text-slate-500 text-[10px]">
                  Referrer Bonus Clawback
                </div>
                <div className="font-bold text-rose-600 text-sm">
                  -
                  {Number(refund.referralCoinsToClawback || 0).toLocaleString()}{" "}
                  PD
                </div>
              </div>
            </div>
          </div>

          {/* Justification & Reason */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Staff Reason ({refund.reasonCode})
              </span>
              <span className="text-[10px] text-slate-400">
                {new Date(refund.requestedAt).toLocaleString()}
              </span>
            </div>
            <p className="text-slate-800 font-normal leading-relaxed whitespace-pre-wrap">
              {refund.reason}
            </p>
            <div className="pt-2 flex items-center gap-2 text-[11px] text-slate-500 border-t border-slate-200">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span>
                Raised by:{" "}
                <strong>
                  {refund.requestedBy
                    ? `${refund.requestedBy.firstName} ${refund.requestedBy.lastName} (${refund.requestedBy.role})`
                    : refund.requestedByUserId}
                </strong>
              </span>
            </div>
          </div>

          {/* Clarification Loop Thread */}
          {(refund.infoRequested || refund.infoProvided) && (
            <div className="space-y-2 text-xs">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Clarification Discussion
              </div>
              {refund.infoRequested && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
                  <div className="font-bold text-amber-900 text-[11px] flex items-center gap-1">
                    <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
                    <span>Finance Inquiry:</span>
                  </div>
                  <p className="text-amber-800 italic">
                    {refund.infoRequested}
                  </p>
                </div>
              )}
              {refund.infoProvided && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-1">
                  <div className="font-bold text-blue-900 text-[11px] flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                    <span>Operations Response:</span>
                  </div>
                  <p className="text-blue-800">{refund.infoProvided}</p>
                </div>
              )}
            </div>
          )}

          {/* Rejection Note */}
          {refund.rejectionReason && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-1 text-xs text-rose-800">
              <span className="font-bold text-rose-900 flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5 text-rose-600" />
                Rejection Justification:
              </span>
              <p>{refund.rejectionReason}</p>
              {refund.reviewedBy && (
                <p className="text-[10px] text-rose-600 pt-1">
                  Reviewed by: {refund.reviewedBy.firstName}{" "}
                  {refund.reviewedBy.lastName}
                </p>
              )}
            </div>
          )}

          {/* Gateway Audit Trail */}
          {(refund.paystackRefundId || refund.gatewayReference) && (
            <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3 text-xs space-y-1">
              <span className="font-bold text-emerald-900 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                {isManualPayout
                  ? "Manual Payout Recorded"
                  : "Paystack Gateway Settlement"}
              </span>
              <div className="text-[11px] font-mono text-emerald-800 space-y-0.5">
                {isManualPayout ? (
                  <div>
                    Payout reference: {refund.gatewayReference || "N/A"}
                  </div>
                ) : (
                  <>
                    <div>Refund ID: {refund.paystackRefundId || "N/A"}</div>
                    <div>Reference: {refund.gatewayReference || "N/A"}</div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Manual payout: bank transfer, cash and POS refunds are paid back by hand */}
          {canApprove && isManualPayout && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-sm text-slate-800">
                <strong className="font-bold text-slate-900">
                  Manual payout.
                </strong>{" "}
                {paidWithLabel ? `Original payment: ${paidWithLabel}. ` : ""}
                Finance pays this refund back by hand.
              </p>
              <FormField
                id={payoutInputId}
                label="Payout reference"
                required
                hint="Pay the member back first, then enter your transfer reference or the cash receipt number"
                error={shownPayoutError}
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={REFERENCE_MAX_LENGTH}
                    pattern={REFERENCE_INPUT_PATTERN}
                    value={payoutReference}
                    onChange={(event) => {
                      setPayoutReference(event.target.value);
                      setPayoutError(null);
                      setApproveError(null);
                    }}
                    disabled={isApproving}
                    className={`${INPUT_CLASS} font-mono`}
                  />
                )}
              </FormField>
            </div>
          )}

          {approveError && (
            <InlineAlert tone="error" role="alert">
              {approveError}
            </InlineAlert>
          )}

          {/* Bottom Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Close
            </button>

            <div className="flex flex-wrap items-center gap-2">
              {/* Clarification Response Button for Operations */}
              {canProvideInfo && (
                <button
                  type="button"
                  onClick={() => setProvideInfoOpen(true)}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Provide Clarification</span>
                </button>
              )}

              {/* Inquiry Request for Finance */}
              {canRequestInfo && (
                <button
                  type="button"
                  onClick={() => setRequestInfoOpen(true)}
                  className="px-3.5 py-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold transition-all"
                >
                  <HelpCircle className="w-3.5 h-3.5 inline mr-1" />
                  Request Details
                </button>
              )}

              {/* Reject Button for Finance */}
              {canApprove && (
                <button
                  type="button"
                  onClick={() => setRejectOpen(true)}
                  className="px-3.5 py-2 rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold transition-all"
                >
                  <XCircle className="w-3.5 h-3.5 inline mr-1" />
                  Reject Request
                </button>
              )}

              {/* Approve Button for Finance */}
              {canApprove && (
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={isApproving}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {isApproving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>
                    {isManualPayout
                      ? "Approve & Record Payout"
                      : "Approve & Disburse"}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Nested Modals */}
      <RequestInfoModal
        isOpen={requestInfoOpen}
        onClose={() => setRequestInfoOpen(false)}
        refundId={refund.id}
        bookingRef={refund.booking?.reference}
        onSuccess={() => {
          onUpdated?.();
          onClose();
        }}
      />

      <ProvideInfoModal
        isOpen={provideInfoOpen}
        onClose={() => setProvideInfoOpen(false)}
        refundId={refund.id}
        questionPrompt={refund.infoRequested || undefined}
        bookingRef={refund.booking?.reference}
        onSuccess={() => {
          onUpdated?.();
          onClose();
        }}
      />

      <RejectRefundModal
        isOpen={rejectOpen}
        onClose={() => setRejectOpen(false)}
        refundId={refund.id}
        bookingRef={refund.booking?.reference}
        onSuccess={() => {
          onUpdated?.();
          onClose();
        }}
      />
    </>
  );
};

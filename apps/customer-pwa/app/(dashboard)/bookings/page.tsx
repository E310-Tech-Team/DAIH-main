"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  Suspense,
  useMemo,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, useAuth } from "@daih/api-client";
import { BookingSummary, BookingState, InvoiceDTO } from "@daih/types";
import {
  Calendar,
  Clock,
  QrCode,
  XCircle,
  AlertCircle,
  CheckCircle2,
  Building2,
  MapPin,
  ArrowRight,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Receipt,
  CreditCard,
  Download,
  X,
  Sparkles,
  FileSpreadsheet,
  FileText,
  Star,
  Coffee,
} from "lucide-react";
import { ReviewDTO } from "@daih/types";
import { ReviewModal } from "../../../components/reviews/ReviewModal";
import { downloadReceiptPdf } from "../../../lib/receiptPdf";
import {
  downloadBookingsCsv,
  downloadBookingsPdf,
  isStatementEligible,
} from "../../../lib/statementExport";

function formatDate(isoStr: string) {
  if (!isoStr) return "";
  return new Date(isoStr).toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(isoStr: string) {
  if (!isoStr) return "";
  return new Date(isoStr).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMonthLabel(ym: string) {
  if (ym === "ALL") return "All Time";
  const [yearStr, monthStr] = ym.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (isNaN(year) || isNaN(month)) return ym;
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("en-NG", { month: "long", year: "numeric" });
}

function BookingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [payingBookingId, setPayingBookingId] = useState<string | null>(null);
  const [checkingBookingId, setCheckingBookingId] = useState<string | null>(
    null,
  );
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDTO | null>(
    null,
  );
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"active" | "history">("active");
  const [isVerifyingReturn, setIsVerifyingReturn] = useState(false);
  const [verifiedSuccessMessage, setVerifiedSuccessMessage] = useState<
    string | null
  >(null);
  const verifiedRefTracker = React.useRef<string | null>(null);

  // Statement & Financial Export state
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>("ALL");
  const [isExporting, setIsExporting] = useState(false);

  // Customer Review Modal state
  const [reviewBooking, setReviewBooking] = useState<BookingSummary | null>(
    null,
  );
  const [existingReview, setExistingReview] = useState<ReviewDTO | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [checkingReviewId, setCheckingReviewId] = useState<string | null>(null);
  const [supportModalBooking, setSupportModalBooking] =
    useState<BookingSummary | null>(null);

  const handleOpenReview = async (b: BookingSummary) => {
    try {
      setCheckingReviewId(b.id);
      const res = await api.reviews.checkEligibility(b.id);
      if (res.eligible) {
        setReviewBooking(b);
        setExistingReview(null);
        setShowReviewModal(true);
      } else if (res.hasReviewed && res.existingReview) {
        setReviewBooking(b);
        setExistingReview(res.existingReview);
        setShowReviewModal(true);
      } else {
        alert(res.reason || "This booking is not eligible for review.");
      }
    } catch (err: any) {
      alert(err?.message || "Could not check review eligibility.");
    } finally {
      setCheckingReviewId(null);
    }
  };

  // Handle direct review link from email (e.g. /bookings?reviewBookingId=...)
  useEffect(() => {
    if (typeof window !== "undefined" && bookings.length > 0) {
      const params = new URLSearchParams(window.location.search);
      const reviewBookingId = params.get("reviewBookingId");
      if (reviewBookingId) {
        const target = bookings.find((b) => b.id === reviewBookingId);
        if (target) {
          if (
            new Date(target.endTime) < new Date() ||
            target.state === BookingState.CHECKED_OUT ||
            target.state === BookingState.COMPLETED
          ) {
            setActiveTab("history");
          }
          handleOpenReview(target);
        }
      }
    }
  }, [bookings]);

  const customerInfo = useMemo(() => {
    return {
      name: user
        ? `${user.firstName} ${user.lastName}`.trim()
        : "Valued Member",
      email: user?.email || undefined,
      phone: user?.phoneNumber || undefined,
      clientId: user?.clientId || undefined,
    };
  }, [user]);

  // Filter bookings eligible for statements (excludes EXPIRED and draft/held slots)
  const statementEligibleBookings = useMemo(() => {
    return bookings.filter(isStatementEligible);
  }, [bookings]);

  const availableMonths = useMemo(() => {
    const monthMap = new Map<string, number>();
    statementEligibleBookings.forEach((b) => {
      const dateStr = b.startTime || b.createdAt;
      if (dateStr) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          monthMap.set(ym, (monthMap.get(ym) || 0) + 1);
        }
      }
    });

    return Array.from(monthMap.keys()).sort((a, b) => b.localeCompare(a));
  }, [statementEligibleBookings]);

  const getMonthCount = useCallback(
    (ym: string) => {
      if (ym === "ALL") return statementEligibleBookings.length;
      return statementEligibleBookings.filter((b) => {
        const dateStr = b.startTime || b.createdAt;
        if (!dateStr) return false;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        const bookingYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        return bookingYm === ym;
      }).length;
    },
    [statementEligibleBookings],
  );

  const exportFilteredBookings = useMemo(() => {
    if (selectedMonth === "ALL") return statementEligibleBookings;
    return statementEligibleBookings.filter((b) => {
      const dateStr = b.startTime || b.createdAt;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;
      const bookingYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return bookingYm === selectedMonth;
    });
  }, [statementEligibleBookings, selectedMonth]);

  const exportStats = useMemo(() => {
    const totalCount = exportFilteredBookings.length;
    const totalSpend = exportFilteredBookings.reduce((sum, b) => {
      const amt =
        typeof b.amount === "number"
          ? b.amount
          : parseFloat(String(b.amount || 0));
      return sum + (isNaN(amt) ? 0 : amt);
    }, 0);
    const totalDiscount = exportFilteredBookings.reduce((sum, b) => {
      const amt =
        typeof b.discountAmount === "number"
          ? b.discountAmount
          : parseFloat(String(b.discountAmount || 0));
      return sum + (isNaN(amt) ? 0 : amt);
    }, 0);

    return {
      totalCount,
      totalSpend,
      totalDiscount,
    };
  }, [exportFilteredBookings]);

  const handleDownloadCsv = () => {
    try {
      setIsExporting(true);
      downloadBookingsCsv({
        bookings: exportFilteredBookings,
        periodLabel:
          selectedMonth === "ALL"
            ? "All Time"
            : formatMonthLabel(selectedMonth),
        customer: customerInfo,
      });
    } catch (err) {
      console.error("Failed to generate CSV statement:", err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadPdf = () => {
    try {
      setIsExporting(true);
      downloadBookingsPdf({
        bookings: exportFilteredBookings,
        periodLabel:
          selectedMonth === "ALL"
            ? "All Time"
            : formatMonthLabel(selectedMonth),
        customer: customerInfo,
      });
    } catch (err) {
      console.error("Failed to generate PDF statement:", err);
    } finally {
      setIsExporting(false);
    }
  };

  const fetchBookings = useCallback(
    async (forceRefresh = false, options: { silent?: boolean } = {}) => {
      const isSilent = options.silent ?? (bookings.length > 0 && forceRefresh);
      if (isSilent) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const data = await api.bookings.getMyBookings({ forceRefresh });
        setBookings(data);
      } catch (err) {
        console.warn("Could not load bookings:", err);
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [bookings.length],
  );

  // Handle return redirect from Paystack (?reference=... or ?trxref=...)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlParams = new URLSearchParams(window.location.search);
    const reference = urlParams.get("reference") || urlParams.get("trxref");

    if (!reference) {
      // Normal initial load without return callback
      fetchBookings();
      return;
    }

    if (verifiedRefTracker.current === reference) return;
    verifiedRefTracker.current = reference;

    // Clean query parameters from address bar immediately without unmounting component
    window.history.replaceState({}, document.title, window.location.pathname);

    setIsVerifyingReturn(true);
    setLoading(true);

    api.payments
      .verifyPayment(reference)
      .then(async (res) => {
        setVerifiedSuccessMessage(
          "Payment successfully confirmed! Your access pass is active.",
        );
        await fetchBookings(true, { silent: false });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("daih:loyalty-updated"));
        }
      })
      .catch((err) => {
        console.warn("Notice verifying payment on return:", err?.message);
        fetchBookings(true, { silent: false });
      })
      .finally(() => {
        setIsVerifyingReturn(false);
      });
  }, [fetchBookings]);

  // Auto-dismiss success message after 8 seconds
  useEffect(() => {
    if (!verifiedSuccessMessage) return;
    const timer = setTimeout(() => {
      setVerifiedSuccessMessage(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [verifiedSuccessMessage]);

  // Silent refresh on tab switch / window focus
  useEffect(() => {
    const handleFocus = () => {
      fetchBookings(true, { silent: true });
    };

    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleFocus);
      return () => window.removeEventListener("focus", handleFocus);
    }
  }, [fetchBookings]);

  const handlePayNow = async (bookingId: string) => {
    setPayingBookingId(bookingId);
    try {
      const callbackUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/bookings`
          : undefined;
      const res = await api.payments.initializePayment(bookingId, callbackUrl);
      if (res.authorization_url) {
        window.location.href = res.authorization_url;
      }
    } catch (err: any) {
      if (err?.code === "BOOKING_ALREADY_PAID") {
        setVerifiedSuccessMessage(
          "This booking is already paid and confirmed!",
        );
        await fetchBookings(true, { silent: true });
      } else {
        alert(err?.message || "Failed to initialize payment gateway");
      }
      setPayingBookingId(null);
    }
  };

  const handleCheckStatus = async (booking: BookingSummary) => {
    setCheckingBookingId(booking.id);
    try {
      // Find latest transaction reference for this booking or verify by booking id
      const res = await api.payments.verifyPayment(booking.id);
      if (
        res.status === "SUCCESSFUL" ||
        res.booking?.state === BookingState.CONFIRMED
      ) {
        setVerifiedSuccessMessage("Payment confirmed! Your booking is active.");
      }
      await fetchBookings(true, { silent: true });
    } catch (err: any) {
      console.warn("Check status notice:", err?.message);
      await fetchBookings(true, { silent: true });
    } finally {
      setCheckingBookingId(null);
    }
  };

  const handleViewInvoice = async (booking: BookingSummary) => {
    setLoadingInvoice(true);
    try {
      const invoice = await api.payments.getInvoice(booking.id);
      setSelectedInvoice(invoice);
    } catch (err: any) {
      alert(
        err?.message ||
          "Invoice is being generated. Please check back shortly.",
      );
    } finally {
      setLoadingInvoice(false);
    }
  };

  const handleCancelBooking = async (bookingId: string) => {
    setActionLoading(true);
    try {
      await api.bookings.cancelBooking(
        bookingId,
        cancelReason || "Customer requested cancellation",
      );
      setCancellingId(null);
      setCancelReason("");
      await fetchBookings(true);
    } catch (err: any) {
      alert(err?.message || "Failed to cancel booking");
    } finally {
      setActionLoading(false);
    }
  };

  const now = new Date();

  // Active Passes: Confirmed, Active, or Checked-in within their booking slot,
  // OR on Midday Break (Checked Out while endTime is still in the future)
  const activeBookings = bookings.filter((b) => {
    const isStateActive = [
      BookingState.CONFIRMED,
      BookingState.ACTIVE,
      BookingState.CHECKED_IN,
      BookingState.CHECKED_OUT,
    ].includes(b.state as BookingState);
    const notEnded = new Date(b.endTime) >= now;
    return isStateActive && notEnded;
  });

  // Historical / Ended Bookings:
  // 1. Any booking whose scheduled endTime has elapsed (including CHECKED_OUT, CHECKED_IN, CONFIRMED)
  // 2. Terminal lifecycle states: COMPLETED, NO_SHOW, CANCELLED, EXPIRED
  const historicalBookings = bookings.filter((b) => {
    const isEnded = new Date(b.endTime) < now;
    const isLegitHistoricalState = [
      BookingState.COMPLETED,
      BookingState.NO_SHOW,
      BookingState.CANCELLED,
      BookingState.EXPIRED,
    ].includes(b.state as BookingState);
    const isPastSession =
      [
        BookingState.CONFIRMED,
        BookingState.ACTIVE,
        BookingState.CHECKED_IN,
        BookingState.CHECKED_OUT,
      ].includes(b.state as BookingState) && isEnded;

    return isPastSession || isLegitHistoricalState;
  });

  const displayedBookings =
    activeTab === "active" ? activeBookings : historicalBookings;

  return (
    <div className="space-y-8">
      {/* Verification In-Progress Banner */}
      {isVerifyingReturn && !verifiedSuccessMessage && (
        <div className="bg-[#23055c] text-white p-4 rounded-2xl flex items-center justify-between shadow-md animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-amber-300 shrink-0" />
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                Processing Payment
              </h4>
              <p className="text-xs text-white/90">
                Verifying your transaction and issuing your pass...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Verified Success Banner */}
      {verifiedSuccessMessage && (
        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl flex items-center justify-between shadow-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-3 text-emerald-800">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900">
                Payment Confirmed
              </h4>
              <p className="text-xs text-emerald-700">
                {verifiedSuccessMessage}
              </p>
            </div>
          </div>
          <button
            onClick={() => setVerifiedSuccessMessage(null)}
            className="text-emerald-500 hover:text-emerald-800 text-xs font-bold cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#EBE7F5] pb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            My Bookings &amp; Passes
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Manage your active workspace reservations, payments, and access
            passes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowExportModal(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-purple-200 bg-purple-50/70 hover:bg-purple-100 text-[#23055c] font-bold text-xs transition-all shadow-2xs cursor-pointer"
            title="Download Statements & Financial Details"
          >
            <Download className="h-4 w-4 text-[#23055c]" />
            <span>Download Statement</span>
          </button>
          <button
            onClick={() => fetchBookings(true, { silent: true })}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
            title="Refresh Bookings"
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing || loading ? "animate-spin" : ""}`}
            />
          </button>
          <Link
            href="/book"
            className="bg-[#23055c] hover:bg-[#392271] text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all flex items-center gap-1.5 shadow-sm"
          >
            <span>Book New Space</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-6">
        <button
          onClick={() => setActiveTab("active")}
          className={`pb-3 text-xs font-bold transition-all relative cursor-pointer ${
            activeTab === "active"
              ? "text-[#23055c]"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Active Passes ({activeBookings.length})
          {activeTab === "active" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#23055c]" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`pb-3 text-xs font-bold transition-all relative cursor-pointer ${
            activeTab === "history"
              ? "text-[#23055c]"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Past &amp; Cancelled ({historicalBookings.length})
          {activeTab === "history" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#23055c]" />
          )}
        </button>
      </div>

      {/* Content */}
      {loading && !isVerifyingReturn ? (
        <div className="py-20 text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#23055c] mx-auto" />
          <p className="text-xs text-slate-500 font-semibold">
            Loading your reservations...
          </p>
        </div>
      ) : displayedBookings.length === 0 ? (
        <div className="py-20 text-center max-w-sm mx-auto space-y-4">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
            <Building2 className="h-8 w-8" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-800">
              {activeTab === "active"
                ? "No Active Bookings"
                : "No Past Bookings"}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {activeTab === "active"
                ? "You do not have any active space reservations. Reserve your spot today!"
                : "No past booking records found."}
            </p>
          </div>
          {activeTab === "active" && (
            <Link
              href="/book"
              className="inline-block bg-[#23055c] text-white text-xs font-bold px-5 py-2.5 rounded-xl hover:bg-[#392271] transition-all"
            >
              Explore Spaces
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {displayedBookings.map((b) => {
            const bStart = new Date(b.startTime);
            const bEnd = new Date(b.endTime);
            const todaySlotEnd =
              bEnd.toDateString() === now.toDateString()
                ? bEnd
                : bEnd.getHours() !== bStart.getHours() ||
                    bEnd.getMinutes() !== bStart.getMinutes()
                  ? new Date(
                      new Date(now).setHours(
                        bEnd.getHours(),
                        bEnd.getMinutes(),
                        bEnd.getSeconds(),
                        0,
                      ),
                    )
                  : bEnd;

            const isOnBreak =
              b.state === BookingState.CHECKED_OUT &&
              new Date(b.endTime) >= now &&
              now < todaySlotEnd;
            const isNoShow =
              b.state === BookingState.NO_SHOW ||
              (!b.checkedInAt &&
                b.state === BookingState.CONFIRMED &&
                new Date(b.endTime) < now);
            const isCompleted =
              b.state === BookingState.COMPLETED ||
              (b.state === BookingState.CHECKED_OUT &&
                new Date(b.endTime) < now) ||
              ((b.state === BookingState.CHECKED_IN ||
                b.state === BookingState.ACTIVE) &&
                new Date(b.endTime) < now);
            const isConfirmed =
              (b.state === BookingState.CONFIRMED ||
                b.state === BookingState.CHECKED_IN) &&
              !isNoShow &&
              !isCompleted &&
              !isOnBreak;
            const isHeld = b.state === BookingState.HELD;
            const isPendingPayment = b.state === BookingState.PENDING_PAYMENT;
            const isCancelled = b.state === BookingState.CANCELLED;
            const isExpired = b.state === BookingState.EXPIRED;

            return (
              <div
                key={b.id}
                className="bg-white rounded-2xl p-6 border border-[#EBE7F5] shadow-xs flex flex-col justify-between space-y-5 hover:border-[#23055c]/30 transition-all"
              >
                <div className="space-y-4">
                  {/* Top Bar */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-mono text-slate-400 block">
                        {b.reference}
                      </span>
                      <h3 className="text-base font-bold text-slate-900">
                        {b.resourceName}
                      </h3>
                    </div>
                    <div>
                      {isConfirmed && (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70 inline-flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span>
                            {b.state === BookingState.CHECKED_IN
                              ? "Checked In"
                              : "Confirmed"}
                          </span>
                        </span>
                      )}
                      {isOnBreak && (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/70 inline-flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          <span>On Break</span>
                        </span>
                      )}
                      {isPendingPayment && (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200/60 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                          <span>Processing Payment</span>
                        </span>
                      )}
                      {isHeld && (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-purple-50 text-purple-700 border border-purple-200/60 flex items-center gap-1">
                          <Clock className="h-3 w-3 animate-pulse" />
                          <span>Held &bull; Pay to Confirm</span>
                        </span>
                      )}
                      {isNoShow && (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200/60 flex items-center gap-1">
                          <XCircle className="h-3 w-3 text-rose-600" />
                          <span>No-Show &bull; Missed Date</span>
                        </span>
                      )}
                      {isCompleted && (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 text-slate-500" />
                          <span>
                            {b.state === BookingState.CHECKED_OUT
                              ? "Checked Out"
                              : "Completed"}
                          </span>
                        </span>
                      )}
                      {isExpired && (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-500 border border-slate-200 flex items-center gap-1">
                          <Clock className="h-3 w-3 text-slate-400" />
                          <span>Hold Expired</span>
                        </span>
                      )}
                      {isCancelled && (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200/60 flex items-center gap-1">
                          <span>Cancelled</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Dates & Location */}
                  <div className="bg-[#faf9ff] rounded-xl p-3.5 border border-[#EBE7F5] space-y-2 text-xs text-slate-600">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5 text-[#23055c] shrink-0" />
                      <span>
                        {formatDate(b.startTime)} &mdash;{" "}
                        {formatDate(b.endTime)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-[#23055c] shrink-0" />
                      <span>
                        {formatTime(b.startTime)} &mdash;{" "}
                        {formatTime(b.endTime)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-[#EBE7F5]/70 font-semibold">
                      <span className="text-slate-500">Amount</span>
                      <span className="text-[#23055c] font-bold">
                        {b.currency} {Number(b.amount).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  {isOnBreak && (
                    <>
                      <Link
                        href={`/qr?bookingId=${b.id}`}
                        className="flex-1 bg-[#23055c] hover:bg-[#392271] text-white text-xs font-bold py-2.5 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5"
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        <span>Re-enter / QR Pass</span>
                      </Link>
                      <button
                        onClick={() => handleOpenReview(b)}
                        disabled={checkingReviewId === b.id}
                        className="px-3 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
                        title="Rate & Review Workspace"
                      >
                        {checkingReviewId === b.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Star className="h-3.5 w-3.5 fill-current" />
                        )}
                        <span>Rate Stay</span>
                      </button>
                      <button
                        onClick={() => handleViewInvoice(b)}
                        disabled={loadingInvoice}
                        className="px-3 py-2.5 border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                        title="View Official Receipt"
                      >
                        <Receipt className="h-3.5 w-3.5" />
                        <span>Receipt</span>
                      </button>
                    </>
                  )}

                  {isConfirmed && (
                    <>
                      <Link
                        href={`/qr?bookingId=${b.id}`}
                        className="flex-1 bg-[#23055c] hover:bg-[#392271] text-white text-xs font-bold py-2.5 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5"
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        <span>View QR Pass</span>
                      </Link>
                      <button
                        onClick={() => handleViewInvoice(b)}
                        disabled={loadingInvoice}
                        className="px-3 py-2.5 border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                        title="View Official Receipt"
                      >
                        <Receipt className="h-3.5 w-3.5" />
                        <span>Receipt</span>
                      </button>
                    </>
                  )}

                  {(isNoShow || isCompleted) && (
                    <>
                      {isCompleted && (
                        <button
                          onClick={() => handleOpenReview(b)}
                          disabled={checkingReviewId === b.id}
                          className="px-3 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
                          title="Rate & Review Workspace"
                        >
                          {checkingReviewId === b.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Star className="h-3.5 w-3.5 fill-current" />
                          )}
                          <span>Rate Stay</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleViewInvoice(b)}
                        disabled={loadingInvoice}
                        className="flex-1 py-2.5 border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                        title="View Official Receipt"
                      >
                        <Receipt className="h-3.5 w-3.5" />
                        <span>Receipt</span>
                      </button>
                      <Link
                        href="/book"
                        className="px-3.5 py-2.5 bg-[#23055c] hover:bg-[#392271] text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1 shadow-2xs"
                      >
                        <span>Book Again</span>
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </>
                  )}

                  {/* Processing State */}
                  {isPendingPayment && (
                    <>
                      <button
                        disabled
                        className="flex-1 bg-amber-50 text-amber-800 border border-amber-200/80 text-xs font-bold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 cursor-not-allowed opacity-90 shadow-2xs"
                      >
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
                        <span>Processing...</span>
                      </button>
                      <button
                        onClick={() => handleCheckStatus(b)}
                        disabled={checkingBookingId === b.id}
                        className="px-3 py-2.5 border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                        title="Check Payment Status"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${checkingBookingId === b.id ? "animate-spin" : ""}`}
                        />
                        <span>Check Status</span>
                      </button>
                    </>
                  )}

                  {isHeld && (
                    <button
                      onClick={() => handlePayNow(b.id)}
                      disabled={payingBookingId === b.id}
                      className="flex-1 bg-[#23055c] hover:bg-[#392271] text-white text-xs font-bold py-2.5 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      {payingBookingId === b.id ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Connecting...</span>
                        </>
                      ) : (
                        <>
                          <CreditCard className="h-3.5 w-3.5" />
                          <span>Pay Now</span>
                        </>
                      )}
                    </button>
                  )}

                  {(isHeld || isPendingPayment) && (
                    <button
                      onClick={() => setCancellingId(b.id)}
                      className="px-3 py-2.5 border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                      title="Cancel Hold"
                    >
                      Cancel
                    </button>
                  )}

                  {isConfirmed && (
                    <button
                      onClick={() => setSupportModalBooking(b)}
                      className="px-3 py-2.5 border border-[#23055c]/20 text-[#23055c] hover:bg-[#23055c]/5 text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                      title="Reschedule / Support"
                    >
                      <span>Reschedule / Support</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Invoice & Receipt Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static print:z-auto">
          <div className="printable-receipt-container bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 space-y-6 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <img
                  src="/images/logo.png"
                  alt="DAIH Hub"
                  className="h-7 w-auto object-contain"
                />
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                    Payment Receipt
                  </h3>
                  <p className="text-[10px] text-slate-500 font-medium">
                    DAIH Hub Innovation &amp; Workspace Center
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="no-print p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer transition-colors"
                title="Close receipt"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="flex justify-between items-center bg-[#faf9ff] p-3.5 rounded-xl border border-[#EBE7F5]">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">
                    Invoice Number
                  </span>
                  <span className="font-extrabold text-[#23055c] text-sm">
                    {selectedInvoice.invoiceNumber}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">
                    Issued Date
                  </span>
                  <span className="text-slate-700 font-semibold">
                    {formatDate(selectedInvoice.issuedAt)}
                  </span>
                </div>
              </div>

              <div className="space-y-2 py-1">
                <div className="flex justify-between text-slate-600">
                  <span className="text-slate-500">Customer:</span>
                  <span className="font-bold text-slate-900">
                    {selectedInvoice.customerName} (
                    {selectedInvoice.customerClientId})
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="text-slate-500">Workspace / Space:</span>
                  <span className="font-semibold text-slate-900">
                    {selectedInvoice.resourceName}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="text-slate-500">Booking Reference:</span>
                  <span className="font-mono font-bold text-[#23055c]">
                    {selectedInvoice.bookingReference}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="text-slate-500">Payment Status:</span>
                  <span className="font-bold text-emerald-600 uppercase tracking-wider text-[11px]">
                    PAID / CONFIRMED
                  </span>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3 space-y-2">
                <span className="text-[11px] font-bold text-slate-500 uppercase block">
                  Line Items
                </span>
                {selectedInvoice.lineItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex justify-between text-slate-700 py-0.5"
                  >
                    <span>
                      {item.description} (x{item.quantity})
                    </span>
                    <span className="font-semibold">
                      {selectedInvoice.currency}{" "}
                      {Number(item.amount).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-200 pt-3 flex justify-between items-center text-sm font-extrabold text-[#23055c]">
                <span>Total Paid:</span>
                <span className="text-base">
                  {selectedInvoice.currency}{" "}
                  {Number(selectedInvoice.total).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="no-print flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => downloadReceiptPdf(selectedInvoice)}
                className="flex-1 py-2.5 border border-[#23055c]/20 bg-[#faf9ff] hover:bg-[#23055c]/5 rounded-xl text-xs font-bold text-[#23055c] transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                title="Download PDF Receipt"
              >
                <Download className="h-3.5 w-3.5 text-[#23055c]" />
                <span>Download Receipt</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="flex-1 py-2.5 bg-[#23055c] hover:bg-[#392271] text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-2xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {cancellingId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <h3 className="text-lg font-bold text-slate-900">
                Cancel Booking
              </h3>
            </div>
            <p className="text-xs text-slate-600">
              Are you sure you want to cancel this reservation? The slot will
              immediately be released for other members.
            </p>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                Reason for Cancellation (Optional)
              </label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Change of schedule, emergency"
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-[#23055c]"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setCancellingId(null);
                  setCancelReason("");
                }}
                disabled={actionLoading}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Keep Booking
              </button>
              <button
                onClick={() => handleCancelBooking(cancellingId)}
                disabled={actionLoading}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {actionLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                <span>Confirm Cancel</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule & Cancellation Policy Support Modal */}
      {supportModalBooking && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5 text-[#23055c]">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <h3 className="text-base font-bold text-slate-900">
                  Reschedule &amp; Policy Support
                </h3>
              </div>
              <button
                onClick={() => setSupportModalBooking(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs text-slate-600">
              <p>
                Under DAIH Hub&apos;s policy,{" "}
                <strong>
                  confirmed reservations cannot be cancelled or refunded
                </strong>{" "}
                once payment is completed.
              </p>
              <p>
                If you experienced an emergency, schedule conflict, or missed
                your session, an <strong>Operations Administrator</strong> can
                evaluate your reservation and grant a discretionary reschedule
                to an alternate available slot.
              </p>
              <div className="p-3 bg-purple-50 rounded-xl border border-purple-100 text-purple-900 space-y-1">
                <p className="font-bold">
                  Booking Reference: {supportModalBooking.reference}
                </p>
                <p className="text-[11px] text-purple-700">
                  Resource:{" "}
                  {supportModalBooking.resourceName || "Workspace Resource"}
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              <a
                href={`mailto:support@daih.ng?subject=Reschedule%20Request%20for%20Booking%20${supportModalBooking.reference}&body=Hello%20Operations%20Team%2C%0A%0AI%20would%20like%20to%20request%20a%20reschedule%20for%20my%20booking%20${supportModalBooking.reference}.%0A%0AReason%3A%20`}
                className="flex-1 py-2.5 bg-[#23055c] hover:bg-[#392271] text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 text-center"
              >
                <span>Email Operations Support</span>
              </a>
              <button
                onClick={() => setSupportModalBooking(null)}
                className="py-2.5 px-4 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Statement & Financials Download Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 space-y-5 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-[#23055c]/10 text-[#23055c] flex items-center justify-center shrink-0">
                  <Download className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Download Statement &amp; Details
                  </h3>
                  <p className="text-xs text-slate-500">
                    Export your reservations and financial summary
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Period Selection */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                Select Period / Month
              </label>
              <div className="relative">
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 outline-none focus:border-[#23055c] focus:bg-white transition-colors cursor-pointer appearance-none pr-8"
                >
                  <option value="ALL">
                    All Time (All Bookings - {statementEligibleBookings.length})
                  </option>
                  {availableMonths.map((ym) => (
                    <option key={ym} value={ym}>
                      {formatMonthLabel(ym)} ({getMonthCount(ym)}{" "}
                      {getMonthCount(ym) === 1 ? "booking" : "bookings"})
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
                  <Calendar className="h-4 w-4" />
                </div>
              </div>
            </div>

            {/* Metrics Overview Card */}
            <div className="bg-[#faf9ff] border border-[#23055c]/10 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#23055c]">
                  Period Summary (
                  {selectedMonth === "ALL"
                    ? "All Time"
                    : formatMonthLabel(selectedMonth)}
                  )
                </span>
                <span className="text-[11px] font-bold text-slate-500">
                  {exportStats.totalCount}{" "}
                  {exportStats.totalCount === 1
                    ? "reservation"
                    : "reservations"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-2xs">
                  <span className="block text-[10px] uppercase font-bold text-slate-400">
                    Bookings
                  </span>
                  <span className="text-sm font-extrabold text-slate-800">
                    {exportStats.totalCount}
                  </span>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-2xs">
                  <span className="block text-[10px] uppercase font-bold text-slate-400">
                    Total Spend
                  </span>
                  <span className="text-sm font-extrabold text-[#23055c]">
                    ₦{exportStats.totalSpend.toLocaleString()}
                  </span>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-2xs">
                  <span className="block text-[10px] uppercase font-bold text-slate-400">
                    Discounts
                  </span>
                  <span className="text-sm font-extrabold text-emerald-600">
                    ₦{exportStats.totalDiscount.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Export Format Actions */}
            <div className="space-y-2.5">
              <span className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                Choose Export Format
              </span>
              <div className="grid sm:grid-cols-2 gap-3">
                {/* PDF Statement */}
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={isExporting || exportFilteredBookings.length === 0}
                  className="p-3.5 rounded-2xl border border-[#23055c]/20 bg-[#23055c] hover:bg-[#34117c] text-white transition-all text-left flex flex-col justify-between gap-3 group cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <div className="h-8 w-8 rounded-xl bg-white/10 flex items-center justify-center">
                      <FileText className="h-4 w-4 text-white" />
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white">
                      .PDF
                    </span>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white group-hover:underline">
                      PDF Statement
                    </h4>
                    <p className="text-[10px] text-white/80 mt-0.5 leading-tight">
                      Branded statement with VAT &amp; verification details
                    </p>
                  </div>
                </button>

                {/* CSV Spreadsheet */}
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  disabled={isExporting || exportFilteredBookings.length === 0}
                  className="p-3.5 rounded-2xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100/80 text-emerald-950 transition-all text-left flex flex-col justify-between gap-3 group cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs hover:shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="h-8 w-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                      <FileSpreadsheet className="h-4 w-4" />
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200/70 text-emerald-900">
                      .CSV
                    </span>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-emerald-950 group-hover:underline">
                      Excel / CSV Export
                    </h4>
                    <p className="text-[10px] text-emerald-700 mt-0.5 leading-tight">
                      Full tabular data with all transaction columns
                    </p>
                  </div>
                </button>
              </div>
              {exportFilteredBookings.length === 0 && (
                <p className="text-center text-xs text-amber-600 font-medium pt-1">
                  No reservations found for this period.
                </p>
              )}
            </div>

            {/* Footer Close */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="w-full py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {showReviewModal && (
        <ReviewModal
          isOpen={showReviewModal}
          booking={reviewBooking}
          existingReview={existingReview}
          onClose={() => {
            setShowReviewModal(false);
            setReviewBooking(null);
            setExistingReview(null);
          }}
          onSuccess={() => {
            fetchBookings(true, { silent: true });
          }}
        />
      )}
    </div>
  );
}

export default function CustomerBookingsPage() {
  return (
    <Suspense
      fallback={
        <div className="py-20 text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#23055c] mx-auto" />
          <p className="text-xs text-slate-500 font-semibold">
            Loading reservations...
          </p>
        </div>
      }
    >
      <BookingsContent />
    </Suspense>
  );
}

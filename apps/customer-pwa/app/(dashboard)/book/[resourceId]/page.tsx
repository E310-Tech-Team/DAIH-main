"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth, api } from "@daih/api-client";
import {
  FacilityResource,
  ResourcePricingPlan,
  AvailabilityResultDTO,
  ResourceBlackout,
  CalendarAvailabilityResultDTO,
  DiscountPreviewResponseDTO,
  decodeHtmlEntities,
} from "@daih/types";
import {
  MapPin,
  CheckCircle2,
  Lock,
  Calendar as CalendarIcon,
  Users,
  Sparkles,
  ArrowLeft,
  Loader2,
  Clock,
  Check,
  ShieldCheck,
  Plus,
  Minus,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Timer,
  Tag,
  X,
  Coins,
} from "lucide-react";

import { getWorkspaceImage } from "../../../../lib/image-utils";
import { PdCoinRedemptionCard } from "../../../../components/book";

// ---- duration helpers ----
function getPlanDurationType(
  plan: ResourcePricingPlan,
): "hours" | "days" | "months" {
  if (plan.durationHours && plan.durationHours > 0) return "hours";
  if (plan.durationMonths && plan.durationMonths > 0) return "months";
  return "days";
}
function getPlanBaseUnit(plan: ResourcePricingPlan): number {
  if (plan.durationHours) return plan.durationHours;
  if (plan.durationMonths) return plan.durationMonths;
  return plan.durationDays || 1;
}
function getUnitLabel(plan: ResourcePricingPlan): string {
  if (plan.durationHours)
    return plan.durationHours === 1 ? "/hour" : `/${plan.durationHours}hr`;
  if (plan.durationMonths) {
    if (plan.durationMonths === 12) return "/year";
    if (plan.durationMonths % 12 === 0) return `/${plan.durationMonths / 12}yr`;
    return plan.durationMonths === 1 ? "/month" : `/${plan.durationMonths}mo`;
  }
  if (plan.durationDays && plan.durationDays === 7) return "/week";
  if (plan.durationDays && plan.durationDays > 1)
    return `/${plan.durationDays}d`;
  return "/day";
}

function toYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const cleanStr = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  return new Date(cleanStr + "T00:00:00").toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toYMD(d);
}
function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return toYMD(d);
}
function formatTime(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const ampm = h >= 12 ? "PM" : "AM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:00 ${ampm}`;
}

// ---- DurationSelector sub-component ----
interface DurationSelectorProps {
  plan: ResourcePricingPlan;
  quantity: number;
  onQuantityChange: (q: number) => void;
  startDate: string;
  onStartDateChange: (d: string) => void;
  startHour: number;
  onStartHourChange: (h: number) => void;
  endDate: string;
  endHour: number;
  blackouts?: ResourceBlackout[];
  calendarData?: CalendarAvailabilityResultDTO | null;
}

function DurationSelector({
  plan,
  quantity,
  onQuantityChange,
  startDate,
  onStartDateChange,
  startHour,
  onStartHourChange,
  endDate,
  endHour,
  blackouts,
  calendarData,
}: DurationSelectorProps) {
  const durType = getPlanDurationType(plan);
  const baseUnit = getPlanBaseUnit(plan);
  const today = toYMD(new Date());
  const minQty = 1;
  const maxQty =
    durType === "hours"
      ? 24
      : durType === "months"
        ? baseUnit >= 12
          ? 5
          : 12
        : 90;
  const totalUnits = baseUnit * quantity;
  const stepUp = () => onQuantityChange(Math.min(quantity + 1, maxQty));
  const stepDown = () => onQuantityChange(Math.max(quantity - 1, minQty));
  const hourPresets = [1, 2, 3, 4, 6, 8];
  const dayPresets = [1, 2, 3, 5, 7, 14];
  const monthPresets = [1, 2, 3, 6, 12];

  const [showFullMonth, setShowFullMonth] = useState(false);

  const activeBlackouts = useMemo(() => {
    if (!blackouts || blackouts.length === 0) return [];
    return blackouts.filter((b: ResourceBlackout) => b.isActive);
  }, [blackouts]);

  const selectedDayInfo = calendarData?.busyDates?.[startDate];
  const bookedHourSlots = selectedDayInfo?.bookedHourSlots || [];
  const isSelectedDateBlackout = selectedDayInfo?.status === "BLACKOUT";
  const isSelectedDateClosed = selectedDayInfo?.status === "CLOSED";

  const baseDate = useMemo(() => {
    const parsed = new Date(startDate);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [startDate]);

  const firstDayOfWeekOffset = useMemo(() => {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    return new Date(year, month, 1).getDay();
  }, [baseDate]);

  const daysInMonthList = useMemo(() => {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const totalDays = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: totalDays }, (_, i) => {
      const d = new Date(year, month, i + 1);
      return toYMD(d);
    });
  }, [baseDate]);

  return (
    <div className="space-y-4 border border-[#EBE7F5] rounded-xl p-3.5 sm:p-4 bg-[#faf9ff] min-w-0 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-[#23055c] uppercase tracking-wide">
          {durType === "hours"
            ? "Duration & Time"
            : durType === "months"
              ? "Duration & Start Month"
              : "Date Range"}
        </h4>
        <button
          type="button"
          onClick={() => setShowFullMonth(!showFullMonth)}
          className="text-[11px] font-bold text-[#23055c] hover:underline flex items-center gap-1 bg-white px-2.5 py-1 border border-[#EBE7F5] rounded-lg shadow-2xs cursor-pointer"
        >
          <CalendarIcon className="h-3 w-3" />
          <span>{showFullMonth ? "Hide Full Month" : "Full Month View"}</span>
        </button>
      </div>

      {isSelectedDateBlackout && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-center gap-2 text-amber-800 text-xs font-semibold min-w-0">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="break-words">
            {selectedDayInfo?.reason || "Scheduled maintenance on this date"}
          </span>
        </div>
      )}

      {isSelectedDateClosed && (
        <div className="bg-slate-100 border border-slate-200 rounded-lg p-2.5 flex items-center gap-2 text-slate-700 text-xs font-semibold min-w-0">
          <AlertCircle className="h-4 w-4 text-slate-500 shrink-0" />
          <span>Workspace is closed on this day of the week</span>
        </div>
      )}

      {/* Expandable Full Month Calendar Grid */}
      {showFullMonth && (
        <div className="bg-white border border-slate-200 rounded-xl p-2.5 sm:p-3 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200 min-w-0 max-w-full overflow-hidden">
          <div className="flex flex-wrap items-center justify-between text-xs font-bold text-[#23055c] gap-1">
            <span>
              {baseDate.toLocaleString("en-US", {
                month: "long",
                year: "numeric",
              })}{" "}
              Availability
            </span>
            <span className="text-[10px] text-slate-400 font-normal">
              Click any open day to select
            </span>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center w-full">
            {["S", "M", "T", "W", "T", "F", "S"].map((day, idx) => (
              <div
                key={idx}
                className="text-[9px] font-extrabold text-slate-400 uppercase py-0.5"
              >
                {day}
              </div>
            ))}
            {Array.from({ length: firstDayOfWeekOffset }).map((_, idx) => (
              <div key={`offset-${idx}`} className="h-7" />
            ))}
            {daysInMonthList.map((ymd) => {
              const dayNum = parseInt(ymd.split("-")[2], 10);
              const info = calendarData?.busyDates?.[ymd];
              const isSelected = startDate === ymd;
              const isFull = info?.status === "FULL";
              const isBlackout = info?.status === "BLACKOUT";
              const isClosed = info?.status === "CLOSED";
              const isUnavailable = isFull || isBlackout || isClosed;

              return (
                <button
                  key={ymd}
                  type="button"
                  disabled={isUnavailable}
                  onClick={() => {
                    onStartDateChange(ymd);
                    setShowFullMonth(false);
                  }}
                  className={`h-7 rounded-lg text-[10px] font-bold flex flex-col items-center justify-center transition-all border ${
                    isUnavailable
                      ? "bg-slate-100 text-slate-300 border-slate-100 cursor-not-allowed line-through"
                      : isSelected
                        ? "bg-[#23055c] text-white border-[#23055c] ring-2 ring-[#23055c]/20 font-extrabold"
                        : "bg-emerald-50/60 text-emerald-950 border-emerald-200/80 hover:bg-emerald-100"
                  }`}
                  title={`${ymd}: ${info?.status || "AVAILABLE"}`}
                >
                  <span>{dayNum}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3 min-w-0">
        <div className="min-w-0">
          <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">
            {durType === "hours" ? "Date" : "Start Date"}
          </label>
          <div className="flex items-center border border-slate-200 rounded-lg px-2.5 py-2 bg-white focus-within:border-[#23055c] focus-within:ring-1 focus-within:ring-[#23055c]/30 transition-all min-w-0">
            <CalendarIcon className="h-3.5 w-3.5 text-slate-400 mr-1.5 shrink-0" />
            <input
              type="date"
              min={today}
              className="bg-transparent border-none outline-none w-full min-w-0 text-xs font-medium text-slate-800"
              value={startDate}
              onChange={(e) => onStartDateChange(e.target.value)}
            />
          </div>
        </div>
        {durType === "hours" ? (
          <div className="min-w-0">
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">
              Start Time
            </label>
            <div className="flex items-center border border-slate-200 rounded-lg px-2.5 py-2 bg-white focus-within:border-[#23055c] focus-within:ring-1 focus-within:ring-[#23055c]/30 transition-all min-w-0">
              <Clock className="h-3.5 w-3.5 text-slate-400 mr-1.5 shrink-0" />
              <select
                className="bg-transparent border-none outline-none w-full min-w-0 text-xs font-medium text-slate-800"
                value={startHour}
                onChange={(e) => onStartHourChange(Number(e.target.value))}
              >
                {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => {
                  const isBooked = bookedHourSlots.includes(h);
                  return (
                    <option key={h} value={h} disabled={isBooked}>
                      {formatTime(h)} {isBooked ? "(Booked)" : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">
              End Date
            </label>
            <div className="flex items-center border border-slate-200 rounded-lg px-2.5 py-2 bg-white cursor-not-allowed min-w-0">
              <CalendarIcon className="h-3.5 w-3.5 text-slate-300 mr-1.5 shrink-0" />
              <span className="text-xs font-medium text-slate-500 truncate">
                {formatDate(endDate)}
              </span>
            </div>
          </div>
        )}
      </div>

      {durType === "hours" && (
        <div className="space-y-1.5 pt-1 min-w-0">
          <label className="text-[10px] font-bold text-slate-500 uppercase block">
            Available Start Time
          </label>
          <div className="grid grid-cols-3 min-[400px]:grid-cols-4 sm:grid-cols-6 gap-1.5 min-w-0">
            {Array.from({ length: 14 }, (_, i) => i + 7).map((h) => {
              const isBooked = bookedHourSlots.includes(h);
              const isSelected = startHour === h;
              return (
                <button
                  key={h}
                  type="button"
                  disabled={isBooked}
                  onClick={() => onStartHourChange(h)}
                  className={`px-1 py-1.5 rounded-lg text-[10px] min-[400px]:text-[11px] font-bold transition-all text-center flex flex-col items-center justify-center border min-w-0 ${
                    isBooked
                      ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed line-through"
                      : isSelected
                        ? "bg-[#23055c] text-white border-[#23055c] shadow-sm"
                        : "bg-white text-slate-700 border-slate-200 hover:border-[#23055c]"
                  }`}
                >
                  <span className="truncate w-full">{formatTime(h)}</span>
                  {isBooked && (
                    <span className="text-[8px] font-normal no-underline text-rose-500">
                      Booked
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {durType !== "hours" && (
        <div className="space-y-1.5 pt-1 min-w-0 max-w-full">
          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar min-w-0 max-w-full">
            {Array.from({ length: 7 }, (_, i) => {
              const d = new Date(baseDate);
              d.setDate(d.getDate() + i);
              const ymd = toYMD(d);
              const dayInfo = calendarData?.busyDates?.[ymd];
              const isSelected = startDate === ymd;
              const isFull = dayInfo?.status === "FULL";
              const isBlackout = dayInfo?.status === "BLACKOUT";
              const isClosed = dayInfo?.status === "CLOSED";
              const isUnavailable = isFull || isBlackout || isClosed;

              const label = d.toLocaleDateString("en-US", {
                weekday: "short",
                month: "numeric",
                day: "numeric",
              });

              return (
                <button
                  key={ymd}
                  type="button"
                  disabled={isUnavailable}
                  onClick={() => onStartDateChange(ymd)}
                  className={`px-2.5 py-2 rounded-xl text-center shrink-0 border transition-all ${
                    isUnavailable
                      ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed line-through opacity-60"
                      : isSelected
                        ? "bg-[#23055c] text-white border-[#23055c] shadow-sm ring-2 ring-[#23055c]/20"
                        : "bg-white text-slate-700 border-slate-200 hover:border-[#23055c]"
                  }`}
                >
                  <div className="text-[11px] font-bold whitespace-nowrap">
                    {label}
                  </div>
                  <div
                    className={`text-[9px] font-semibold mt-0.5 ${isSelected ? "text-purple-200" : isUnavailable ? "text-rose-500" : "text-emerald-600"}`}
                  >
                    {isBlackout
                      ? "Maint."
                      : isClosed
                        ? "Closed"
                        : isFull
                          ? "Full"
                          : "Open"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">
          {durType === "hours"
            ? `Number of ${baseUnit > 1 ? `${baseUnit}-Hour Blocks` : "Hours"}`
            : durType === "months"
              ? `Number of ${baseUnit === 12 ? "Years" : baseUnit > 1 ? `${baseUnit}-Month Blocks` : "Months"}`
              : `Number of ${baseUnit > 1 ? `${baseUnit}-Day Blocks` : "Days"}`}
        </label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={stepDown}
            disabled={quantity <= minQty}
            className="w-9 h-9 rounded-full border-2 border-[#23055c]/20 flex items-center justify-center hover:border-[#23055c] hover:bg-[#23055c] hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <div className="flex-1 text-center">
            <span className="text-2xl font-extrabold text-[#23055c]">
              {quantity}
            </span>
            <span className="text-xs text-slate-500 ml-1.5">
              {durType === "hours"
                ? totalUnits === 1
                  ? "hour"
                  : "hours"
                : durType === "months"
                  ? totalUnits === 1
                    ? "month"
                    : "months"
                  : totalUnits === 1
                    ? "day"
                    : "days"}
            </span>
          </div>
          <button
            type="button"
            onClick={stepUp}
            disabled={quantity >= maxQty}
            className="w-9 h-9 rounded-full border-2 border-[#23055c]/20 flex items-center justify-center hover:border-[#23055c] hover:bg-[#23055c] hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          {durType === "hours" &&
            baseUnit === 1 &&
            hourPresets.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onQuantityChange(q)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all ${quantity === q ? "bg-[#23055c] text-white border-[#23055c]" : "bg-white text-slate-600 border-slate-200 hover:border-[#23055c]"}`}
              >
                {q}hr
              </button>
            ))}
          {durType === "days" &&
            baseUnit === 1 &&
            dayPresets.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onQuantityChange(q)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all ${quantity === q ? "bg-[#23055c] text-white border-[#23055c]" : "bg-white text-slate-600 border-slate-200 hover:border-[#23055c]"}`}
              >
                {q === 7 ? "1wk" : q === 14 ? "2wks" : `${q}d`}
              </button>
            ))}
          {durType === "months" &&
            baseUnit === 1 &&
            monthPresets.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onQuantityChange(q)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all ${quantity === q ? "bg-[#23055c] text-white border-[#23055c]" : "bg-white text-slate-600 border-slate-200 hover:border-[#23055c]"}`}
              >
                {q === 1
                  ? "1mo"
                  : q === 3
                    ? "Qtr"
                    : q === 6
                      ? "6mo"
                      : q === 12
                        ? "1yr"
                        : `${q}mo`}
              </button>
            ))}
        </div>
      </div>

      {durType === "hours" && (
        <div className="flex items-center gap-2 bg-[#23055c]/5 rounded-lg px-3 py-2">
          <Clock className="h-3.5 w-3.5 text-[#23055c] shrink-0" />
          <span className="text-xs font-semibold text-[#23055c]">
            {formatTime(startHour)} &mdash; {formatTime(endHour)} ({totalUnits}
            hr{totalUnits > 1 ? "s" : ""})
          </span>
        </div>
      )}

      {/* Scheduled Maintenance & Unavailable Dates Display */}
      {activeBlackouts.length > 0 && (
        <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-3.5 space-y-2 mt-3">
          <div className="flex items-center gap-1.5 text-amber-900 text-xs font-bold">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>Scheduled Maintenance & Blackout Dates</span>
          </div>
          <p className="text-[11px] text-amber-800">
            The following dates are reserved for maintenance or private events
            and are unavailable:
          </p>
          <div className="space-y-1.5 pt-1">
            {activeBlackouts.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between bg-white border border-amber-200/80 rounded-lg px-3 py-1.5 text-xs text-amber-950"
              >
                <span className="font-semibold">
                  {formatDate(b.startDate)} &mdash; {formatDate(b.endDate)}
                </span>
                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  {b.reason || "Maintenance"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Main Page ----
export default function PlanSelectionAndCheckoutPage() {
  const router = useRouter();
  const params = useParams();
  const rawId = String(params?.resourceId || "flex-desk");
  const slug =
    rawId === "hot-desk"
      ? "flex-desk"
      : rawId === "office-suite"
        ? "private-office"
        : rawId;
  const { user } = useAuth();

  const [resource, setResource] = useState<FacilityResource | null>(null);
  const [plans, setPlans] = useState<ResourcePricingPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>(
    () => new Date().toISOString().split("T")[0],
  );
  const [startHour, setStartHour] = useState<number>(8);
  const [quantity, setQuantity] = useState<number>(1);
  const [loading, setLoading] = useState(true);

  // Real-time Availability State
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [availabilityResult, setAvailabilityResult] =
    useState<AvailabilityResultDTO | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(
    null,
  );

  // Hold & Checkout State
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRedirectingPaystack, setIsRedirectingPaystack] = useState(false);
  const [activeHoldId, setActiveHoldId] = useState<string | null>(null);
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(null);
  const [remainingHoldSeconds, setRemainingHoldSeconds] = useState<
    number | null
  >(null);
  const [confirmed, setConfirmed] = useState(false);
  const [bookingRef, setBookingRef] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [calendarData, setCalendarData] =
    useState<CalendarAvailabilityResultDTO | null>(null);

  // Discount & Promo state
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [userManualPromo, setUserManualPromo] = useState<string | null>(null);
  const [showPromoInput, setShowPromoInput] = useState(false);
  const [appliedDiscount, setAppliedDiscount] =
    useState<DiscountPreviewResponseDTO | null>(null);
  const [isValidatingPromo, setIsValidatingPromo] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  // PD Coin Loyalty Discount State
  const [loyaltyDiscountNgn, setLoyaltyDiscountNgn] = useState<number>(0);
  const [redeemedCoinsCount, setRedeemedCoinsCount] = useState<number>(0);

  useEffect(() => {
    if (!resource) return;
    const targetMonth = startDate.slice(0, 7);
    let isMounted = true;
    api.bookings
      .getCalendarAvailability({
        resourceId: resource.id || slug,
        month: targetMonth,
      })
      .then((data) => {
        if (isMounted) setCalendarData(data);
      })
      .catch((err) => {
        console.warn("Could not fetch calendar availability:", err?.message);
      });
    return () => {
      isMounted = false;
    };
  }, [resource, slug, startDate]);

  const loadResource = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.catalogue.getResourceBySlug(slug);
      if (data) {
        setResource(data);
        const backendPlans = data.pricing || [];
        setPlans(backendPlans as ResourcePricingPlan[]);
        if (backendPlans.length > 0) {
          const popular =
            backendPlans.find((p) => p.isPopular) || backendPlans[0];
          setSelectedPlanId(popular.id);
        }
      } else {
        setResource(null);
        setPlans([]);
      }
    } catch (err) {
      console.error("Failed to load live workspace resource:", err);
      setResource(null);
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    loadResource();
  }, [loadResource]);
  useEffect(() => {
    setQuantity(1);
  }, [selectedPlanId]);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) || plans[0] || null,
    [plans, selectedPlanId],
  );
  const durType = selectedPlan ? getPlanDurationType(selectedPlan) : "days";
  const baseUnit = selectedPlan ? getPlanBaseUnit(selectedPlan) : 1;
  const totalUnits = baseUnit * quantity;

  const endDate = useMemo(() => {
    if (!selectedPlan) return startDate;
    if (durType === "months") return addMonths(startDate, totalUnits);
    if (durType === "days") return addDays(startDate, totalUnits - 1);
    return startDate;
  }, [selectedPlan, startDate, durType, totalUnits]);

  const endHour = useMemo(() => {
    if (durType === "hours") return (startHour + totalUnits) % 24;
    return 18;
  }, [durType, startHour, totalUnits]);

  // Compute calculated start and end ISO strings for availability check (WAT UTC+1)
  const [startIso, endIso] = useMemo(() => {
    if (durType === "hours") {
      const s = new Date(
        `${startDate}T${String(startHour).padStart(2, "0")}:00:00+01:00`,
      ).toISOString();
      const e = new Date(
        `${startDate}T${String(endHour).padStart(2, "0")}:00:00+01:00`,
      ).toISOString();
      return [s, e];
    }
    const s = new Date(`${startDate}T08:00:00+01:00`).toISOString();
    const e = new Date(`${endDate}T18:00:00+01:00`).toISOString();
    return [s, e];
  }, [durType, startDate, startHour, endDate, endHour]);

  // If selected startHour is fully booked on this day, auto-select the first available hour
  useEffect(() => {
    if (durType !== "hours" || !calendarData) return;
    const dayInfo = calendarData.busyDates?.[startDate];
    const bookedSlots: number[] = dayInfo?.bookedHourSlots || [];
    if (bookedSlots.includes(startHour)) {
      const firstOpen = Array.from({ length: 14 }, (_, i) => i + 7).find(
        (h) => !bookedSlots.includes(h),
      );
      if (firstOpen !== undefined) {
        setStartHour(firstOpen);
      }
    }
  }, [durType, calendarData, startDate, startHour]);

  // Real-time Availability Check: Triggers immediately whenever resource, startIso, or endIso changes
  useEffect(() => {
    if (!resource) return;
    let isCurrent = true;
    setCheckingAvailability(true);
    setErrorMessage(null);

    const timer = setTimeout(() => {
      api.bookings
        .checkAvailability({
          resourceId: resource.id || slug,
          startTime: startIso,
          endTime: endIso,
        })
        .then((res) => {
          if (isCurrent) {
            setAvailabilityResult(res);
            setAvailabilityError(null);
          }
        })
        .catch((err) => {
          if (isCurrent) {
            console.warn("Availability check notice:", err);
            setAvailabilityResult(null);
            setAvailabilityError(
              err?.message ||
                "Could not confirm workspace availability. Please check your network connection or try again.",
            );
          }
        })
        .finally(() => {
          if (isCurrent) setCheckingAvailability(false);
        });
    }, 250);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [resource, slug, startIso, endIso]);

  // Countdown timer effect for active 10-minute hold
  useEffect(() => {
    if (!holdExpiresAt) return;

    const interval = setInterval(() => {
      const diffMs = new Date(holdExpiresAt).getTime() - Date.now();
      const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
      setRemainingHoldSeconds(diffSecs);

      if (diffSecs <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [holdExpiresAt]);

  const subtotal = selectedPlan ? Number(selectedPlan.price) * quantity : 0;
  const totalAmount = appliedDiscount?.eligible
    ? appliedDiscount.grandTotal
    : subtotal;

  // Preview discounts: auto-discounts or user-entered promo code
  useEffect(() => {
    const resId = resource?.id || slug;
    if (!resId || !selectedPlan?.id || subtotal <= 0) return;

    if (userManualPromo) {
      api.discounts
        .preview({
          code: userManualPromo,
          resourceId: resId,
          planId: selectedPlan?.id,
          startTime: startIso,
          endTime: endIso,
        })
        .then((res) => {
          if (res.eligible && res.discountAmount > 0) {
            setAppliedDiscount(res);
          } else {
            setAppliedDiscount(null);
            setPromoError(
              res.reason ||
                "Promo code is no longer valid for the updated selection.",
            );
          }
        })
        .catch(() => {
          setAppliedDiscount(null);
        });
    } else {
      // Evaluate active automatic discount
      api.discounts
        .preview({
          resourceId: resId,
          planId: selectedPlan?.id,
          startTime: startIso,
          endTime: endIso,
        })
        .then((res) => {
          if (res.eligible && res.discountAmount > 0) {
            setAppliedDiscount(res);
          } else {
            setAppliedDiscount(null);
          }
        })
        .catch(() => {
          setAppliedDiscount(null);
        });
    }
  }, [
    subtotal,
    startIso,
    endIso,
    selectedPlan?.id,
    resource?.id,
    slug,
    userManualPromo,
  ]);

  const handleApplyPromoCode = async () => {
    const trimmed = promoCodeInput.trim().toUpperCase();
    if (!trimmed) return;
    setIsValidatingPromo(true);
    setPromoError(null);

    try {
      const res = await api.discounts.preview({
        code: trimmed,
        resourceId: resource?.id || slug,
        planId: selectedPlan?.id,
        startTime: startIso,
        endTime: endIso,
      });

      if (!res.eligible) {
        setPromoError(
          res.reason || "Invalid discount code or requirements not met.",
        );
      } else {
        setUserManualPromo(trimmed);
        setAppliedDiscount(res);
        setPromoError(null);
        setShowPromoInput(false);
      }
    } catch (err: any) {
      setPromoError(err?.message || "Failed to validate promo code.");
    } finally {
      setIsValidatingPromo(false);
    }
  };

  const handleRemovePromo = () => {
    setUserManualPromo(null);
    setPromoCodeInput("");
    setPromoError(null);
    setAppliedDiscount(null);
    setShowPromoInput(false);
  };

  const durationLabel = useMemo(() => {
    if (!selectedPlan) return "\u2014";
    if (durType === "hours")
      return `${totalUnits} ${totalUnits === 1 ? "Hour" : "Hours"} (${formatTime(startHour)} \u2014 ${formatTime(endHour)})`;
    if (durType === "months") {
      if (totalUnits % 12 === 0) {
        const years = totalUnits / 12;
        return `${years} ${years === 1 ? "Year" : "Years"} (${formatDate(startDate)} \u2014 ${formatDate(endDate)})`;
      }
      return `${totalUnits} ${totalUnits === 1 ? "Month" : "Months"} (${formatDate(startDate)} \u2014 ${formatDate(endDate)})`;
    }
    if (totalUnits === 1) return formatDate(startDate);
    return `${totalUnits} Days (${formatDate(startDate)} \u2014 ${formatDate(endDate)})`;
  }, [
    selectedPlan,
    durType,
    totalUnits,
    startHour,
    endHour,
    startDate,
    endDate,
  ]);

  const breakdownLabel = useMemo(() => {
    if (!selectedPlan || quantity === 1) return null;
    return `\u20A6${Number(selectedPlan.price).toLocaleString()}${getUnitLabel(selectedPlan)} \u00D7 ${quantity}`;
  }, [selectedPlan, quantity]);

  // Handle Checkout / Hold Creation & Payment Grace Extension
  const handleCheckout = async () => {
    if (!resource || !selectedPlan) return;
    if (availabilityError) {
      setErrorMessage(
        "Workspace availability could not be confirmed. Please check your connection or retry.",
      );
      return;
    }
    if (availabilityResult && !availabilityResult.available) {
      setErrorMessage(
        availabilityResult.reason ||
          "This space is not available for the selected dates.",
      );
      return;
    }

    if (!user) {
      router.push(`/login?redirect=/book/${slug}`);
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      if (!activeHoldId) {
        // Create 10-minute hold
        const hold = await api.bookings.createHold({
          resourceId: resource.id || slug,
          planId: selectedPlan.id,
          startTime: startIso,
          endTime: endIso,
          promoCode:
            userManualPromo ||
            (appliedDiscount?.code ? appliedDiscount.code : undefined),
        });

        setActiveHoldId(hold.bookingId);
        setHoldExpiresAt(hold.holdExpiresAt);
        setBookingRef(hold.reference);

        if (
          hold.discountAmount !== undefined &&
          hold.discountAmount > 0 &&
          appliedDiscount
        ) {
          setAppliedDiscount({
            ...appliedDiscount,
            discountAmount: hold.discountAmount,
            grandTotal: hold.totalAmount,
          });
        }

        setConfirmed(true);
      } else {
        // Extend hold grace period for active checkout session
        const ext = await api.bookings.extendHold(activeHoldId);
        setHoldExpiresAt(ext.holdExpiresAt);

        setConfirmed(true);
      }
    } catch (err: any) {
      if (err?.status === 401 || err?.code === "UNAUTHORIZED") {
        router.push(`/login?redirect=/book/${slug}`);
        return;
      }
      setErrorMessage(
        err?.message ||
          "Could not complete reservation hold. Please try another slot.",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProceedToPayment = async () => {
    if (!activeHoldId) return;
    setIsRedirectingPaystack(true);
    try {
      const callbackUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/bookings`
          : undefined;
      const res = await api.payments.initializePayment(
        activeHoldId,
        callbackUrl,
      );
      if (res.authorization_url) {
        window.location.href = res.authorization_url;
      }
    } catch (err: any) {
      alert(err?.message || "Failed to initialize payment gateway");
      setIsRedirectingPaystack(false);
    }
  };

  const imageSrc = getWorkspaceImage(
    resource?.slug || slug,
    resource?.imageUrl,
  );

  const isSlotUnavailable = Boolean(
    (availabilityResult && !availabilityResult.available) || availabilityError,
  );
  const remainingSecs = remainingHoldSeconds ?? 0;
  const holdMinutes = Math.floor(remainingSecs / 60);
  const holdSecs = remainingSecs % 60;
  const isHoldExpired = Boolean(activeHoldId && remainingSecs <= 0);

  if (loading && !resource) {
    return (
      <div className="py-24 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#23055c] mx-auto" />
          <p className="text-xs text-slate-500 font-semibold">
            Loading workspace and pricing options...
          </p>
        </div>
      </div>
    );
  }

  if (!loading && !resource) {
    return (
      <div className="py-24 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-2xl p-10 border border-[#EBE7F5] shadow-sm text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
            <AlertCircle className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">
            Workspace Not Found
          </h2>
          <p className="text-xs text-slate-500">
            We couldn't locate this workspace in our active inventory.
          </p>
          <Link
            href="/book"
            className="inline-block px-5 py-2.5 rounded-xl bg-[#23055c] text-white font-bold text-xs hover:bg-[#35089e] transition-colors"
          >
            Explore Available Spaces
          </Link>
        </div>
      </div>
    );
  }

  if (confirmed) {
    const finalAmountDue = Math.max(0, totalAmount - loyaltyDiscountNgn);
    return (
      <div className="py-24 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-2xl p-6 sm:p-10 border border-[#EBE7F5] shadow-sm text-center space-y-5">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#23055c]/10 flex items-center justify-center mx-auto">
            <Check className="h-7 w-7 sm:h-8 sm:w-8 text-[#23055c]" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900">
              Booking Reserved!
            </h2>
            <p className="text-xs text-slate-500">
              Your 10-minute hold is secured. Complete payment to activate your
              pass.
            </p>
          </div>
          <div className="bg-[#faf9ff] rounded-xl p-4 border border-[#EBE7F5] space-y-2 text-left text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Reference</span>
              <span className="font-bold text-[#23055c]">{bookingRef}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Workspace</span>
              <span className="font-bold text-slate-900">{resource?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Plan</span>
              <span className="font-bold text-slate-900">
                {selectedPlan?.planName}
              </span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-slate-500">Duration</span>
              <span className="font-medium text-slate-800 text-right max-w-[60%]">
                {durationLabel}
              </span>
            </div>
            {appliedDiscount?.eligible && (
              <div className="flex justify-between items-center text-emerald-700 text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" />
                  Discount ({appliedDiscount.code})
                </span>
                <span>
                  -{"\u20A6"}
                  {appliedDiscount.discountAmount.toLocaleString()}.00
                </span>
              </div>
            )}
            {loyaltyDiscountNgn > 0 && (
              <div className="flex justify-between items-center text-amber-700 text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <Coins className="h-3.5 w-3.5 text-amber-500" />
                  PD Coin Discount ({redeemedCoinsCount.toLocaleString()} PDC)
                </span>
                <span>
                  -{"\u20A6"}
                  {loyaltyDiscountNgn.toLocaleString()}.00
                </span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-[#EBE7F5]">
              <span className="text-slate-500">Amount Due</span>
              <span className="font-extrabold text-[#23055c]">
                {"\u20A6"}
                {finalAmountDue.toLocaleString()}.00
              </span>
            </div>
          </div>

          {/* PD Coin Loyalty Redemption Component */}
          {activeHoldId && (
            <PdCoinRedemptionCard
              bookingId={activeHoldId}
              bookingTotalAmount={totalAmount}
              appliedCoins={redeemedCoinsCount}
              appliedDiscountNgn={loyaltyDiscountNgn}
              onRedemptionChange={(discountNgn, coins) => {
                setLoyaltyDiscountNgn(discountNgn);
                setRedeemedCoinsCount(coins);
              }}
            />
          )}

          <div className="flex flex-col gap-3">
            <button
              onClick={handleProceedToPayment}
              disabled={isRedirectingPaystack}
              className="w-full bg-[#23055c] hover:bg-[#392271] text-white font-bold text-xs py-3.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 cursor-pointer"
            >
              {isRedirectingPaystack ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Connecting to secure checkout...</span>
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  <span>Proceed to Secure Checkout</span>
                </>
              )}
            </button>
            <Link
              href="/bookings"
              className="w-full py-3 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-colors text-center"
            >
              View in My Bookings
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 min-w-0 max-w-full">
      {/* Hero Banner */}
      <div className="relative h-[240px] sm:h-[300px] md:h-[340px] w-full rounded-2xl overflow-hidden shadow-xs border border-slate-200 min-w-0">
        <img
          alt={resource?.name || "Workspace"}
          className="w-full h-full object-cover"
          src={imageSrc}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
        <button
          onClick={() => router.back()}
          className="absolute top-4 left-4 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white rounded-full p-2.5 transition-all z-10 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 text-white min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 min-w-0">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight drop-shadow truncate">
                {resource?.name}
              </h1>
              <div className="flex flex-wrap items-center gap-1.5 mt-1 text-white/80 text-xs font-medium">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span>{resource?.location || "DAIH Campus"}</span>
                {resource?.capacity !== undefined &&
                  resource?.capacity !== null && (
                    <>
                      <span className="mx-1 opacity-50">&middot;</span>
                      <Users className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Capacity: {resource.capacity}{" "}
                        {resource.capacity === 1 ? "person" : "persons"}
                      </span>
                    </>
                  )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Verified</span>
              </div>
              <div className="bg-white/15 backdrop-blur-sm px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Premium</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active Hold Countdown Banner */}
      {activeHoldId && !isHoldExpired && (
        <div className="bg-[#23055c] text-white rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md animate-in fade-in duration-300 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
              <Timer className="h-5 w-5 text-amber-300 animate-pulse" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                Spot Reserved for You
              </h4>
              <p className="text-xs text-white/90 truncate sm:whitespace-normal">
                Holding your reservation ({bookingRef}). Complete checkout to
                confirm.
              </p>
            </div>
          </div>
          <div className="text-left sm:text-right shrink-0">
            <span className="font-mono text-xl font-extrabold text-amber-300">
              {String(holdMinutes).padStart(2, "0")}:
              {String(holdSecs).padStart(2, "0")}
            </span>
            <span className="block text-[10px] text-white/70 uppercase">
              Time Remaining
            </span>
          </div>
        </div>
      )}

      {isHoldExpired && (
        <div className="bg-amber-500 text-white rounded-xl p-4 flex items-center justify-between shadow-md min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p className="text-xs font-semibold">
              Your 10-minute reservation hold has expired. Click below to retry.
            </p>
          </div>
          <button
            onClick={() => {
              setActiveHoldId(null);
              setHoldExpiresAt(null);
            }}
            className="px-3 py-1.5 bg-white text-amber-700 font-bold text-xs rounded-lg cursor-pointer hover:bg-amber-50 shrink-0"
          >
            Retry Hold
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-col lg:flex-row gap-8 w-full min-w-0">
        {/* Left: Plans + Duration + Live Availability */}
        <div className="flex-1 min-w-0 max-w-full space-y-8">
          <div>
            <div className="mb-4">
              <h2 className="text-xl font-bold text-slate-900">
                Select a Plan
              </h2>
              <p className="text-xs text-slate-500">
                Choose the best package for your needs and schedule.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 min-w-0">
              {plans.map((plan) => {
                const isSelected = plan.id === selectedPlanId;
                return (
                  <div
                    key={plan.id}
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={`rounded-xl p-6 bg-white transition-all cursor-pointer relative group flex flex-col justify-between ${isSelected ? "border-2 border-[#23055c] shadow-md ring-1 ring-[#23055c]/20" : "border border-[#EBE7F5] hover:shadow-md hover:border-[#23055c]/40"}`}
                  >
                    {plan.isPopular && (
                      <div className="absolute top-0 right-0 bg-[#23055c] text-white font-bold text-[10px] px-3 py-1 rounded-bl-lg rounded-tr-md uppercase tracking-wider">
                        POPULAR
                      </div>
                    )}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-lg font-bold text-slate-900">
                          {plan.planName}
                        </h3>
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? "border-[#23055c] bg-[#23055c]" : "border-slate-300 group-hover:border-[#23055c]"}`}
                        >
                          {isSelected && (
                            <div className="w-2 h-2 rounded-full bg-white" />
                          )}
                        </div>
                      </div>
                      <div className="text-2xl font-extrabold text-[#23055c] mb-5 tracking-tight">
                        {"\u20A6"}
                        {Number(plan.price).toLocaleString()}
                        <span className="text-xs font-normal text-slate-500 ml-1">
                          {getUnitLabel(plan)}
                        </span>
                      </div>
                      <ul className="flex flex-col gap-2.5 text-xs text-slate-600 border-t border-slate-100 pt-4">
                        {(resource?.amenities || [])
                          .slice(0, 4)
                          .map((amenity, idx) => (
                            <li key={idx} className="flex items-center gap-2">
                              <CheckCircle2 className="h-3.5 w-3.5 text-[#23055c] shrink-0" />
                              <span className="line-clamp-1">
                                {decodeHtmlEntities(amenity)}
                              </span>
                            </li>
                          ))}
                        <li className="flex items-center gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-[#23055c] shrink-0" />
                          <span>24/7 Power Supply &amp; WiFi</span>
                        </li>
                      </ul>
                    </div>
                    <div className="mt-6 pt-3 border-t border-slate-100">
                      <button
                        type="button"
                        className={`w-full py-2 rounded-lg font-bold text-xs transition-colors ${isSelected ? "bg-[#23055c] text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}
                      >
                        {isSelected ? "Selected" : "Select Plan"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Duration & Range Selector */}
          {selectedPlan && (
            <div className="space-y-4 min-w-0 max-w-full">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {durType === "hours"
                      ? "Choose Your Hours"
                      : durType === "months"
                        ? "Choose Your Duration"
                        : "Choose Your Dates"}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {durType === "hours"
                      ? "Pick a start time and how many hours you need."
                      : durType === "months"
                        ? "Select how many months you want to subscribe."
                        : "Pick a start date and how many days you need."}
                  </p>
                </div>

                {/* Instant Availability Badge */}
                <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-auto">
                  {checkingAvailability ? (
                    <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold px-3 py-1 bg-slate-100 rounded-full">
                      <Loader2 className="h-3 w-3 animate-spin text-[#23055c]" />
                      <span>Checking slot...</span>
                    </div>
                  ) : availabilityError ? (
                    <div className="flex items-center gap-1.5 text-amber-800 text-xs font-bold px-3 py-1 bg-amber-50 border border-amber-200 rounded-full">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                      <span>Availability Unconfirmed</span>
                    </div>
                  ) : availabilityResult?.available ? (
                    <div className="flex items-center gap-1.5 text-emerald-700 text-xs font-bold px-3 py-1 bg-emerald-50 border border-emerald-200 rounded-full">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      <span>
                        Available{" "}
                        {availabilityResult.remainingSpots !== undefined &&
                          `(${availabilityResult.remainingSpots} spot${availabilityResult.remainingSpots === 1 ? "" : "s"} left)`}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-rose-700 text-xs font-bold px-3 py-1 bg-rose-50 border border-rose-200 rounded-full">
                      <AlertCircle className="h-3.5 w-3.5 text-rose-600" />
                      <span>Unavailable for selected dates</span>
                    </div>
                  )}
                </div>
              </div>

              <DurationSelector
                plan={selectedPlan}
                quantity={quantity}
                onQuantityChange={setQuantity}
                startDate={startDate}
                onStartDateChange={setStartDate}
                startHour={startHour}
                onStartHourChange={setStartHour}
                endDate={endDate}
                endHour={endHour}
                blackouts={resource?.blackouts}
                calendarData={calendarData}
              />

              {availabilityError && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium flex items-center justify-between gap-3 animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{availabilityError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCheckingAvailability(true);
                      setAvailabilityError(null);
                      api.bookings
                        .checkAvailability({
                          resourceId: resource?.id || slug,
                          startTime: startIso,
                          endTime: endIso,
                        })
                        .then((res) => {
                          setAvailabilityResult(res);
                          setAvailabilityError(null);
                        })
                        .catch((err) => {
                          setAvailabilityResult(null);
                          setAvailabilityError(
                            err?.message ||
                              "Could not confirm availability. Please check your network.",
                          );
                        })
                        .finally(() => setCheckingAvailability(false));
                    }}
                    className="text-xs font-bold text-[#23055c] hover:underline shrink-0 cursor-pointer bg-white px-3 py-1.5 rounded-lg border border-amber-300 shadow-2xs"
                  >
                    Retry Check
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Booking Summary & Checkout */}
        <div className="w-full lg:w-1/3 min-w-0">
          <div className="sticky top-20 border border-[#EBE7F5] rounded-xl bg-white p-4 sm:p-6 shadow-sm space-y-6 min-w-0 max-w-full">
            <h3 className="text-lg font-bold text-slate-900 border-b border-[#EBE7F5] pb-3">
              Booking Summary
            </h3>

            {errorMessage && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="flex flex-col gap-3 text-xs text-slate-600">
              <div className="flex justify-between items-start">
                <span>Plan</span>
                <span className="font-bold text-slate-900 text-right max-w-[60%]">
                  {selectedPlan?.planName || "Select a plan"}
                </span>
              </div>
              <div className="flex justify-between items-start">
                <span>Workspace</span>
                <span className="font-bold text-slate-900 text-right max-w-[60%]">
                  {resource?.name}
                </span>
              </div>
              <div className="flex justify-between items-start">
                <span>Duration</span>
                <span className="font-medium text-slate-800 text-right max-w-[65%]">
                  {durationLabel}
                </span>
              </div>

              {/* Availability Line item */}
              <div className="flex justify-between items-center py-1">
                <span>Availability</span>
                <span
                  className={`font-bold ${availabilityResult?.available ? "text-emerald-700" : "text-rose-600"}`}
                >
                  {checkingAvailability
                    ? "Checking..."
                    : availabilityResult?.available
                      ? "Guaranteed Available"
                      : "Slot Booked"}
                </span>
              </div>

              {breakdownLabel && (
                <div className="flex justify-between items-center bg-[#faf9ff] rounded-lg px-3 py-2 border border-[#EBE7F5]">
                  <span className="text-slate-500">Breakdown</span>
                  <span className="font-semibold text-[#23055c]">
                    {breakdownLabel}
                  </span>
                </div>
              )}

              {/* Promo / Coupon Code Section */}
              <div className="pt-2 border-t border-[#EBE7F5] space-y-2">
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                  Promo / Coupon Code
                </label>
                {appliedDiscount?.eligible &&
                (appliedDiscount.isAutomatic || !userManualPromo) ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 animate-in fade-in duration-200">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                          <Sparkles className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-emerald-900 truncate flex items-center gap-1.5">
                            <span>
                              {appliedDiscount.name || "Special Promotion"}
                            </span>
                            <span className="text-[9px] bg-emerald-200 text-emerald-800 font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                              Auto-Applied
                            </span>
                          </div>
                          <div className="text-[10px] text-emerald-700">
                            Saved ₦
                            {appliedDiscount.discountAmount.toLocaleString()}
                            .00
                          </div>
                        </div>
                      </div>
                    </div>

                    {!showPromoInput ? (
                      <button
                        type="button"
                        onClick={() => setShowPromoInput(true)}
                        className="text-[11px] font-semibold text-[#23055c] hover:underline flex items-center gap-1 cursor-pointer pt-0.5"
                      >
                        <Tag className="w-3 h-3" /> Have a different promo code?
                      </button>
                    ) : (
                      <div className="pt-1">
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                            <input
                              type="text"
                              value={promoCodeInput}
                              onChange={(e) => {
                                setPromoCodeInput(e.target.value.toUpperCase());
                                if (promoError) setPromoError(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleApplyPromoCode();
                                }
                              }}
                              placeholder="ENTER PROMO CODE"
                              className="w-full bg-[#faf9ff] border border-[#EBE7F5] rounded-xl pl-8 pr-3 py-2 text-xs font-mono font-medium text-slate-900 uppercase placeholder:text-slate-400 focus:outline-none focus:border-[#23055c] focus:ring-1 focus:ring-[#23055c] transition"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={handleApplyPromoCode}
                            disabled={
                              !promoCodeInput.trim() || isValidatingPromo
                            }
                            className="px-3.5 py-2 bg-[#23055c] hover:bg-[#392271] text-white text-xs font-bold rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0 cursor-pointer"
                          >
                            {isValidatingPromo ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              "Apply"
                            )}
                          </button>
                        </div>
                        {promoError && (
                          <p className="mt-1.5 text-[11px] text-rose-600 font-medium flex items-center gap-1 animate-in fade-in">
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            <span>{promoError}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : appliedDiscount?.eligible ? (
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                        <Tag className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-emerald-900 truncate">
                          {appliedDiscount.name || appliedDiscount.code}
                        </div>
                        <div className="text-[10px] text-emerald-700">
                          {appliedDiscount.code} &middot; Saved {"\u20A6"}
                          {appliedDiscount.discountAmount.toLocaleString()}.00
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemovePromo}
                      className="p-1 rounded-md text-emerald-600 hover:text-emerald-900 hover:bg-emerald-100 transition shrink-0 cursor-pointer"
                      title="Remove coupon"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <input
                          type="text"
                          value={promoCodeInput}
                          onChange={(e) => {
                            setPromoCodeInput(e.target.value.toUpperCase());
                            if (promoError) setPromoError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleApplyPromoCode();
                            }
                          }}
                          placeholder="PROMO CODE"
                          className="w-full bg-[#faf9ff] border border-[#EBE7F5] rounded-xl pl-8 pr-3 py-2 text-xs font-mono font-medium text-slate-900 uppercase placeholder:text-slate-400 focus:outline-none focus:border-[#23055c] focus:ring-1 focus:ring-[#23055c] transition"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleApplyPromoCode}
                        disabled={!promoCodeInput.trim() || isValidatingPromo}
                        className="px-3.5 py-2 bg-[#23055c] hover:bg-[#392271] text-white text-xs font-bold rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        {isValidatingPromo ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          "Apply"
                        )}
                      </button>
                    </div>
                    {promoError && (
                      <p className="mt-1.5 text-[11px] text-rose-600 font-medium flex items-center gap-1 animate-in fade-in">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        <span>{promoError}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-[#EBE7F5]">
                <span>Base Price</span>
                <span className="font-semibold text-slate-900">
                  {"\u20A6"}
                  {subtotal.toLocaleString()}.00
                </span>
              </div>

              {appliedDiscount?.eligible &&
                appliedDiscount.discountAmount > 0 && (
                  <>
                    <div className="flex justify-between items-center text-emerald-700">
                      <span className="flex items-center gap-1 font-medium">
                        <Tag className="w-3 h-3" />
                        Discount (
                        {appliedDiscount.code ||
                          appliedDiscount.name ||
                          "Special Offer"}
                        )
                      </span>
                      <span className="font-bold">
                        -{"\u20A6"}
                        {appliedDiscount.discountAmount.toLocaleString()}.00
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-slate-500 text-[11px]">
                      <span>Net Taxable</span>
                      <span className="font-medium">
                        {"\u20A6"}
                        {appliedDiscount.netTaxableSubtotal.toLocaleString()}.00
                      </span>
                    </div>
                  </>
                )}

              <div className="flex justify-between items-center">
                <span>Taxes &amp; Fees (VAT)</span>
                <span className="text-emerald-700 font-medium">
                  {appliedDiscount?.eligible && appliedDiscount.taxAmount > 0
                    ? `\u20A6${appliedDiscount.taxAmount.toLocaleString()}.00`
                    : "Included (0%)"}
                </span>
              </div>
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-[#EBE7F5]">
              <span className="text-base font-bold text-slate-900">Total</span>
              <span className="text-2xl font-extrabold text-[#23055c]">
                {"\u20A6"}
                {totalAmount.toLocaleString()}.00
              </span>
            </div>

            <button
              disabled={
                Boolean(isProcessing) ||
                !selectedPlan ||
                Boolean(isSlotUnavailable) ||
                Boolean(isHoldExpired) ||
                Boolean(checkingAvailability) ||
                Boolean(availabilityError)
              }
              onClick={handleCheckout}
              className="w-full bg-[#23055c] hover:bg-[#392271] text-white font-bold text-xs py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Processing
                  Hold...
                </>
              ) : checkingAvailability ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Verifying
                  Availability...
                </>
              ) : availabilityError ? (
                <>
                  <AlertCircle className="h-4 w-4" /> Availability Unconfirmed
                </>
              ) : isSlotUnavailable ? (
                <>
                  <AlertCircle className="h-4 w-4" /> Space Unavailable
                </>
              ) : activeHoldId ? (
                <>
                  <Lock className="h-4 w-4" /> Pay &amp; Confirm Booking
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" /> Reserve &amp; Checkout
                </>
              )}
            </button>
            <p className="text-[11px] text-slate-400 text-center font-medium">
              Payments are 256-bit encrypted and secure. Instant QR Access Pass.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

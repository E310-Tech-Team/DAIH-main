import { bookingRepository, BookingRepository } from "./booking.repository.js";
import {
  CheckAvailabilityInput,
  CalendarAvailabilityInput,
  CreateHoldInput,
  AdminOverrideBookingInput,
  BookingFilterInput,
  AnalyticsFilterInput,
} from "./booking.schema.js";

import {
  assertValidTransition,
  InvalidBookingStateTransitionError,
  ACTIVE_BOOKING_STATES,
} from "./booking.state-machine.js";
import { prisma } from "../../db/client.js";
import { outboxService } from "../events/outbox.service.js";
import {
  scheduleHoldExpiry,
  cancelHoldExpiryJob,
} from "../../jobs/hold-expiry.job.js";
import {
  UserRole,
  BookingState,
  CalendarDayStatus,
  PaymentStatus,
  AdminNoShowRescheduleDTO,
  AdminDashboardSummaryDTO,
  AdminAnalyticsSummaryDTO,
  WifiAccessStatus,
  WifiCredentialDTO,
} from "@daih/types";
import { generateSignedQrToken } from "../access/qr-token.util.js";
import { accessService } from "../access/access.service.js";
import { discountService } from "../discounts/discount.service.js";
import { loyaltyService } from "../loyalty/loyalty.service.js";
import { Decimal } from "@prisma/client/runtime/library";
import { HoldStatus, CoinLedgerAction } from "@prisma/client";
import { config } from "../../config/env.js";

export class BookingService {
  constructor(private repo: BookingRepository = bookingRepository) {}

  /**
   * Format booking summary for API responses
   */
  private formatBookingSummary(booking: any) {
    if (!booking) return null;

    const now = new Date();
    const isConfirmedOrActive = [
      BookingState.CONFIRMED,
      BookingState.ACTIVE,
      BookingState.CHECKED_IN,
      BookingState.CHECKED_OUT,
    ].includes(booking.state as BookingState);

    const end =
      booking.endTime instanceof Date
        ? booking.endTime
        : new Date(booking.endTime);

    // Check if member checked in today
    const sessions = booking.visitSessions || [];
    const hasTodayVisit = sessions.some((v: any) => {
      const checkInDate =
        v.checkInTime instanceof Date ? v.checkInTime : new Date(v.checkInTime);
      return checkInDate.toDateString() === now.toDateString();
    });

    const hasTodayCheckedInAt = booking.checkedInAt
      ? (booking.checkedInAt instanceof Date
          ? booking.checkedInAt
          : new Date(booking.checkedInAt)
        ).toDateString() === now.toDateString()
      : false;

    const checkedInToday =
      hasTodayVisit ||
      (hasTodayCheckedInAt &&
        [BookingState.CHECKED_IN, BookingState.CHECKED_OUT].includes(
          booking.state,
        ));

    const isSubscriptionExpired =
      now >= end ||
      [
        BookingState.COMPLETED,
        BookingState.EXPIRED,
        BookingState.CANCELLED,
        BookingState.REFUNDED,
      ].includes(booking.state as BookingState);

    let wifiStatus: WifiAccessStatus = "LOCKED_NO_PASS";
    let wifiCredentials: WifiCredentialDTO | null = null;

    if (isSubscriptionExpired) {
      wifiStatus = "EXPIRED";
      wifiCredentials = null;
    } else if (isConfirmedOrActive && checkedInToday) {
      wifiStatus = "ACTIVE";
      wifiCredentials = accessService.generateWifiCredentials(booking, now);
    } else if (isConfirmedOrActive && !checkedInToday) {
      wifiStatus = "LOCKED_PENDING_DAILY_CHECKIN";
      wifiCredentials = null;
    }

    return {
      id: booking.id,
      reference: booking.reference,
      resourceId: booking.resourceId,
      resourceName: booking.resource?.name || "Selected Space",
      category: booking.resource?.category || "FLEX_DESK",
      userId: booking.userId,
      customerName: booking.user
        ? `${booking.user.firstName || ""} ${booking.user.lastName || ""}`.trim() ||
          booking.user.email
        : "Customer",
      customerEmail: booking.user?.email,
      customerPhone: booking.user?.phoneNumber || undefined,
      startTime:
        booking.startTime instanceof Date
          ? booking.startTime.toISOString()
          : booking.startTime,
      endTime:
        booking.endTime instanceof Date
          ? booking.endTime.toISOString()
          : booking.endTime,
      state: booking.state,
      qrToken: isConfirmedOrActive ? booking.qrToken || undefined : undefined,
      amount: Number(booking.totalAmount),
      originalAmount: booking.originalAmount
        ? Number(booking.originalAmount)
        : undefined,
      discountAmount: booking.discountAmount
        ? Number(booking.discountAmount)
        : 0,
      discountCode: booking.discountCode || undefined,
      currency: booking.currency || "NGN",
      holdExpiresAt: booking.holdExpiresAt
        ? booking.holdExpiresAt instanceof Date
          ? booking.holdExpiresAt.toISOString()
          : booking.holdExpiresAt
        : null,
      checkedInAt: booking.checkedInAt
        ? booking.checkedInAt instanceof Date
          ? booking.checkedInAt.toISOString()
          : booking.checkedInAt
        : null,
      checkedOutAt: booking.checkedOutAt
        ? booking.checkedOutAt instanceof Date
          ? booking.checkedOutAt.toISOString()
          : booking.checkedOutAt
        : null,
      checkedInToday,
      wifiStatus,
      wifiCredentials,
      createdAt:
        booking.createdAt instanceof Date
          ? booking.createdAt.toISOString()
          : booking.createdAt,
      updatedAt:
        booking.updatedAt instanceof Date
          ? booking.updatedAt.toISOString()
          : booking.updatedAt,
    };
  }

  /**
   * Real-time availability check taking into account:
   * - Resource active status
   * - Scheduled blackout / maintenance dates
   * - Day-of-week operating hours
   * - Active holds and confirmed bookings vs total resource capacity
   */
  async checkAvailability(input: CheckAvailabilityInput) {
    const resource = await this.repo.findResource(input.resourceId);
    if (!resource || !resource.isActive) {
      return {
        available: false,
        resourceId: input.resourceId,
        resourceName: resource?.name || "Workspace",
        category: resource?.category || ("FLEX_DESK" as any),
        capacity: 0,
        activeCount: 0,
        remainingSpots: 0,
        startTime: input.startTime,
        endTime: input.endTime,
        reason: "Workspace is currently offline or inactive",
      };
    }

    const start = new Date(input.startTime);
    const end = new Date(input.endTime);

    const isBlackedOut = (resource.blackouts || []).some((b) => {
      const bStart = new Date(b.startDate);
      const bEnd = new Date(b.endDate);
      return b.isActive && start < bEnd && end > bStart;
    });

    if (isBlackedOut) {
      return {
        available: false,
        resourceId: resource.id,
        resourceName: resource.name,
        category: resource.category,
        capacity: resource.capacity,
        activeCount: resource.capacity,
        remainingSpots: 0,
        startTime: input.startTime,
        endTime: input.endTime,
        reason:
          "Workspace is unavailable due to scheduled maintenance or a private blackout",
      };
    }

    // 2. Day-of-week operating hours check
    const dayOfWeek = start.getDay();
    const schedule = (resource.schedules || []).find(
      (s) => s.dayOfWeek === dayOfWeek,
    );
    if (schedule && schedule.isClosed) {
      return {
        available: false,
        resourceId: resource.id,
        resourceName: resource.name,
        category: resource.category,
        capacity: resource.capacity,
        activeCount: resource.capacity,
        remainingSpots: 0,
        startTime: input.startTime,
        endTime: input.endTime,
        reason: "Workspace is closed on this day of the week",
      };
    }

    // 3. Count active overlapping bookings / holds
    const activeCount = await this.repo.countActiveOverlappingBookings(
      prisma,
      resource.id,
      start,
      end,
    );

    const remainingSpots = Math.max(0, resource.capacity - activeCount);
    const available = remainingSpots > 0;

    return {
      available,
      resourceId: resource.id,
      resourceName: resource.name,
      category: resource.category,
      capacity: resource.capacity,
      activeCount,
      remainingSpots,
      startTime: input.startTime,
      endTime: input.endTime,
      reason: available
        ? undefined
        : "All available slots for this workspace are currently reserved",
    };
  }

  /**
   * Get sparse monthly calendar availability map (exceptions only)
   */
  async getCalendarAvailability(input: CalendarAvailabilityInput) {
    const resource = await this.repo.findResource(input.resourceId);
    if (!resource || !resource.isActive) {
      const error: any = new Error(
        `Resource '${input.resourceId}' is not active or found`,
      );
      error.statusCode = 404;
      error.code = "RESOURCE_NOT_FOUND";
      throw error;
    }

    const now = new Date();
    const targetMonth =
      input.month ||
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [yearStr, monthStr] = targetMonth.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1; // 0-indexed month

    const daysInTargetMonth = new Date(year, month + 1, 0).getDate();
    const startOfMonth = new Date(`${targetMonth}-01T00:00:00+01:00`);
    const endOfMonth = new Date(
      `${targetMonth}-${String(daysInTargetMonth).padStart(2, "0")}T23:59:59.999+01:00`,
    );

    // Helper to format date in WAT (UTC+1) as YYYY-MM-DD
    const toWatDateString = (date: Date): string => {
      const watDate = new Date(date.getTime() + 60 * 60 * 1000);
      const y = watDate.getUTCFullYear();
      const m = String(watDate.getUTCMonth() + 1).padStart(2, "0");
      const d = String(watDate.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    // Fetch active bookings in month range
    const bookings = await prisma.booking.findMany({
      where: {
        resourceId: resource.id,
        state: { in: ACTIVE_BOOKING_STATES },
        startTime: { lt: endOfMonth },
        endTime: { gt: startOfMonth },
        OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
      },
      select: { startTime: true, endTime: true },
    });

    const busyDates: Record<string, any> = {};

    // 1. Process blackouts
    (resource.blackouts || []).forEach((b) => {
      if (!b.isActive) return;
      const bStart = new Date(b.startDate);
      const bEnd = new Date(b.endDate);

      const startClamped = Math.max(bStart.getTime(), startOfMonth.getTime());
      const limitClamped = Math.min(bEnd.getTime(), endOfMonth.getTime());
      if (startClamped > limitClamped) return;

      const startDayStr = toWatDateString(new Date(startClamped));
      const endDayStr = toWatDateString(new Date(limitClamped));

      let cur = new Date(`${startDayStr}T12:00:00+01:00`);
      const limit = new Date(`${endDayStr}T12:00:00+01:00`);

      while (cur <= limit) {
        const dStr = toWatDateString(cur);
        busyDates[dStr] = {
          status: CalendarDayStatus.BLACKOUT,
          reason: b.reason || "Scheduled Maintenance",
        };
        cur.setTime(cur.getTime() + 24 * 60 * 60 * 1000);
      }
    });

    // 2. Process closed days of week
    const closedDaysOfWeek = (resource.schedules || [])
      .filter((s) => s.isClosed)
      .map((s) => s.dayOfWeek);

    if (closedDaysOfWeek.length > 0) {
      for (let d = 1; d <= daysInTargetMonth; d++) {
        const dayTwoDigits = String(d).padStart(2, "0");
        const monthTwoDigits = String(month + 1).padStart(2, "0");
        const dStr = `${year}-${monthTwoDigits}-${dayTwoDigits}`;
        const noonDate = new Date(`${dStr}T12:00:00+01:00`);
        const dayOfWeek = noonDate.getUTCDay();

        if (closedDaysOfWeek.includes(dayOfWeek)) {
          if (!busyDates[dStr]) {
            busyDates[dStr] = {
              status: CalendarDayStatus.CLOSED,
              reason: "Workspace is closed on this day",
            };
          }
        }
      }
    }

    // 3. Process bookings into date slots & hour slots
    const dateBookingsMap: Record<string, { start: Date; end: Date }[]> = {};

    bookings.forEach((bk) => {
      const bStart =
        bk.startTime instanceof Date ? bk.startTime : new Date(bk.startTime);
      const bEnd =
        bk.endTime instanceof Date ? bk.endTime : new Date(bk.endTime);

      const startClamped = Math.max(bStart.getTime(), startOfMonth.getTime());
      const endClamped = Math.min(bEnd.getTime(), endOfMonth.getTime());
      if (startClamped >= endClamped) return;

      const startDayStr = toWatDateString(new Date(startClamped));
      const endDayStr = toWatDateString(new Date(endClamped - 1));

      let cur = new Date(`${startDayStr}T12:00:00+01:00`);
      const limit = new Date(`${endDayStr}T12:00:00+01:00`);

      while (cur <= limit) {
        const dStr = toWatDateString(cur);
        if (!dateBookingsMap[dStr]) dateBookingsMap[dStr] = [];
        dateBookingsMap[dStr].push({ start: bStart, end: bEnd });
        cur.setTime(cur.getTime() + 24 * 60 * 60 * 1000);
      }
    });

    Object.entries(dateBookingsMap).forEach(([dStr, list]) => {
      // If already blackout or closed, keep existing status
      if (
        busyDates[dStr] &&
        [CalendarDayStatus.BLACKOUT, CalendarDayStatus.CLOSED].includes(
          busyDates[dStr].status,
        )
      ) {
        return;
      }

      // Calculate occupancy for each local hour (0..23) in WAT (UTC+1)
      const hourlyOccupancy = new Array(24).fill(0);
      for (let h = 0; h < 24; h++) {
        const slotStart = new Date(
          `${dStr}T${String(h).padStart(2, "0")}:00:00+01:00`,
        );
        const slotEnd = new Date(
          `${dStr}T${String(h).padStart(2, "0")}:59:59.999+01:00`,
        );
        list.forEach((b) => {
          if (b.start < slotEnd && b.end > slotStart) {
            hourlyOccupancy[h]++;
          }
        });
      }

      const maxSimultaneous = Math.max(0, ...hourlyOccupancy);
      const remainingSpots = Math.max(0, resource.capacity - maxSimultaneous);

      // Collect hour slots (0..23) that have reached full capacity
      const bookedHours: number[] = [];
      for (let h = 0; h < 24; h++) {
        if (hourlyOccupancy[h] >= resource.capacity) {
          bookedHours.push(h);
        }
      }

      const status =
        remainingSpots <= 0
          ? CalendarDayStatus.FULL
          : maxSimultaneous > 0
            ? CalendarDayStatus.LIMITED
            : CalendarDayStatus.AVAILABLE;

      busyDates[dStr] = {
        status,
        remainingSpots,
        bookedHourSlots: bookedHours.sort((a, b) => a - b),
      };
    });

    return {
      resourceId: resource.id,
      resourceName: resource.name,
      capacity: resource.capacity,
      month: targetMonth,
      defaultStatus: CalendarDayStatus.AVAILABLE,
      busyDates,
    };
  }

  /**
   * Create a 10-minute hold on a resource with concurrency lock
   */
  async createHold(userId: string, input: CreateHoldInput) {
    const start = new Date(input.startTime);
    const end = new Date(input.endTime);
    const quantity = input.quantity ? Number(input.quantity) : 1;

    try {
      // Perform check and hold insertion inside an interactive transaction with row-level lock
      const booking = await prisma.$transaction(
        async (tx) => {
          const resource = await tx.facilityResource.findFirst({
            where: {
              OR: [{ id: input.resourceId }, { slug: input.resourceId }],
            },
            include: {
              pricing: { where: { isActive: true } },
              blackouts: { where: { isActive: true } },
              schedules: true,
            },
          });

          if (!resource || !resource.isActive) {
            const error: any = new Error(
              `Workspace resource '${input.resourceId}' is inactive or not found`,
            );
            error.statusCode = 404;
            error.code = "RESOURCE_NOT_FOUND";
            throw error;
          }

          // 1. Enforce category bounds
          const isPooled = ["HOT_DESK", "FLEX_DESK"].includes(
            resource.category,
          );
          const maxAllowed = isPooled ? resource.capacity : 1;
          if (quantity > maxAllowed) {
            const error: any = new Error(
              `Maximum quantity for ${resource.name} is ${maxAllowed}`,
            );
            error.statusCode = 400;
            error.code = "INVALID_QUANTITY";
            throw error;
          }

          // 2. Lock resource row in DB to serialize concurrency checks for this resource
          await tx.$queryRaw`SELECT id, capacity FROM "facility_resources" WHERE id = ${resource.id} FOR UPDATE`;

          // Check blackouts
          const isBlackedOut = (resource.blackouts || []).some((b) => {
            return (
              b.isActive &&
              start < new Date(b.endDate) &&
              end > new Date(b.startDate)
            );
          });
          if (isBlackedOut) {
            const error: any = new Error(
              "Workspace is unavailable due to scheduled maintenance",
            );
            error.statusCode = 409;
            error.code = "SLOT_UNAVAILABLE";
            throw error;
          }

          // Check overlapping active reservations vs capacity (accounting for requested quantity)
          const activeCount = await this.repo.countActiveOverlappingBookings(
            tx,
            resource.id,
            start,
            end,
          );

          if (activeCount + quantity > resource.capacity) {
            const error: any = new Error(
              "Workspace capacity is fully reserved for the selected time range",
            );
            error.statusCode = 409;
            error.code = "SLOT_UNAVAILABLE";
            throw error;
          }

          // 3. Authoritative server pricing engine & duration calculation
          let unitPrice = 4000;
          let currency = "NGN";
          let durationUnits = 1;

          if (input.planId) {
            const plan = resource.pricing.find((p) => p.id === input.planId);
            if (plan) {
              unitPrice = Number(plan.price);
              currency = plan.currency;
              if (plan.durationHours && plan.durationHours > 0) {
                const durationHours = Math.max(
                  1,
                  Math.ceil(
                    (end.getTime() - start.getTime()) / (1000 * 60 * 60),
                  ),
                );
                durationUnits = Math.ceil(durationHours / plan.durationHours);
              } else if (plan.durationDays && plan.durationDays > 0) {
                const durationDays = Math.max(
                  1,
                  Math.ceil(
                    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
                  ),
                );
                durationUnits = Math.ceil(durationDays / plan.durationDays);
              }
            }
          } else if (resource.pricing.length > 0) {
            const plan = resource.pricing[0];
            unitPrice = Number(plan.price);
            currency = plan.currency;
            if (plan.durationHours && plan.durationHours > 0) {
              const durationHours = Math.max(
                1,
                Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60)),
              );
              durationUnits = Math.ceil(durationHours / plan.durationHours);
            }
          }

          const baseSubtotal = new Decimal(unitPrice)
            .mul(quantity)
            .mul(durationUnits);
          const calculatedPrice = baseSubtotal.toNumber();

          const now = new Date();
          const holdExpiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes hold
          const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
          const randomSuffix = Math.floor(10000 + Math.random() * 90000);
          const reference = `DAIH-BK-${datePart}-${randomSuffix}`;

          // Fetch user details for domain matching
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { email: true },
          });

          // Apply discount (either promo code or automatic)
          const discountResult = await discountService.applyDiscountToHoldTx(
            tx,
            {
              bookingId: "temp",
              userId,
              userEmail: user?.email,
              resourceId: resource.id,
              resourceCategory: resource.category,
              basePrice: calculatedPrice,
              promoCode: (input as any).promoCode,
            },
          );

          const grossTotal = new Decimal(discountResult.finalAmount);

          // 4. Split-tender coin redemption lifecycle
          const coinsToRedeemInput = input.coinsToRedeem
            ? new Decimal(input.coinsToRedeem)
            : new Decimal(0);
          const redeemAll = Boolean(input.redeemAll);

          if (
            !config.features.enableCoinRedemption &&
            (coinsToRedeemInput.greaterThan(0) || redeemAll)
          ) {
            const error: any = new Error(
              "PeeDee Coin redemption is currently disabled",
            );
            error.statusCode = 400;
            error.code = "COIN_REDEMPTION_DISABLED";
            throw error;
          }

          let coinsRedeemed = new Decimal(0);
          let coinTenderAmount = new Decimal(0);
          let cashDue = new Decimal(grossTotal);
          let coinConversionRate = new Decimal(1.0);
          let currentCoinBalance = new Decimal(0);

          if (
            config.features.enableCoinRedemption &&
            (coinsToRedeemInput.greaterThan(0) || redeemAll)
          ) {
            // Lock coin_balances row
            await tx.$executeRaw`
              INSERT INTO "coin_balances" ("userId", "balance", "lifetimeEarned", "lifetimeBurned", "version", "updatedAt")
              VALUES (${userId}, 0, 0, 0, 0, NOW())
              ON CONFLICT ("userId") DO NOTHING;
            `;

            const rows = await tx.$queryRaw<Array<{ balance: any }>>`
              SELECT "balance" FROM "coin_balances" WHERE "userId" = ${userId} FOR UPDATE;
            `;
            currentCoinBalance = new Decimal(rows[0]?.balance || 0);

            const activeHolds = await tx.coinHold.findMany({
              where: {
                userId,
                status: HoldStatus.ACTIVE,
                expiresAt: { gt: now },
              },
            });
            const heldSum = activeHolds.reduce(
              (sum, h) => sum.plus(new Decimal(h.amount)),
              new Decimal(0),
            );
            const spendable = Decimal.max(0, currentCoinBalance.minus(heldSum));

            const loyaltySetting = await tx.loyaltySetting.findFirst();

            if (loyaltySetting) {
              if (
                loyaltySetting.isProgramActive === false ||
                loyaltySetting.isRedemptionEnabled === false
              ) {
                const error: any = new Error(
                  "PD Coin redemption is currently disabled by administrator",
                );
                error.statusCode = 400;
                error.code = "REDEMPTION_DISABLED";
                throw error;
              }

              if (
                loyaltySetting.redemptionRateCoins &&
                loyaltySetting.redemptionRateNgn
              ) {
                const rateNgn = new Decimal(loyaltySetting.redemptionRateNgn);
                const rateCoins = new Decimal(
                  loyaltySetting.redemptionRateCoins,
                );
                if (rateCoins.greaterThan(0)) {
                  coinConversionRate = rateNgn.div(rateCoins);
                }
              }
            }

            const paystackMinCharge = new Decimal(
              config.payments.minChargeNgn || 100.0,
            );

            // Enforce admin-configured maxDiscountPercent (defaults to 50% if not set)
            const maxDiscountPercent =
              loyaltySetting && loyaltySetting.maxDiscountPercent != null
                ? Number(loyaltySetting.maxDiscountPercent)
                : 50;

            const maxAllowedDiscountNgn = grossTotal
              .mul(maxDiscountPercent)
              .div(100)
              .toDecimalPlaces(2, Decimal.ROUND_FLOOR);

            const maxCoinsAllowedByPolicy = maxAllowedDiscountNgn
              .div(coinConversionRate)
              .toDecimalPlaces(2, Decimal.ROUND_FLOOR);

            // Minimum coins threshold from loyalty settings if configured
            const minCoinsThreshold =
              loyaltySetting && loyaltySetting.minCoinsToRedeem != null
                ? new Decimal(loyaltySetting.minCoinsToRedeem)
                : new Decimal("0.01");

            if (
              maxDiscountPercent >= 100 &&
              (redeemAll ||
                coinsToRedeemInput
                  .mul(coinConversionRate)
                  .greaterThanOrEqualTo(grossTotal))
            ) {
              // 100% Coin Coverage Path (strictly permitted only when maxDiscountPercent is 100%)
              const requiredCoins = grossTotal
                .div(coinConversionRate)
                .toDecimalPlaces(2, Decimal.ROUND_CEIL);
              if (spendable.lessThan(requiredCoins)) {
                const error: any = new Error(
                  `Insufficient spendable PeeDee coins for full coverage. Spendable: ${spendable.toFixed(2)}, Required: ${requiredCoins.toFixed(2)}`,
                );
                error.statusCode = 400;
                error.code = "INSUFFICIENT_COINS";
                throw error;
              }
              coinsRedeemed = requiredCoins;
              coinTenderAmount = grossTotal;
              cashDue = new Decimal(0);
            } else {
              // Partial Redemption Path (or when maxDiscountPercent caps coin coverage below 100%)
              const maxPartialCoins = Decimal.max(
                0,
                grossTotal
                  .minus(paystackMinCharge)
                  .div(coinConversionRate)
                  .toDecimalPlaces(2, Decimal.ROUND_FLOOR),
              );

              // Cap allowable coins by both policy percentage and Paystack minimum gateway charge
              const effectiveMaxCoins = Decimal.min(
                maxCoinsAllowedByPolicy,
                maxPartialCoins,
              );

              if (effectiveMaxCoins.lessThan(new Decimal("0.01"))) {
                const error: any = new Error(
                  "This booking amount cannot use partial coin redemption because it leaves less than the minimum required gateway charge. Please pay in full via card.",
                );
                error.statusCode = 400;
                error.code = "SUB_MINIMUM_CASH_DUE";
                throw error;
              }

              // Determine target coins to redeem
              let targetCoins = coinsToRedeemInput;
              if (redeemAll) {
                targetCoins = Decimal.min(spendable, effectiveMaxCoins);
              } else if (
                coinsToRedeemInput.greaterThan(maxCoinsAllowedByPolicy)
              ) {
                const error: any = new Error(
                  `PeeDee Coins can only cover up to ${maxDiscountPercent}% of this booking (maximum ${maxCoinsAllowedByPolicy.toFixed(2)} PDC, equivalent to ₦${maxAllowedDiscountNgn.toFixed(2)}). Please adjust coins or pay in full via card.`,
                );
                error.statusCode = 400;
                error.code = "EXCEEDS_MAX_COIN_DISCOUNT";
                throw error;
              } else if (coinsToRedeemInput.greaterThan(maxPartialCoins)) {
                const error: any = new Error(
                  "Redemption leaves less than ₦100.00 cash due for card processing. Please reduce coins redeemed.",
                );
                error.statusCode = 400;
                error.code = "SUB_MINIMUM_CASH_DUE";
                throw error;
              }

              if (targetCoins.lessThan(minCoinsThreshold)) {
                const error: any = new Error(
                  `Minimum redemption is ${minCoinsThreshold.toFixed(2)} PDC`,
                );
                error.statusCode = 400;
                error.code = "INVALID_COIN_AMOUNT";
                throw error;
              }

              if (targetCoins.greaterThan(spendable)) {
                const error: any = new Error(
                  `Insufficient spendable PeeDee coins. Available: ${spendable.toFixed(2)}, Requested: ${targetCoins.toFixed(2)}`,
                );
                error.statusCode = 400;
                error.code = "INSUFFICIENT_COINS";
                throw error;
              }

              coinsRedeemed = targetCoins.toDecimalPlaces(
                2,
                Decimal.ROUND_DOWN,
              );
              coinTenderAmount = coinsRedeemed
                .mul(coinConversionRate)
                .toDecimalPlaces(2, Decimal.ROUND_DOWN);
              cashDue = grossTotal.minus(coinTenderAmount);
            }
          }

          // 5. Create base hold respecting global lock order
          const created = await this.repo.createHold(tx, {
            reference,
            resourceId: resource.id,
            userId,
            startTime: start,
            endTime: end,
            quantity,
            totalAmount: grossTotal,
            cashDue,
            coinsRedeemed,
            coinTenderAmount,
            conversionRateSnapshot: coinConversionRate,
            originalAmount: calculatedPrice,
            discountAmount: discountResult.discountAmount,
            discountId: discountResult.discountId,
            discountCode: discountResult.discountCode,
            currency,
            holdExpiresAt,
          });

          // Insert coin_holds row if coins redeemed
          if (coinsRedeemed.greaterThan(0)) {
            await tx.coinHold.create({
              data: {
                userId,
                bookingId: created.id,
                amount: coinsRedeemed,
                nairaValue: coinTenderAmount,
                status: HoldStatus.ACTIVE,
                expiresAt: holdExpiresAt,
              },
            });
          }

          // 6. Zero-Cash Instant Confirmation Path
          if (cashDue.isZero()) {
            const qrToken = generateSignedQrToken({
              bookingId: created.id,
              reference: created.reference,
              userId: created.userId,
              startTime: created.startTime.toISOString(),
              endTime: created.endTime.toISOString(),
              issuedAt: Date.now(),
            });
            await tx.booking.update({
              where: { id: created.id },
              data: {
                state: BookingState.CONFIRMED,
                qrToken,
                holdExpiresAt: null,
              },
            });
            created.state = BookingState.CONFIRMED;
            (created as any).qrToken = qrToken;

            if (coinsRedeemed.greaterThan(0)) {
              await tx.coinHold.update({
                where: { bookingId: created.id },
                data: { status: HoldStatus.BURNED },
              });

              const newBalance = currentCoinBalance.minus(coinsRedeemed);
              await tx.coinBalance.update({
                where: { userId },
                data: {
                  balance: newBalance,
                  lifetimeBurned: { increment: coinsRedeemed },
                },
              });

              await tx.coinLedgerEntry.create({
                data: {
                  userId,
                  action: CoinLedgerAction.HOLD_BURNED,
                  amount: coinsRedeemed.negated(),
                  balanceAfter: newBalance,
                  referenceType: "BOOKING",
                  referenceId: created.id,
                  idempotencyKey: `burn_booking_${created.id}`,
                  metadata: {
                    bookingId: created.id,
                    reason: "Zero-cash instant confirmation",
                  },
                },
              });
            }

            // Record confirmation outbox event
            await outboxService.recordEvent(
              {
                eventType: "booking.confirmed",
                aggregateType: "Booking",
                aggregateId: created.id,
                payload: {
                  bookingId: created.id,
                  reference: created.reference,
                  qrToken,
                  customerEmail: user?.email,
                },
              },
              tx,
            );
          }

          return created;
        },
        {
          maxWait: 15000,
          timeout: 20000,
        },
      );

      // Only schedule delayed hold expiration job if cash payment is pending
      if (!new Decimal(booking.cashDue || 0).isZero()) {
        await scheduleHoldExpiry(booking.id, 10 * 60 * 1000);
      }

      // Record outbox event
      await outboxService.recordEvent({
        eventType: "booking.hold_created",
        aggregateType: "Booking",
        aggregateId: booking.id,
        payload: {
          bookingId: booking.id,
          reference: booking.reference,
          resourceId: booking.resourceId,
          userId,
          holdExpiresAt: booking.holdExpiresAt,
          quantity: booking.quantity || 1,
          totalAmount: Number(booking.totalAmount),
          cashDue: Number(booking.cashDue),
          coinsRedeemed: Number(booking.coinsRedeemed),
          coinTenderAmount: Number(booking.coinTenderAmount),
          discountAmount: (booking as any).discountAmount || 0,
          discountCode: (booking as any).discountCode,
        },
      });

      return {
        bookingId: booking.id,
        reference: booking.reference,
        resourceId: booking.resourceId,
        resourceName: booking.resource?.name,
        userId: booking.userId,
        startTime: booking.startTime.toISOString(),
        endTime: booking.endTime.toISOString(),
        holdExpiresAt:
          booking.holdExpiresAt?.toISOString() || new Date().toISOString(),
        quantity: booking.quantity || 1,
        totalAmount: Number(booking.totalAmount),
        cashDue: Number(booking.cashDue),
        coinsRedeemed: Number(booking.coinsRedeemed),
        coinTenderAmount: Number(booking.coinTenderAmount),
        originalAmount: (booking as any).originalAmount
          ? Number((booking as any).originalAmount)
          : undefined,
        discountAmount: (booking as any).discountAmount
          ? Number((booking as any).discountAmount)
          : 0,
        discountCode: (booking as any).discountCode || undefined,
        currency: booking.currency,
        state: booking.state,
        qrToken: (booking as any).qrToken || undefined,
      };
    } catch (err: any) {
      if (
        err.statusCode === 409 ||
        err.code === "SLOT_UNAVAILABLE" ||
        err.code === "P2002" ||
        /exclusion|no_overlapping_active_bookings|23P01|duplicate/i.test(
          err.message || "",
        )
      ) {
        const conflictError: any = new Error(
          "Workspace capacity is fully reserved for the selected time range",
        );
        conflictError.statusCode = 409;
        conflictError.code = "SLOT_UNAVAILABLE";
        throw conflictError;
      }
      throw err;
    }
  }

  /**
   * Expire hold and release coins/transactions under hierarchical lock order
   */
  async expireHold(bookingId: string) {
    return prisma.$transaction(
      async (tx) => {
        // Hierarchical lock order:
        // 1. Lock pending transactions
        await tx.$queryRaw`
          SELECT id FROM "transactions" WHERE "bookingId" = ${bookingId} AND "status" = 'PENDING' FOR UPDATE
        `;

        // 2. Lock booking
        const bookings = await tx.$queryRaw<
          Array<{ id: string; state: string }>
        >`
          SELECT id, state FROM "bookings" WHERE id = ${bookingId} FOR UPDATE
        `;
        if (bookings.length === 0) return { expired: false };
        const b = bookings[0];

        if (!["HELD", "PENDING_PAYMENT"].includes(b.state)) {
          return { expired: false, state: b.state };
        }

        // 3. Lock active coin hold
        await tx.$queryRaw`
          SELECT id FROM "coin_holds" WHERE "bookingId" = ${bookingId} AND "status" = 'ACTIVE' FOR UPDATE
        `;

        // Update transactions: PENDING -> EXPIRED
        await tx.transaction.updateMany({
          where: { bookingId, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.EXPIRED },
        });

        // Update booking: state -> EXPIRED
        await tx.booking.update({
          where: { id: bookingId },
          data: { state: BookingState.EXPIRED },
        });

        // Update coin hold: ACTIVE -> RELEASED
        await tx.coinHold.updateMany({
          where: { bookingId, status: HoldStatus.ACTIVE },
          data: { status: HoldStatus.RELEASED },
        });

        await discountService.releaseHeldRedemptionTx(tx, bookingId);
        await loyaltyService.releaseBookingRedemptionHold(bookingId);

        await outboxService.recordEvent(
          {
            eventType: "booking.hold_expired",
            aggregateType: "Booking",
            aggregateId: bookingId,
            payload: {
              bookingId,
            },
          },
          tx,
        );

        return { expired: true };
      },
      { timeout: 15000, maxWait: 10000 },
    );
  }

  /**
   * Extend hold expiry (e.g. when user clicks Complete Checkout and initiates payment)
   */
  async extendHold(
    bookingId: string,
    userId: string,
    extraMinutes: number = 10,
  ) {
    const booking = await this.repo.findById(bookingId);
    if (!booking) {
      const error: any = new Error(`Booking '${bookingId}' not found`);
      error.statusCode = 404;
      error.code = "BOOKING_NOT_FOUND";
      throw error;
    }

    if (booking.userId !== userId) {
      const error: any = new Error(
        "You are not authorized to modify this booking",
      );
      error.statusCode = 403;
      error.code = "FORBIDDEN";
      throw error;
    }

    if (
      booking.state !== BookingState.HELD &&
      booking.state !== BookingState.PENDING_PAYMENT
    ) {
      const error: any = new Error(
        `Cannot extend hold for booking in state '${booking.state}'`,
      );
      error.statusCode = 400;
      error.code = "INVALID_BOOKING_STATE";
      throw error;
    }

    const newExpiry = new Date(Date.now() + extraMinutes * 60 * 1000);
    const updated = await this.repo.extendHold(prisma, bookingId, newExpiry);

    // Reschedule delayed expiry job
    await scheduleHoldExpiry(bookingId, extraMinutes * 60 * 1000);

    return {
      success: true,
      bookingId: updated.id,
      holdExpiresAt:
        updated.holdExpiresAt?.toISOString() || newExpiry.toISOString(),
    };
  }

  /**
   * Cancel an active hold (or unconfirmed booking).
   * Confirmed bookings cannot be cancelled under the No-Refund Policy.
   */
  async cancelBooking(
    bookingId: string,
    userId: string,
    reason?: string,
    actorRole?: string,
  ) {
    const booking = await this.repo.findById(bookingId);
    if (!booking) {
      const error: any = new Error(`Booking '${bookingId}' not found`);
      error.statusCode = 404;
      error.code = "BOOKING_NOT_FOUND";
      throw error;
    }

    // Permission check
    const isOwner = booking.userId === userId;
    const isStaff =
      actorRole && ["OPERATIONS_ADMIN", "SUPER_ADMIN"].includes(actorRole);
    if (!isOwner && !isStaff) {
      const error: any = new Error(
        "You are not authorized to cancel this booking",
      );
      error.statusCode = 403;
      error.code = "FORBIDDEN";
      throw error;
    }

    // Confirmed bookings cannot be cancelled by customers under the strict No-Refund Policy
    const nonCancellableStates: BookingState[] = [
      BookingState.CONFIRMED,
      BookingState.CHECKED_IN,
      BookingState.CHECKED_OUT,
      BookingState.COMPLETED,
      BookingState.ACTIVE,
    ];
    if (
      nonCancellableStates.includes(booking.state as BookingState) &&
      !isStaff
    ) {
      const error: any = new Error(
        "Confirmed bookings cannot be cancelled under DAIH's No-Refund Policy. If you missed your session, an Operations Admin can grant a discretionary reschedule.",
      );
      error.statusCode = 403;
      error.code = "CANNOT_CANCEL_CONFIRMED_BOOKING";
      throw error;
    }

    assertValidTransition(
      booking.state as BookingState,
      BookingState.CANCELLED,
      booking.id,
    );

    const updated = await this.repo.updateState(
      prisma,
      bookingId,
      BookingState.CANCELLED,
    );
    await discountService.releaseHeldRedemptionTx(prisma, bookingId);
    await loyaltyService.releaseBookingRedemptionHold(bookingId);
    await cancelHoldExpiryJob(bookingId);

    // Actively update any linked PENDING transactions to ABANDONED
    await prisma.transaction.updateMany({
      where: {
        bookingId,
        status: PaymentStatus.PENDING,
      },
      data: {
        status: PaymentStatus.ABANDONED,
      },
    });

    // Mark active coin_holds as RELEASED
    await prisma.coinHold.updateMany({
      where: {
        bookingId,
        status: HoldStatus.ACTIVE,
      },
      data: {
        status: HoldStatus.RELEASED,
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: "BOOKING_CANCELLED",
        entityType: "Booking",
        entityId: bookingId,
        metadata: {
          reference: booking.reference,
          previousState: booking.state,
          reason,
        },
      },
    });

    // Outbox event
    await outboxService.recordEvent({
      eventType: "booking.cancelled",
      aggregateType: "Booking",
      aggregateId: bookingId,
      payload: { bookingId, reference: booking.reference, reason },
    });

    return this.formatBookingSummary(updated);
  }

  /**
   * Operations Admin Discretionary Reschedule for NO_SHOW bookings
   * Strictly requires booking.state === NO_SHOW and mandatory reason logged to AuditLog
   */
  async rescheduleNoShowBooking(
    bookingId: string,
    adminUserId: string,
    input: AdminNoShowRescheduleDTO,
    ipAddress?: string,
  ) {
    const booking = await this.repo.findById(bookingId);
    if (!booking) {
      const error: any = new Error(`Booking '${bookingId}' not found`);
      error.statusCode = 404;
      error.code = "BOOKING_NOT_FOUND";
      throw error;
    }

    if (booking.state !== BookingState.NO_SHOW) {
      const error: any = new Error(
        `Only unredeemed bookings in NO_SHOW state can be rescheduled. Current state: '${booking.state}'`,
      );
      error.statusCode = 400;
      error.code = "INVALID_BOOKING_STATE";
      throw error;
    }

    if (!input.reason || input.reason.trim().length < 10) {
      const error: any = new Error(
        "A detailed discretionary reason of at least 10 characters is required for rescheduling a no-show booking.",
      );
      error.statusCode = 400;
      error.code = "OVERRIDE_REASON_REQUIRED";
      throw error;
    }

    const start = new Date(input.newStartTime);
    const end = new Date(input.newEndTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      const error: any = new Error("Invalid reschedule start and end time");
      error.statusCode = 400;
      error.code = "INVALID_TIME_RANGE";
      throw error;
    }

    // Verify slot capacity for new time window
    const resource = await this.repo.findResource(booking.resourceId);
    if (!resource) {
      const error: any = new Error(
        `Workspace resource '${booking.resourceId}' not found`,
      );
      error.statusCode = 404;
      error.code = "RESOURCE_NOT_FOUND";
      throw error;
    }

    const activeCount = await this.repo.countActiveOverlappingBookings(
      prisma,
      booking.resourceId,
      start,
      end,
      booking.id,
    );

    if (activeCount >= resource.capacity) {
      const error: any = new Error(
        `Cannot reschedule to selected slot: capacity for '${resource.name}' is fully occupied for the chosen time range.`,
      );
      error.statusCode = 409;
      error.code = "SLOT_UNAVAILABLE";
      throw error;
    }

    assertValidTransition(
      booking.state as BookingState,
      BookingState.CONFIRMED,
      booking.id,
    );

    const qrToken = generateSignedQrToken({
      bookingId: booking.id,
      reference: booking.reference,
      userId: booking.userId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      issuedAt: Date.now(),
    });
    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id: booking.id },
        data: {
          startTime: start,
          endTime: end,
          state: BookingState.CONFIRMED,
          qrToken,
          holdExpiresAt: null,
          checkedInAt: null,
          checkedOutAt: null,
        },
        include: {
          resource: true,
          user: true,
        },
      });

      // Mandatory AuditLog entry
      await tx.auditLog.create({
        data: {
          userId: adminUserId,
          action: "BOOKING_ADMIN_DISCRETIONARY_RESCHEDULE",
          entityType: "Booking",
          entityId: booking.id,
          metadata: {
            reference: booking.reference,
            resourceId: booking.resourceId,
            previousStartTime: booking.startTime.toISOString(),
            previousEndTime: booking.endTime.toISOString(),
            newStartTime: start.toISOString(),
            newEndTime: end.toISOString(),
            reason: input.reason,
            adminUserId,
          },
          ipAddress,
        },
      });

      // Outbox Event
      await outboxService.recordEvent(
        {
          eventType: "booking.rescheduled",
          aggregateType: "Booking",
          aggregateId: booking.id,
          payload: {
            bookingId: booking.id,
            reference: booking.reference,
            newStartTime: start.toISOString(),
            newEndTime: end.toISOString(),
            qrToken,
            reason: input.reason,
          },
        },
        tx,
      );

      return b;
    });

    return this.formatBookingSummary(updated);
  }

  /**
   * Confirm booking (e.g. upon payment confirmation or admin approval)
   */
  async confirmBooking(bookingId: string) {
    const booking = await this.repo.findById(bookingId);
    if (!booking) {
      const error: any = new Error(`Booking '${bookingId}' not found`);
      error.statusCode = 404;
      error.code = "BOOKING_NOT_FOUND";
      throw error;
    }

    if (booking.state === BookingState.EXPIRED) {
      // Check if capacity is still available for this time range before late recovery
      const resource = await this.repo.findResource(booking.resourceId);
      if (resource) {
        const activeCount = await this.repo.countActiveOverlappingBookings(
          prisma,
          booking.resourceId,
          booking.startTime,
          booking.endTime,
          booking.id,
        );
        if (activeCount >= resource.capacity) {
          await this.repo.updateState(
            prisma,
            bookingId,
            BookingState.CANCELLED,
          );
          const error: any = new Error(
            `Cannot confirm payment for expired booking '${booking.reference}': space is fully booked.`,
          );
          error.statusCode = 409;
          error.code = "SLOT_UNAVAILABLE";
          throw error;
        }
      }
    }

    assertValidTransition(
      booking.state as BookingState,
      BookingState.CONFIRMED,
      booking.id,
    );

    const qrToken = generateSignedQrToken({
      bookingId: booking.id,
      reference: booking.reference,
      userId: booking.userId,
      startTime:
        booking.startTime instanceof Date
          ? booking.startTime.toISOString()
          : String(booking.startTime),
      endTime:
        booking.endTime instanceof Date
          ? booking.endTime.toISOString()
          : String(booking.endTime),
      issuedAt: Date.now(),
    });
    const updated = await this.repo.updateState(
      prisma,
      bookingId,
      BookingState.CONFIRMED,
      {
        qrToken,
        holdExpiresAt: null,
      },
    );

    await cancelHoldExpiryJob(bookingId);

    await outboxService.recordEvent({
      eventType: "booking.confirmed",
      aggregateType: "Booking",
      aggregateId: bookingId,
      payload: { bookingId, reference: booking.reference, qrToken },
    });

    return this.formatBookingSummary(updated);
  }

  /**
   * Find booking by ID
   */
  async getBookingById(bookingId: string) {
    const booking = await this.repo.findById(bookingId);
    if (!booking) return null;
    return this.formatBookingSummary(booking);
  }

  /**
   * Get customer's own bookings
   */
  async getMyBookings(userId: string) {
    const bookings = await this.repo.findMyBookings(userId);
    return bookings.map((b) => this.formatBookingSummary(b));
  }

  /**
   * Get all bookings for Operations Admin console
   */
  async getAdminBookings(filters: BookingFilterInput) {
    const parseFilterDate = (d?: string, isEnd = false) => {
      if (!d) return undefined;
      const date = new Date(d);
      if (isNaN(date.getTime())) return undefined;
      if (isEnd && (d.length <= 10 || !d.includes("T"))) {
        date.setHours(23, 59, 59, 999);
      }
      return date;
    };

    const res = await this.repo.findAllAdminBookings({
      ...filters,
      startDate: parseFilterDate(filters.startDate, false),
      endDate: parseFilterDate(filters.endDate, true),
    });

    return {
      total: res.total,
      page: res.page,
      limit: res.limit,
      bookings: res.bookings.map((b) => this.formatBookingSummary(b)),
    };
  }

  /**
   * Operations Admin Manual Override / Force Reservation
   * Mandatory overrideReason is logged to AuditLog
   */
  async adminOverride(
    adminUserId: string,
    input: AdminOverrideBookingInput,
    ipAddress?: string,
  ) {
    const resource = await this.repo.findResource(input.resourceId);
    if (!resource) {
      const error: any = new Error(
        `Workspace resource '${input.resourceId}' not found`,
      );
      error.statusCode = 404;
      error.code = "RESOURCE_NOT_FOUND";
      throw error;
    }

    let targetUserId = input.userId;
    if (!targetUserId && input.customerEmail) {
      const user = await prisma.user.findUnique({
        where: { email: input.customerEmail },
      });
      targetUserId = user ? user.id : adminUserId;
    }
    if (!targetUserId) {
      targetUserId = adminUserId;
    }

    const start = new Date(input.startTime);
    const end = new Date(input.endTime);
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    const reference = `DAIH-OVR-${datePart}-${randomSuffix}`;
    const targetState = input.state || BookingState.CONFIRMED;

    const booking = await prisma.booking.create({
      data: {
        reference,
        resourceId: resource.id,
        userId: targetUserId,
        startTime: start,
        endTime: end,
        state: targetState as any,
        totalAmount: input.waiveFee ? 0 : input.totalAmount || 0,
        currency: input.currency || "NGN",
        qrToken:
          targetState === BookingState.CONFIRMED
            ? generateSignedQrToken({
                bookingId: reference,
                reference,
                userId: targetUserId,
                startTime: start.toISOString(),
                endTime: end.toISOString(),
                issuedAt: Date.now(),
              })
            : null,
      },
      include: {
        resource: true,
        user: true,
      },
    });

    // Mandatory AuditLog entry
    await prisma.auditLog.create({
      data: {
        userId: adminUserId,
        action: "BOOKING_ADMIN_OVERRIDE",
        entityType: "Booking",
        entityId: booking.id,
        metadata: {
          reference: booking.reference,
          resourceId: resource.id,
          resourceName: resource.name,
          targetUserId,
          overrideReason: input.overrideReason,
          state: targetState,
          waivedFee: Boolean(input.waiveFee),
        },
        ipAddress,
      },
    });

    // Outbox event
    await outboxService.recordEvent({
      eventType: "booking.admin_overridden",
      aggregateType: "Booking",
      aggregateId: booking.id,
      payload: {
        bookingId: booking.id,
        reference: booking.reference,
        adminUserId,
        overrideReason: input.overrideReason,
      },
    });

    return this.formatBookingSummary(booking);
  }

  /**
   * Consolidated Admin Operations Dashboard Summary
   * Single-roundtrip pre-aggregated KPIs, capacity, revenue, plan breakdowns, and movement feeds.
   */
  async getDashboardSummary(
    userRole?: UserRole,
  ): Promise<AdminDashboardSummaryDTO> {
    const canViewFinancials =
      userRole !== UserRole.RECEPTION_OFFICER &&
      userRole !== UserRole.SECURITY_OFFICER;

    const canViewDistributionAndFacilities =
      userRole === UserRole.SUPER_ADMIN ||
      userRole === UserRole.OPERATIONS_ADMIN ||
      userRole === UserRole.MANAGEMENT_VIEWER;
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
    );
    const endOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    );
    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
    );

    const [
      resources,
      todayCheckedInBookings,
      activeCheckedInOnSite,
      todayDepartures,
      todayReservationsCount,
      todayRevenueAgg,
      mtdRevenueAgg,
      paidBookings,
      recentVisitSessions,
    ] = await Promise.all([
      prisma.facilityResource.findMany({
        where: { isActive: true },
        select: { id: true, name: true, category: true, capacity: true },
      }),
      // Check-ins today
      prisma.booking.count({
        where: {
          OR: [
            { checkedInAt: { gte: startOfToday, lte: endOfToday } },
            {
              state: {
                in: [BookingState.CHECKED_IN, BookingState.CHECKED_OUT],
              },
              updatedAt: { gte: startOfToday, lte: endOfToday },
            },
          ],
        },
      }),
      // Currently on-site
      prisma.booking.count({
        where: {
          state: BookingState.CHECKED_IN,
        },
      }),
      // Departures today
      prisma.booking.count({
        where: {
          checkedOutAt: { gte: startOfToday, lte: endOfToday },
        },
      }),
      // Reservations starting today
      prisma.booking.count({
        where: {
          startTime: { gte: startOfToday, lte: endOfToday },
        },
      }),
      // Revenue settled today
      prisma.transaction.aggregate({
        where: {
          status: PaymentStatus.SUCCESSFUL,
          createdAt: { gte: startOfToday, lte: endOfToday },
        },
        _sum: { amount: true },
      }),
      // Revenue settled this month (MTD)
      prisma.transaction.aggregate({
        where: {
          status: PaymentStatus.SUCCESSFUL,
          createdAt: { gte: startOfMonth, lte: endOfToday },
        },
        _sum: { amount: true },
      }),
      // Paid bookings for plans & facilities breakdown
      prisma.booking.findMany({
        where: {
          state: {
            in: [
              BookingState.CONFIRMED,
              BookingState.ACTIVE,
              BookingState.CHECKED_IN,
              BookingState.CHECKED_OUT,
              BookingState.COMPLETED,
            ],
          },
        },
        select: {
          id: true,
          totalAmount: true,
          resourceId: true,
          resource: { select: { name: true, category: true } },
        },
      }),
      // Recent movements / activity feed
      prisma.visitSession.findMany({
        take: 25,
        orderBy: { checkInTime: "desc" },
        include: {
          booking: {
            include: { resource: { select: { name: true, category: true } } },
          },
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              clientId: true,
            },
          },
        },
      }),
    ]);

    const totalCapacity =
      resources.reduce((sum, r) => sum + (r.capacity || 1), 0) || 104;
    const occupiedSeats = activeCheckedInOnSite;
    const occupancyRate = Math.min(
      100,
      Math.round((occupiedSeats / totalCapacity) * 100),
    );

    const todayRevNum = Number(todayRevenueAgg._sum?.amount || 0);
    const mtdRevNum = Number(mtdRevenueAgg._sum?.amount || 0);

    // Subscription plan breakdowns
    const categoryMap = new Map<string, { count: number; totalRev: number }>();
    const facilityMap = new Map<
      string,
      { name: string; category: string; count: number; totalRev: number }
    >();
    let totalPaidCount = 0;

    paidBookings.forEach((b) => {
      const cat = b.resource?.category
        ? b.resource.category.replace(/_/g, " ")
        : "Hot Desk";
      const amt = Number(b.totalAmount || 0);
      const curCat = categoryMap.get(cat) || { count: 0, totalRev: 0 };
      categoryMap.set(cat, {
        count: curCat.count + 1,
        totalRev: curCat.totalRev + amt,
      });
      totalPaidCount++;

      const resKey = b.resourceId || "unknown";
      const resName = b.resource?.name || "Workspace";
      const curFac = facilityMap.get(resKey) || {
        name: resName,
        category: cat,
        count: 0,
        totalRev: 0,
      };
      facilityMap.set(resKey, {
        ...curFac,
        count: curFac.count + 1,
        totalRev: curFac.totalRev + amt,
      });
    });

    const colors = [
      { colorClass: "text-primary", barColorClass: "bg-primary-container" },
      { colorClass: "text-secondary", barColorClass: "bg-secondary" },
      {
        colorClass: "text-on-tertiary-container",
        barColorClass: "bg-on-tertiary-container",
      },
      { colorClass: "text-[#10b981]", barColorClass: "bg-[#10b981]" },
      { colorClass: "text-[#0ea5e9]", barColorClass: "bg-[#0ea5e9]" },
    ];

    const subscriptionPlans = Array.from(categoryMap.entries()).map(
      ([name, data], idx) => ({
        name,
        count: data.count,
        percentage:
          totalPaidCount > 0
            ? Math.round((data.count / totalPaidCount) * 100)
            : 0,
        revenueContribution: canViewFinancials
          ? `₦${data.totalRev.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : "N/A",
        colorClass: colors[idx % colors.length].colorClass,
        barColorClass: colors[idx % colors.length].barColorClass,
      }),
    );

    const mostUsedFacilities = Array.from(facilityMap.values())
      .map((fac) => ({
        name: fac.name,
        category: fac.category,
        bookingsCount: fac.count,
        utilizationRate:
          totalPaidCount > 0
            ? Math.round((fac.count / totalPaidCount) * 100)
            : 0,
        totalRevenue: canViewFinancials
          ? `₦${fac.totalRev.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : "N/A",
      }))
      .sort((a, b) => b.bookingsCount - a.bookingsCount)
      .slice(0, 5);

    const recentActivities = recentVisitSessions.map((v) => {
      const checkInDate =
        v.checkInTime instanceof Date ? v.checkInTime : new Date(v.checkInTime);
      const checkOutDate = v.checkOutTime
        ? v.checkOutTime instanceof Date
          ? v.checkOutTime
          : new Date(v.checkOutTime)
        : null;

      const formattedCheckIn = checkInDate.toLocaleTimeString("en-NG", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const formattedCheckOut = checkOutDate
        ? checkOutDate.toLocaleTimeString("en-NG", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : null;

      // Calculate elapsed duration
      let hoursUsed = "Active (On-site)";
      if (checkOutDate) {
        const diffMs = checkOutDate.getTime() - checkInDate.getTime();
        const diffMins = Math.max(1, Math.round(diffMs / (1000 * 60)));
        const hrs = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        hoursUsed = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
      }

      return {
        id: v.id,
        bookingId: v.bookingId,
        memberName: v.user
          ? `${v.user.firstName || ""} ${v.user.lastName || ""}`.trim() ||
            v.user.email
          : "Member",
        memberEmail: v.user?.email || "member@daih.ng",
        clientNumber:
          v.user?.clientId || `DAIH-CUS-${v.userId.slice(0, 6).toUpperCase()}`,
        resourceName: v.booking?.resource?.name || "Workspace",
        workspaceCategory: v.booking?.resource?.category || "HOT_DESK",
        eventType: (v.checkOutTime ? "CHECK_OUT" : "CHECK_IN") as any,
        timestamp: (checkOutDate || checkInDate).toISOString(),
        formattedTime: formattedCheckOut || formattedCheckIn,
        checkInTime: checkInDate.toISOString(),
        checkOutTime: checkOutDate ? checkOutDate.toISOString() : null,
        formattedCheckIn,
        formattedCheckOut,
        hoursUsed,
        amountPaid: canViewFinancials
          ? v.booking?.totalAmount
            ? `₦${Number(v.booking.totalAmount).toLocaleString()}`
            : "Settled"
          : "Settled",
        paymentStatus: "PAID",
      };
    });

    return {
      dailyVisitors: todayCheckedInBookings,
      currentlyOnSite: occupiedSeats,
      todayDeparturesCount: todayDepartures,
      todayBookingsCount: todayReservationsCount,
      revenueToday: canViewFinancials
        ? `₦${todayRevNum.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "Restricted",
      totalRevenueMtd: canViewFinancials
        ? `₦${mtdRevNum.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "Restricted",
      occupancyRate,
      occupiedSeats,
      totalSeats: totalCapacity,
      peakHourWindow: "11:00 AM – 03:30 PM",
      peakOccupancyRate: occupancyRate,
      subscriptionPlans: canViewDistributionAndFacilities
        ? subscriptionPlans
        : [],
      mostUsedFacilities: canViewDistributionAndFacilities
        ? mostUsedFacilities
        : [],
      recentActivities,
    };
  }

  /**
   * Consolidated Admin Analytics Reports Summary
   * Returns pre-aggregated period metrics, subscription plans, facility rankings,
   * plus period bookings and transactions in one single database round-trip.
   */
  async getAnalyticsSummary(
    input: AnalyticsFilterInput,
  ): Promise<AdminAnalyticsSummaryDTO> {
    const isAllTime =
      input.preset === "all_time" || (!input.startDate && !input.endDate);

    let start: Date | undefined;
    let end: Date | undefined;

    if (!isAllTime && input.startDate && input.endDate) {
      start = new Date(input.startDate);
      end = new Date(input.endDate);
    }

    const bookingWhere: any = {};
    const transactionWhere: any = {};

    if (start && end) {
      bookingWhere.OR = [
        { startTime: { gte: start, lte: end } },
        { createdAt: { gte: start, lte: end } },
        { checkedInAt: { gte: start, lte: end } },
      ];
      transactionWhere.createdAt = { gte: start, lte: end };
    }

    const [resources, rawBookings, rawTransactions] = await Promise.all([
      prisma.facilityResource.findMany({
        where: { isActive: true },
        select: { id: true, name: true, category: true, capacity: true },
      }),
      prisma.booking.findMany({
        where: bookingWhere,
        orderBy: { createdAt: "desc" },
        take: 1000,
        include: {
          resource: { select: { name: true, category: true } },
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
            },
          },
        },
      }),
      prisma.transaction.findMany({
        where: transactionWhere,
        orderBy: { createdAt: "desc" },
        take: 1000,
        include: {
          booking: { include: { resource: { select: { name: true } } } },
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      }),
    ]);

    const totalCapacity =
      resources.reduce((sum, r) => sum + (r.capacity || 1), 0) || 104;

    const formattedBookings: any[] = rawBookings.map((b) =>
      this.formatBookingSummary(b),
    );
    const formattedTransactions = rawTransactions.map((tx) => ({
      id: tx.id,
      reference: tx.reference,
      bookingId: tx.bookingId,
      userId: tx.userId,
      amount: Number(tx.amount),
      currency: tx.currency,
      status: tx.status,
      method: tx.method,
      customerName: tx.user
        ? `${tx.user.firstName || ""} ${tx.user.lastName || ""}`.trim() ||
          tx.user.email
        : "Customer",
      customerEmail: tx.user?.email,
      resourceName: tx.booking?.resource?.name || "Workspace",
      createdAt: tx.createdAt.toISOString(),
      paidAt: tx.paidAt ? tx.paidAt.toISOString() : null,
    }));

    // Successful transactions
    const successfulTxs = formattedTransactions.filter(
      (t) =>
        t.status === PaymentStatus.SUCCESSFUL ||
        (t.status as any) === "SUCCESS",
    );
    const totalRevenue = successfulTxs.reduce(
      (sum, t) => sum + (Number(t.amount) || 0),
      0,
    );

    // Paid bookings in period
    const paidPeriodBookings = formattedBookings.filter((b) =>
      [
        BookingState.CONFIRMED,
        BookingState.ACTIVE,
        BookingState.CHECKED_IN,
        BookingState.CHECKED_OUT,
        BookingState.COMPLETED,
      ].includes(b.state as any),
    );

    // Check-ins in period
    const checkedInBookings = formattedBookings.filter(
      (b) =>
        Boolean(b.checkedInAt) ||
        b.state === BookingState.CHECKED_IN ||
        b.state === BookingState.CHECKED_OUT,
    );
    const totalCheckIns = checkedInBookings.length;

    // Calculate days in period
    let daysCount = 30;
    if (start && end) {
      daysCount = Math.max(
        1,
        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
      );
    }
    const avgDailyFootfall =
      daysCount > 0 ? (totalCheckIns / daysCount).toFixed(1) : "0.0";
    const totalAvailableSeatDays = totalCapacity * Math.max(1, daysCount);
    const spaceOccupancyRate =
      totalAvailableSeatDays > 0 && totalCheckIns > 0
        ? Math.min(
            100,
            Math.round((totalCheckIns / totalAvailableSeatDays) * 100),
          )
        : 0;

    // Repeat customers (unique customers with > 1 booking or check-in visit in this period)
    const customerCounts = new Map<string, number>();
    paidPeriodBookings.forEach((b) => {
      const key = b.userId || b.customerEmail || b.customerName || b.reference;
      customerCounts.set(key, (customerCounts.get(key) || 0) + 1);
    });
    checkedInBookings.forEach((b) => {
      const key = b.userId || b.customerEmail || b.customerName || b.reference;
      if (!customerCounts.has(key)) {
        customerCounts.set(key, 1);
      }
    });
    const repeatCustomers = Array.from(customerCounts.values()).filter(
      (c) => c > 1,
    ).length;
    const totalUniqueCustomers = customerCounts.size;
    const repeatRate =
      totalUniqueCustomers > 0 && repeatCustomers > 0
        ? Math.round((repeatCustomers / totalUniqueCustomers) * 100)
        : 0;

    const avgBookingValue =
      paidPeriodBookings.length > 0
        ? Math.round(totalRevenue / paidPeriodBookings.length)
        : 0;

    // Subscription plan allocations
    const categoryMap = new Map<string, { count: number; totalRev: number }>();
    const facilityMap = new Map<
      string,
      {
        id: string;
        name: string;
        type: string;
        count: number;
        totalRev: number;
      }
    >();
    let totalPaidCount = 0;

    paidPeriodBookings.forEach((b) => {
      const cat = b.category ? b.category.replace(/_/g, " ") : "Hot Desk";
      const amt = Number(b.amount) || 0;
      const curCat = categoryMap.get(cat) || { count: 0, totalRev: 0 };
      categoryMap.set(cat, {
        count: curCat.count + 1,
        totalRev: curCat.totalRev + amt,
      });
      totalPaidCount++;

      const resKey = b.resourceId || "unknown";
      const resName = b.resourceName || "Workspace";
      const curFac = facilityMap.get(resKey) || {
        id: resKey,
        name: resName,
        type: cat,
        count: 0,
        totalRev: 0,
      };
      facilityMap.set(resKey, {
        ...curFac,
        count: curFac.count + 1,
        totalRev: curFac.totalRev + amt,
      });
    });

    const colors = [
      { colorClass: "text-primary", barColorClass: "bg-primary-container" },
      { colorClass: "text-secondary", barColorClass: "bg-secondary" },
      {
        colorClass: "text-on-tertiary-container",
        barColorClass: "bg-on-tertiary-container",
      },
      { colorClass: "text-[#10b981]", barColorClass: "bg-[#10b981]" },
      { colorClass: "text-[#0ea5e9]", barColorClass: "bg-[#0ea5e9]" },
    ];

    const subscriptionPlans = Array.from(categoryMap.entries()).map(
      ([name, data], idx) => ({
        name,
        count: data.count,
        percentage:
          totalPaidCount > 0
            ? Math.round((data.count / totalPaidCount) * 100)
            : 0,
        revenueContribution: `₦${data.totalRev.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        colorClass: colors[idx % colors.length].colorClass,
        barColorClass: colors[idx % colors.length].barColorClass,
      }),
    );

    const facilityColors = [
      "bg-primary-container",
      "bg-secondary",
      "bg-on-tertiary-container",
      "bg-[#10b981]",
      "bg-[#0ea5e9]",
      "bg-[#f59e0b]",
    ];

    const facilityRankings = resources
      .map((r, idx) => {
        const facData = facilityMap.get(r.id);
        const paidCount = facData ? facData.count : 0;
        const utilRate =
          totalPaidCount > 0
            ? Math.round((paidCount / totalPaidCount) * 100)
            : 0;
        const status: "High Demand" | "Active" | "Available" =
          paidCount >= 4 || utilRate >= 30
            ? "High Demand"
            : paidCount > 0
              ? "Active"
              : "Available";

        return {
          id: r.id,
          name: r.name,
          type: r.category ? r.category.replace(/_/g, " ") : "Workspace",
          utilizationRate: utilRate,
          paidBookingsCount: paidCount,
          activeOccupancy: `Cap: ${r.capacity} persons`,
          status,
          barColorClass: facilityColors[idx % facilityColors.length],
        };
      })
      .sort(
        (a, b) =>
          b.paidBookingsCount - a.paidBookingsCount ||
          b.utilizationRate - a.utilizationRate,
      );

    // Completed bookings in period (marked completed / checked-out, or confirmed/checked-in and past end time)
    const completedBookings = formattedBookings.filter(
      (b) =>
        b.state === BookingState.COMPLETED ||
        b.state === BookingState.CHECKED_OUT ||
        ((b.state === BookingState.CONFIRMED ||
          b.state === BookingState.ACTIVE ||
          b.state === BookingState.CHECKED_IN) &&
          (Boolean(b.checkedInAt) || new Date(b.endTime) < new Date())),
    );

    return {
      periodMetrics: {
        totalRevenue: `₦${Number(totalRevenue).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`,
        rawTotalRevenue: totalRevenue,
        totalBookingsCount: paidPeriodBookings.length,
        paidBookingsCount: paidPeriodBookings.length,
        totalCheckIns,
        totalCustomersCount: totalUniqueCustomers,
        avgDailyFootfall,
        spaceOccupancyRate,
        totalCapacity,
        repeatRate: `${repeatRate}%`,
        repeatMembersCount: repeatCustomers,
        avgBookingValue: `₦${avgBookingValue.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
      subscriptionPlans,
      facilityRankings,
      bookings: formattedBookings,
      transactions: formattedTransactions,
    };
  }
}

export const bookingService = new BookingService();

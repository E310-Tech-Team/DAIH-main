import { OutboxEvent, CoinLedgerAction } from "@prisma/client";
import { prisma } from "../../../db/client.js";
import { coinService } from "../../loyalty/coin.service.js";
import { outboxService } from "../outbox.service.js";

export async function handleLoyaltyEvents(event: OutboxEvent): Promise<void> {
  const payload = event.payload as any;

  switch (event.eventType) {
    case "visit.checked_in":
    case "access.checked_in": {
      if (payload?.bookingId && !payload?.isReEntry) {
        try {
          await coinService.awardBookingCheckInEarn(payload.bookingId);
        } catch (err: any) {
          console.warn(
            "[Loyalty] Failed to award booking check-in coins:",
            err?.message,
          );
        }
        try {
          await coinService.awardReferralBonus(payload.bookingId);
        } catch (err: any) {
          console.warn(
            "[Loyalty] Failed to award referral bonus on check-in:",
            err?.message,
          );
        }
        if (payload?.userId) {
          try {
            await coinService.awardRefereeWelcomeReward(payload.userId);
          } catch (err: any) {
            console.warn(
              "[Loyalty] Failed to award referee welcome coins on check-in:",
              err?.message,
            );
          }
          try {
            await coinService.evaluateAndAwardStreakBonus(payload.userId);
          } catch (err: any) {
            console.warn(
              "[Loyalty] Failed to award streak bonus on check-in:",
              err?.message,
            );
          }
        }
      }
      break;
    }

    case "identity.oauth_registered":
    case "identity.customer_registered":
    case "identity.user_registered":
    case "identity.email_verified": {
      const userId = payload?.userId || event.aggregateId;
      if (userId) {
        try {
          await coinService.awardSignupBonus(userId);
        } catch (err: any) {
          console.warn("[Loyalty] Failed to award signup bonus:", err?.message);
        }
      }
      break;
    }

    case "booking.confirmed": {
      if (payload?.bookingId) {
        try {
          await coinService.burnHold(payload.bookingId);
        } catch (err: any) {
          console.warn(
            "[Loyalty] Failed to burn coin hold on booking confirmation:",
            err?.message,
          );
        }
      }
      break;
    }

    case "booking.cancelled":
    case "booking.expired": {
      if (payload?.bookingId) {
        try {
          await coinService.releaseHold(payload.bookingId);
        } catch (err: any) {
          console.warn("[Loyalty] Failed to release coin hold:", err?.message);
        }
      }
      break;
    }

    case "loyalty.redemption_reversal": {
      if (payload?.bookingId && payload?.coinsToReverse) {
        try {
          const booking = await prisma.booking.findUnique({
            where: { id: payload.bookingId },
            select: { userId: true },
          });
          if (booking?.userId) {
            await coinService.creditCoins({
              userId: booking.userId,
              action: CoinLedgerAction.REDEMPTION_REVERSAL,
              amount: payload.coinsToReverse,
              referenceType: "Booking",
              referenceId: payload.bookingId,
              idempotencyKey:
                payload.idempotencyKey ||
                `redemption_reversal_${payload.bookingId}`,
              metadata: {
                bookingId: payload.bookingId,
                reason: "Refund reversal",
              },
            });
          }
        } catch (err: any) {
          if (
            err?.code === "P2002" ||
            err?.name === "IdempotencyConflictError"
          ) {
            return;
          }
          console.error("[Loyalty] Error processing redemption reversal:", err);
          throw err;
        }
      }
      break;
    }

    case "loyalty.clawback_earned": {
      if (payload?.bookingId && payload?.coinsToClawback) {
        try {
          const booking = await prisma.booking.findUnique({
            where: { id: payload.bookingId },
            select: { userId: true },
          });
          if (booking?.userId) {
            await coinService.debitCoins({
              userId: booking.userId,
              action: CoinLedgerAction.REFUND_CLAWBACK,
              amount: payload.coinsToClawback,
              referenceType: "Booking",
              referenceId: payload.bookingId,
              idempotencyKey:
                payload.idempotencyKey ||
                `clawback_customer_${payload.bookingId}`,
              metadata: {
                bookingId: payload.bookingId,
                reason: "Refund clawback",
              },
            });
          }
        } catch (err: any) {
          if (
            err?.code === "P2002" ||
            err?.name === "IdempotencyConflictError"
          ) {
            return;
          }
          console.error(
            "[Loyalty] Error processing earned coins clawback:",
            err,
          );
          throw err;
        }
      }
      break;
    }

    case "loyalty.clawback_referral": {
      if (
        payload?.bookingId &&
        payload?.referrerId &&
        payload?.coinsToClawback
      ) {
        try {
          await coinService.debitCoins({
            userId: payload.referrerId,
            action: CoinLedgerAction.REFUND_CLAWBACK,
            amount: payload.coinsToClawback,
            referenceType: "Booking",
            referenceId: payload.bookingId,
            idempotencyKey:
              payload.idempotencyKey ||
              `coin:clawback:referral:${payload.bookingId}`,
            metadata: {
              bookingId: payload.bookingId,
              reason: "Referral clawback",
            },
          });
        } catch (err: any) {
          if (
            err?.code === "P2002" ||
            err?.name === "IdempotencyConflictError"
          ) {
            return;
          }
          console.error("[Loyalty] Error processing referral clawback:", err);
          throw err;
        }
      }
      break;
    }

    default:
      break;
  }
}

// Register with outbox dispatcher
outboxService.registerHandler("access.checked_in", handleLoyaltyEvents);
outboxService.registerHandler("identity.oauth_registered", handleLoyaltyEvents);
outboxService.registerHandler(
  "identity.customer_registered",
  handleLoyaltyEvents,
);
outboxService.registerHandler("identity.user_registered", handleLoyaltyEvents);
outboxService.registerHandler("identity.email_verified", handleLoyaltyEvents);
outboxService.registerHandler("booking.confirmed", handleLoyaltyEvents);
outboxService.registerHandler("booking.cancelled", handleLoyaltyEvents);
outboxService.registerHandler("booking.expired", handleLoyaltyEvents);
outboxService.registerHandler(
  "loyalty.redemption_reversal",
  handleLoyaltyEvents,
);
outboxService.registerHandler("loyalty.clawback_earned", handleLoyaltyEvents);
outboxService.registerHandler("loyalty.clawback_referral", handleLoyaltyEvents);

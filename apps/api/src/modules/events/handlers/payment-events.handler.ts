import { OutboxEvent } from "@prisma/client";
import { prisma } from "../../../db/client.js";
import { enqueueNotification } from "../../notifications/notifications.queue.js";
import { notificationsService } from "../../notifications/notifications.service.js";
import { outboxService } from "../outbox.service.js";
import { campaignService } from "../../campaigns/campaign.service.js";

export async function handlePaymentEvents(event: OutboxEvent): Promise<void> {
  const payload = event.payload as any;

  await notificationsService.createFromOutboxEvent(event);

  switch (event.eventType) {
    case "payment.successful": {
      if (payload?.customerEmail) {
        await enqueueNotification(
          "payment.receipt",
          payload.customerEmail,
          payload.customerName || "Member",
          {
            bookingReference:
              payload.bookingReference || payload.reference || "N/A",
            resourceName: payload.resourceName || "Workspace",
            amount: Number(payload.amount) || 0,
            currency: payload.currency || "NGN",
            invoiceNumber: payload.invoiceNumber,
          },
        );
      }

      if (payload?.userId && payload?.bookingId && payload?.amount) {
        try {
          await campaignService.recordConversion(
            payload.userId,
            payload.bookingId,
            Number(payload.amount),
          );
        } catch (err: any) {
          console.warn(
            "[Campaign] Failed to attribute campaign conversion:",
            err?.message,
          );
        }
      }
      break;
    }

    case "payment.failed":
    case "payment.capacity_conflict": {
      break;
    }

    case "admin.payment_flagged": {
      try {
        await prisma.auditLog.create({
          data: {
            action: "ADMIN_PAYMENT_FLAGGED",
            entityType: event.aggregateType,
            entityId: event.aggregateId,
            metadata: payload || {},
          },
        });
      } catch (err: any) {
        console.error(
          "[AuditLog] Failed to record payment_flagged:",
          err?.message,
        );
      }
      try {
        await notificationsService.sendAdminAlert(
          "Payment Flagged",
          `Payment for ${payload?.bookingId || event.aggregateId} requires reconciliation: ${payload?.reasonCode || "Flagged"}`,
          payload,
        );
      } catch (err: any) {
        console.error(
          "[Alert] Failed to dispatch payment_flagged alert:",
          err?.message,
        );
      }
      break;
    }

    case "admin.unknown_payment_reference": {
      try {
        await prisma.auditLog.create({
          data: {
            action: "ADMIN_UNKNOWN_PAYMENT_REFERENCE",
            entityType: event.aggregateType,
            entityId: event.aggregateId,
            metadata: payload || {},
          },
        });
      } catch (err: any) {
        console.error(
          "[AuditLog] Failed to record unknown_payment_reference:",
          err?.message,
        );
      }
      try {
        await notificationsService.sendAdminAlert(
          "Unknown Payment Reference",
          `Paystack webhook reference ${payload?.reference} could not be matched after retries.`,
          payload,
        );
      } catch (err: any) {
        console.error(
          "[Alert] Failed to dispatch unknown_reference alert:",
          err?.message,
        );
      }
      break;
    }

    case "admin.system_refund_failed": {
      try {
        await prisma.auditLog.create({
          data: {
            action: "ADMIN_SYSTEM_REFUND_FAILED",
            entityType: event.aggregateType,
            entityId: event.aggregateId,
            metadata: payload || {},
          },
        });
      } catch (err: any) {
        console.error(
          "[AuditLog] Failed to record system_refund_failed:",
          err?.message,
        );
      }
      try {
        await notificationsService.sendAdminAlert(
          "System Refund Failed",
          `System refund ${event.aggregateId} exhausted retry attempts and failed.`,
          payload,
        );
      } catch (err: any) {
        console.error(
          "[Alert] Failed to dispatch system_refund_failed alert:",
          err?.message,
        );
      }
      break;
    }

    default:
      break;
  }
}

// Register payment event handlers with outbox dispatcher
outboxService.registerHandler("payment.successful", handlePaymentEvents);
outboxService.registerHandler("payment.failed", handlePaymentEvents);
outboxService.registerHandler("payment.capacity_conflict", handlePaymentEvents);
outboxService.registerHandler("admin.payment_flagged", handlePaymentEvents);
outboxService.registerHandler(
  "admin.unknown_payment_reference",
  handlePaymentEvents,
);
outboxService.registerHandler(
  "admin.system_refund_failed",
  handlePaymentEvents,
);

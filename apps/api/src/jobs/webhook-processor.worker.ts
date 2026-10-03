import { prisma } from "../db/client.js";
import { paymentsService } from "../modules/payments/payments.service.js";
import { outboxService } from "../modules/events/outbox.service.js";
import { WebhookEventStatus } from "@prisma/client";

export class WebhookProcessorWorker {
  private isProcessing = false;

  async processPendingEvents(
    batchSize: number = 20,
    workerId: string = `webhook-worker-${process.pid}`,
  ): Promise<{
    processed: number;
    failed: number;
    retried: number;
  }> {
    if (this.isProcessing) return { processed: 0, failed: 0, retried: 0 };
    this.isProcessing = true;

    let processed = 0;
    let failed = 0;
    let retried = 0;

    try {
      // Claim events with FOR UPDATE SKIP LOCKED
      const claimedEvents = await prisma.$transaction(async (tx) => {
        const events = await tx.$queryRaw<
          Array<{
            id: string;
            eventId: string;
            eventType: string;
            payload: any;
            attempts: number;
          }>
        >`
          SELECT id, "eventId", "eventType", payload, attempts
          FROM "webhook_events"
          WHERE status = 'PENDING' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW() + INTERVAL '5 seconds')
          ORDER BY "createdAt" ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        `;

        if (events.length === 0) return [];

        const ids = events.map((e) => e.id);
        await tx.$executeRaw`
          UPDATE "webhook_events"
          SET status = 'PROCESSING', "lockedAt" = NOW(), "workerId" = ${workerId}, attempts = attempts + 1
          WHERE id = ANY(${ids}::text[])
        `;

        return events;
      });

      for (const event of claimedEvents) {
        try {
          const payload = event.payload;
          const result = await paymentsService.handleWebhookEvent(payload);

          if (result && (result as any).orphan) {
            // Unknown reference!
            const newAttempts = event.attempts + 1;
            if (newAttempts >= 3) {
              // Dead letter
              await prisma.webhookEvent.update({
                where: { id: event.id },
                data: {
                  status: WebhookEventStatus.DEAD_LETTER,
                  lastError: "UNKNOWN_PAYSTACK_REFERENCE",
                },
              });

              await prisma.auditLog.create({
                data: {
                  action: "WEBHOOK_DEAD_LETTERED",
                  entityType: "WebhookEvent",
                  entityId: event.id,
                  metadata: {
                    eventId: event.eventId,
                    attempts: newAttempts,
                    reason: "UNKNOWN_PAYSTACK_REFERENCE",
                  },
                },
              });

              await outboxService.recordEvent({
                eventType: "admin.unknown_payment_reference",
                aggregateType: "WebhookEvent",
                aggregateId: event.id,
                payload: {
                  eventId: event.eventId,
                  reference: payload?.data?.reference,
                  attempts: newAttempts,
                },
              });

              failed++;
            } else {
              // Delay retry: attempt 1: +5s, attempt 2: +20s, attempt 3: +60s
              const backoffSec =
                newAttempts === 1 ? 5 : newAttempts === 2 ? 20 : 60;
              const nextAttemptAt = new Date(Date.now() + backoffSec * 1000);

              await prisma.webhookEvent.update({
                where: { id: event.id },
                data: {
                  status: WebhookEventStatus.PENDING,
                  nextAttemptAt,
                  lastError: "UNKNOWN_PAYSTACK_REFERENCE_DELAYED",
                },
              });

              retried++;
            }
          } else {
            // Processed successfully
            await prisma.webhookEvent.update({
              where: { id: event.id },
              data: {
                status: WebhookEventStatus.PROCESSED,
                processedAt: new Date(),
              },
            });
            processed++;
          }
        } catch (err: any) {
          console.error(
            `[WebhookProcessor] Error processing event ${event.eventId}:`,
            err,
          );
          const newAttempts = event.attempts + 1;
          if (newAttempts >= 3) {
            await prisma.webhookEvent.update({
              where: { id: event.id },
              data: {
                status: WebhookEventStatus.DEAD_LETTER,
                lastError: err?.message || "PROCESSING_FAILED",
              },
            });
            failed++;
          } else {
            const backoffSec = newAttempts * 10;
            await prisma.webhookEvent.update({
              where: { id: event.id },
              data: {
                status: WebhookEventStatus.PENDING,
                nextAttemptAt: new Date(Date.now() + backoffSec * 1000),
                lastError: err?.message || "PROCESSING_FAILED",
              },
            });
            retried++;
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return { processed, failed, retried };
  }
}

export const webhookProcessorWorker = new WebhookProcessorWorker();

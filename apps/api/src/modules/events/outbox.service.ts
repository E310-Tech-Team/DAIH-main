import { OutboxEvent, OutboxStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";

export type EventHandler = (event: OutboxEvent) => Promise<void>;

export class OutboxService {
  private handlers: Map<string, EventHandler[]> = new Map();

  /**
   * Registers a domain event handler for a specific event type or wildcard
   */
  registerHandler(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  /**
   * Records a new outbox event within an existing transaction or with root prisma client
   */
  async recordEvent(
    data: {
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      payload: any;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<OutboxEvent> {
    const client = tx || prisma;
    return client.outboxEvent.create({
      data: {
        eventType: data.eventType,
        aggregateType: data.aggregateType,
        aggregateId: data.aggregateId,
        payload: data.payload,
        status: OutboxStatus.PENDING,
      },
    });
  }

  /**
   * Sweeper to recover events stuck in PROCESSING > 5 minutes back to PENDING
   */
  async recoverStuckProcessingEvents(
    stuckTimeoutMs: number = 5 * 60 * 1000,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - stuckTimeoutMs);
    const result = await prisma.outboxEvent.updateMany({
      where: {
        status: OutboxStatus.PROCESSING,
        lockedAt: { lt: cutoff },
      },
      data: {
        status: OutboxStatus.PENDING,
        lockedAt: null,
        workerId: null,
      },
    });
    return result.count;
  }

  /**
   * Fetches and dispatches pending events with atomic batch claim (SKIP LOCKED) and exponential backoff
   */
  async processPendingEvents(
    batchSize: number = 25,
    workerId: string = `outbox-worker-${process.pid}-${Date.now().toString(36)}`,
  ): Promise<{ processed: number; failed: number }> {
    // 1. Recover stuck events
    await this.recoverStuckProcessingEvents();

    // 2. Atomic Batch Claim with SKIP LOCKED
    const claimedEvents = await prisma.$queryRaw<Array<OutboxEvent>>`
      UPDATE "outbox_events"
      SET "status" = 'PROCESSING'::"OutboxStatus",
          "lockedAt" = NOW(),
          "workerId" = ${workerId},
          "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "outbox_events"
        WHERE "status" = 'PENDING'::"OutboxStatus"
          AND ("scheduledAt" IS NULL OR "scheduledAt" <= NOW())
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `;

    if (!claimedEvents || claimedEvents.length === 0) {
      return { processed: 0, failed: 0 };
    }

    let processedCount = 0;
    let failedCount = 0;

    for (const event of claimedEvents) {
      try {
        // Find registered handlers for this event type
        const matchingHandlers = [
          ...(this.handlers.get(event.eventType) || []),
          ...(this.handlers.get("*") || []),
        ];

        for (const handler of matchingHandlers) {
          await handler(event);
        }

        // Mark event as successfully published
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: OutboxStatus.PUBLISHED,
            processedAt: new Date(),
            lockedAt: null,
            error: null,
            lastError: null,
          },
        });

        processedCount++;
      } catch (err: any) {
        failedCount++;
        const currentAttempts = event.attempts || 1;
        const isDeadLetter = currentAttempts >= 5;
        const backoffSeconds = Math.pow(2, currentAttempts) * 1; // 2^attempts * 1s
        const nextScheduledAt = new Date(Date.now() + backoffSeconds * 1000);

        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: isDeadLetter
              ? OutboxStatus.DEAD_LETTER
              : OutboxStatus.PENDING,
            error: err?.message || "Unknown handler failure",
            lastError: err?.message || "Unknown handler failure",
            scheduledAt: nextScheduledAt,
            lockedAt: null,
            workerId: null,
          },
        });

        console.error(
          `❌ Error processing outbox event ${event.id} (${event.eventType}, attempt ${currentAttempts}/5):`,
          err?.message,
        );
      }
    }

    return { processed: processedCount, failed: failedCount };
  }
}

export const outboxService = new OutboxService();

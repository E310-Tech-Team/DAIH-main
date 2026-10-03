import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db/client.js";
import { webhookProcessorWorker } from "../src/jobs/webhook-processor.worker.js";
import { getWebhookDedupKey } from "../src/modules/payments/payments.controller.js";
import { WebhookEventStatus } from "@prisma/client";

describe("Webhook Persist-Then-Ack & Lease Locking (DAIH-QA-11)", () => {
  const createdEventIds: string[] = [];

  afterAll(async () => {
    if (createdEventIds.length > 0) {
      await prisma.webhookEvent.deleteMany({
        where: { id: { in: createdEventIds } },
      });
    }
  });

  it("extracts unique dedup keys per event type", () => {
    const chargeEvent = {
      event: "charge.success",
      data: { reference: "DAIH-REF-123", id: 9999 },
    };
    expect(getWebhookDedupKey(chargeEvent)).toBe("charge.success_DAIH-REF-123");

    const refundEvent = {
      event: "refund.processed",
      data: { id: "ref_888" },
    };
    expect(getWebhookDedupKey(refundEvent)).toBe("refund.processed_ref_888");
  });

  it("persists incoming webhook event and handles duplicate gracefully with P2002 idempotency", async () => {
    const dedupKey = `test_charge_${Date.now()}`;
    const payload = {
      event: "charge.success",
      data: { reference: "TEST-NONEXISTENT-REF", id: 1111 },
    };

    // First ingestion
    const event = await prisma.webhookEvent.create({
      data: {
        eventId: dedupKey,
        eventType: "charge.success",
        payload,
        status: WebhookEventStatus.PENDING,
      },
    });
    createdEventIds.push(event.id);
    expect(event.status).toBe(WebhookEventStatus.PENDING);

    // Duplicate ingestion attempt
    let duplicateCaught = false;
    try {
      await prisma.webhookEvent.create({
        data: {
          eventId: dedupKey,
          eventType: "charge.success",
          payload,
          status: WebhookEventStatus.PENDING,
        },
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        duplicateCaught = true;
      }
    }
    expect(duplicateCaught).toBe(true);
  });

  it("delays retry for unknown transaction references", async () => {
    const dedupKey = `test_unknown_${Date.now()}`;
    const payload = {
      event: "charge.success",
      data: { reference: `UNKNOWN-REF-${Date.now()}` },
    };

    const event = await prisma.webhookEvent.create({
      data: {
        eventId: dedupKey,
        eventType: "charge.success",
        payload,
        status: WebhookEventStatus.PENDING,
        attempts: 0,
      },
    });
    createdEventIds.push(event.id);

    // Process event using worker
    const result = await webhookProcessorWorker.processPendingEvents(
      10,
      "test-worker-1",
    );
    expect(result.retried).toBeGreaterThanOrEqual(1);

    // Verify it was scheduled for delayed retry
    const freshEvent = await prisma.webhookEvent.findUnique({
      where: { id: event.id },
    });
    expect(freshEvent?.status).toBe(WebhookEventStatus.PENDING);
    expect(freshEvent?.attempts).toBe(1);
    expect(freshEvent?.nextAttemptAt).not.toBeNull();
    expect(new Date(freshEvent!.nextAttemptAt!).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("transitions to DEAD_LETTER after 3 failed unknown reference attempts", async () => {
    const dedupKey = `test_dead_letter_${Date.now()}`;
    const payload = {
      event: "charge.success",
      data: { reference: `UNKNOWN-REF-EXHAUSTED-${Date.now()}` },
    };

    // Create event already at 2 attempts
    const event = await prisma.webhookEvent.create({
      data: {
        eventId: dedupKey,
        eventType: "charge.success",
        payload,
        status: WebhookEventStatus.PENDING,
        attempts: 2,
        nextAttemptAt: new Date(Date.now() - 1000), // Ready to run
      },
    });
    createdEventIds.push(event.id);

    // Process event (3rd attempt)
    const result = await webhookProcessorWorker.processPendingEvents(
      10,
      "test-worker-exhaust",
    );
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const freshEvent = await prisma.webhookEvent.findUnique({
      where: { id: event.id },
    });
    expect(freshEvent?.status).toBe(WebhookEventStatus.DEAD_LETTER);
    expect(freshEvent?.lastError).toBe("UNKNOWN_PAYSTACK_REFERENCE");
  });
});

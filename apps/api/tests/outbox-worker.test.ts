import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db/client.js";
import { outboxService } from "../src/modules/events/outbox.service.js";
import { OutboxStatus } from "@prisma/client";

describe("Distributed Outbox Worker Atomic Claiming & Lease Recovery (DAIH-QA-18)", () => {
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    await prisma.outboxEvent.deleteMany({});
  });

  afterAll(async () => {
    if (createdEventIds.length > 0) {
      await prisma.outboxEvent.deleteMany({
        where: { id: { in: createdEventIds } },
      });
    }
  });

  it("atomically claims events using SKIP LOCKED without duplicate claims across workers", async () => {
    // Create 10 pending events
    const eventPromises = Array.from({ length: 10 }).map((_, i) =>
      outboxService.recordEvent({
        eventType: "test.concurrency.event",
        aggregateType: "Test",
        aggregateId: `test-${Date.now()}-${i}`,
        payload: { index: i },
      }),
    );
    const createdEvents = await Promise.all(eventPromises);
    createdEventIds.push(...createdEvents.map((e) => e.id));

    // Register a handler tracking which worker processed which event
    const processedByWorker1: string[] = [];
    const processedByWorker2: string[] = [];

    outboxService.registerHandler("test.concurrency.event", async (event) => {
      // Simulate slight worker processing delay
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (event.workerId === "worker-alpha") {
        processedByWorker1.push(event.id);
      } else if (event.workerId === "worker-beta") {
        processedByWorker2.push(event.id);
      }
    });

    // Run 2 workers concurrently claiming from the pool
    const [w1, w2] = await Promise.all([
      outboxService.processPendingEvents(5, "worker-alpha"),
      outboxService.processPendingEvents(5, "worker-beta"),
    ]);

    expect(w1.processed + w2.processed).toBeGreaterThanOrEqual(10);

    // Verify completely disjoint sets (0 double processing)
    const set1 = new Set(processedByWorker1);
    const overlap = processedByWorker2.filter((id) => set1.has(id));
    expect(overlap).toHaveLength(0);

    // Verify all 10 are now PUBLISHED
    const freshEvents = await prisma.outboxEvent.findMany({
      where: { id: { in: createdEvents.map((e) => e.id) } },
    });
    for (const ev of freshEvents) {
      expect(ev.status).toBe(OutboxStatus.PUBLISHED);
      expect(ev.lockedAt).toBeNull();
    }
  });

  it("applies exponential backoff on failure and transitions to DEAD_LETTER after 5 attempts", async () => {
    const failingEvent = await outboxService.recordEvent({
      eventType: "test.failing.event",
      aggregateType: "Test",
      aggregateId: `test-fail-${Date.now()}`,
      payload: { fail: true },
    });
    createdEventIds.push(failingEvent.id);

    outboxService.registerHandler("test.failing.event", async () => {
      throw new Error("Simulated external service timeout");
    });

    // Attempt 1
    const res1 = await outboxService.processPendingEvents(10, "worker-fail");
    expect(res1.failed).toBe(1);

    const freshAfter1 = await prisma.outboxEvent.findUnique({
      where: { id: failingEvent.id },
    });
    expect(freshAfter1?.status).toBe(OutboxStatus.PENDING);
    expect(freshAfter1?.attempts).toBe(1);
    expect(freshAfter1?.lastError).toContain(
      "Simulated external service timeout",
    );
    expect(new Date(freshAfter1!.scheduledAt).getTime()).toBeGreaterThan(
      Date.now(),
    );

    // Force attempts to 4 and reset scheduledAt to NOW() to test 5th terminal attempt
    await prisma.outboxEvent.update({
      where: { id: failingEvent.id },
      data: { attempts: 4, scheduledAt: new Date(Date.now() - 1000) },
    });

    // Attempt 5
    const res5 = await outboxService.processPendingEvents(10, "worker-fail");
    expect(res5.failed).toBe(1);

    const freshAfter5 = await prisma.outboxEvent.findUnique({
      where: { id: failingEvent.id },
    });
    expect(freshAfter5?.status).toBe(OutboxStatus.DEAD_LETTER);
    expect(freshAfter5?.attempts).toBe(5);
  });

  it("recovers events stuck in PROCESSING > 5 minutes back to PENDING", async () => {
    const stuckEvent = await outboxService.recordEvent({
      eventType: "test.stuck.event",
      aggregateType: "Test",
      aggregateId: `test-stuck-${Date.now()}`,
      payload: { stuck: true },
    });
    createdEventIds.push(stuckEvent.id);

    // Manually simulate a crashed worker holding a lease 10 minutes ago
    await prisma.outboxEvent.update({
      where: { id: stuckEvent.id },
      data: {
        status: OutboxStatus.PROCESSING,
        lockedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 mins ago
        workerId: "crashed-worker-pod-99",
      },
    });

    const recoveredCount = await outboxService.recoverStuckProcessingEvents(
      5 * 60 * 1000,
    );
    expect(recoveredCount).toBeGreaterThanOrEqual(1);

    const fresh = await prisma.outboxEvent.findUnique({
      where: { id: stuckEvent.id },
    });
    expect(fresh?.status).toBe(OutboxStatus.PENDING);
    expect(fresh?.lockedAt).toBeNull();
    expect(fresh?.workerId).toBeNull();
  });
});

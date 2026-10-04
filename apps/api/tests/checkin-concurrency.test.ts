import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db/client.js";
import { AccessService } from "../src/modules/access/access.service.js";
import { BookingState, UserRole } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

describe("Check-In Concurrency & Single Active Visit Session (DAIH-QA-13)", () => {
  let accessService: AccessService;
  let testUserId: string;
  let testResourceId: string;
  const createdBookingIds: string[] = [];

  beforeAll(async () => {
    accessService = new AccessService();

    const user = await prisma.user.create({
      data: {
        email: `checkin_race_${Date.now()}@daih.ng`,
        clientId: `DAIH-CHK-${Date.now()}`,
        passwordHash: "test_hash",
        firstName: "Concurrent",
        lastName: "Checker",
        role: UserRole.CUSTOMER,
        isVerified: true,
      },
    });
    testUserId = user.id;

    const resource = await prisma.facilityResource.create({
      data: {
        name: `Checkin Desk ${Date.now()}`,
        slug: `checkin-desk-${Date.now()}`,
        category: "HOT_DESK",
        description: "Test desk for check-in concurrency",
        location: "Level 1 Desk Zone",
        capacity: 10,
      },
    });
    testResourceId = resource.id;
  });

  afterAll(async () => {
    if (createdBookingIds.length > 0) {
      await prisma.visitSession.deleteMany({
        where: { bookingId: { in: createdBookingIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: createdBookingIds } },
      });
      await prisma.booking.deleteMany({
        where: { id: { in: createdBookingIds } },
      });
    }
    if (testResourceId) {
      await prisma.facilityResource.delete({ where: { id: testResourceId } });
    }
    if (testUserId) {
      await prisma.user.delete({ where: { id: testUserId } });
    }
  });

  it("handles concurrent check-ins: exactly 1 succeeds, 1 returns ALREADY_CHECKED_IN 409", async () => {
    const now = new Date();
    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-CONC`,
        userId: testUserId,
        resourceId: testResourceId,
        startTime: new Date(now.getTime() - 1800 * 1000), // Started 30 mins ago
        endTime: new Date(now.getTime() + 7200 * 1000), // Ends in 2 hours
        totalAmount: new Decimal("1000.00"),
        cashDue: new Decimal("1000.00"),
        state: BookingState.CONFIRMED,
      },
    });
    createdBookingIds.push(booking.id);

    // Fire 2 concurrent check-ins
    const [result1, result2] = await Promise.allSettled([
      accessService.checkIn(booking.id, { terminalId: "TERM-GATE-1" }),
      accessService.checkIn(booking.id, { terminalId: "TERM-GATE-2" }),
    ]);

    const successes = [result1, result2].filter(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<any>[];
    const rejections = [result1, result2].filter(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult[];

    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(1);

    expect(successes[0].value.action).toBe("CHECKED_IN");
    expect(rejections[0].reason?.code).toBe("ALREADY_CHECKED_IN");
    expect(rejections[0].reason?.statusCode).toBe(409);

    // Verify database state: exactly 1 active visit session exists
    const activeSessions = await prisma.visitSession.findMany({
      where: {
        bookingId: booking.id,
        checkOutTime: null,
      },
    });
    expect(activeSessions).toHaveLength(1);

    // Verify booking state transitioned to CHECKED_IN
    const freshBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
    });
    expect(freshBooking?.state).toBe(BookingState.CHECKED_IN);
    expect(freshBooking?.checkedInAt).not.toBeNull();
  });

  it("enforces idx_active_visit_session partial unique index directly in database", async () => {
    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-IDX`,
        userId: testUserId,
        resourceId: testResourceId,
        startTime: new Date(Date.now() - 1800 * 1000),
        endTime: new Date(Date.now() + 7200 * 1000),
        totalAmount: new Decimal("1000.00"),
        cashDue: new Decimal("1000.00"),
        state: BookingState.CONFIRMED,
      },
    });
    createdBookingIds.push(booking.id);

    // Insert first open session
    await prisma.visitSession.create({
      data: {
        bookingId: booking.id,
        userId: testUserId,
        checkInTime: new Date(),
        checkOutTime: null,
      },
    });

    // Attempt second open session on same booking
    let errorCaught: any = null;
    try {
      await prisma.visitSession.create({
        data: {
          bookingId: booking.id,
          userId: testUserId,
          checkInTime: new Date(),
          checkOutTime: null,
        },
      });
    } catch (err: any) {
      errorCaught = err;
    }

    expect(errorCaught).not.toBeNull();
    expect(errorCaught.code).toBe("P2002");
  });
});

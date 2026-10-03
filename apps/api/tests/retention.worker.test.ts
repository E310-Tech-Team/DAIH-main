import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db/client.js";
import { retentionService } from "../src/jobs/retention.worker.js";
import {
  BookingState,
  CoinLedgerAction,
  HoldStatus,
  RefundReasonCode,
  RefundStatus,
  UserRole,
} from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

describe("Dormant Customer Retention & Coin Expiry Rules (DAIH-QA-17)", () => {
  const createdUserIds: string[] = [];
  const createdBookingIds: string[] = [];
  let testResourceId: string;

  beforeAll(async () => {
    const resource = await prisma.facilityResource.create({
      data: {
        name: `Retention Desk ${Date.now()}`,
        slug: `retention-desk-${Date.now()}`,
        category: "HOT_DESK",
        description: "Test desk for retention rules",
        location: "Zone R",
        capacity: 10,
      },
    });
    testResourceId = resource.id;
  });

  afterAll(async () => {
    if (createdBookingIds.length > 0) {
      await prisma.coinHold.deleteMany({
        where: { bookingId: { in: createdBookingIds } },
      });
      await prisma.refundRequest.deleteMany({
        where: { bookingId: { in: createdBookingIds } },
      });
      await prisma.booking.deleteMany({
        where: { id: { in: createdBookingIds } },
      });
    }
    if (createdUserIds.length > 0) {
      await prisma.coinLedgerEntry.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.coinBalance.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.authSession.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
    if (testResourceId) {
      await prisma.facilityResource.delete({ where: { id: testResourceId } });
    }
  });

  it("expires dormant coins and anonymizes inactive customer in dry-run mode without writes", async () => {
    const pastDate = new Date();
    pastDate.setMonth(pastDate.getMonth() - 25); // 25 months ago

    const user = await prisma.user.create({
      data: {
        email: `dryrun_${Date.now()}@daih.ng`,
        clientId: `DAIH-DRY-${Date.now()}`,
        passwordHash: "test_hash",
        firstName: "Dry",
        lastName: "RunUser",
        role: UserRole.CUSTOMER,
        createdAt: pastDate,
      },
    });
    createdUserIds.push(user.id);

    await prisma.coinBalance.create({
      data: {
        userId: user.id,
        balance: new Decimal("50.00"),
        lifetimeEarned: new Decimal("50.00"),
      },
    });

    const summary = await retentionService.anonymizeInactiveCustomers(24, {
      dryRun: true,
    });

    expect(summary.anonymizedUserIds).toContain(user.id);

    // Verify database was NOT written
    const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(freshUser?.firstName).toBe("Dry");
    expect(freshUser?.email).toBe(user.email);

    const freshBal = await prisma.coinBalance.findUnique({
      where: { userId: user.id },
    });
    expect(Number(freshBal?.balance)).toBe(50);
  });

  it("runs coin expiry pass before anonymization and executes anonymization", async () => {
    const pastDate = new Date();
    pastDate.setMonth(pastDate.getMonth() - 26); // 26 months ago

    const user = await prisma.user.create({
      data: {
        email: `real_anon_${Date.now()}@daih.ng`,
        clientId: `DAIH-ANON-${Date.now()}`,
        passwordHash: "test_hash",
        firstName: "Real",
        lastName: "AnonUser",
        role: UserRole.CUSTOMER,
        createdAt: pastDate,
      },
    });
    createdUserIds.push(user.id);

    await prisma.coinBalance.create({
      data: {
        userId: user.id,
        balance: new Decimal("30.00"),
        lifetimeEarned: new Decimal("30.00"),
      },
    });

    const summary = await retentionService.anonymizeInactiveCustomers(24, {
      dryRun: false,
    });

    expect(summary.anonymizedUserIds).toContain(user.id);

    // Verify coin balance is now 0 and EXPIRY ledger entry was created
    const freshBal = await prisma.coinBalance.findUnique({
      where: { userId: user.id },
    });
    expect(Number(freshBal?.balance)).toBe(0);

    const ledger = await prisma.coinLedgerEntry.findFirst({
      where: { userId: user.id, action: CoinLedgerAction.EXPIRY },
    });
    expect(ledger).not.toBeNull();
    expect(Number(ledger?.amount)).toBe(-30);

    // Verify user is now anonymized
    const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(freshUser?.firstName).toBe("Anonymized");
    expect(freshUser?.lastName).toBe("Customer");
    expect(freshUser?.email).toContain("@daih.anonymized");
  });

  it("strictly excludes customers with active bookings from anonymization", async () => {
    const pastDate = new Date();
    pastDate.setMonth(pastDate.getMonth() - 25);

    const user = await prisma.user.create({
      data: {
        email: `active_bking_${Date.now()}@daih.ng`,
        clientId: `DAIH-ACTBK-${Date.now()}`,
        passwordHash: "test_hash",
        firstName: "Active",
        lastName: "BookingUser",
        role: UserRole.CUSTOMER,
        createdAt: pastDate,
      },
    });
    createdUserIds.push(user.id);

    // Active future booking
    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-ACT`,
        userId: user.id,
        resourceId: testResourceId,
        startTime: new Date(Date.now() + 3600 * 1000),
        endTime: new Date(Date.now() + 7200 * 1000),
        totalAmount: new Decimal("1000.00"),
        cashDue: new Decimal("1000.00"),
        state: BookingState.CONFIRMED,
      },
    });
    createdBookingIds.push(booking.id);

    const summary = await retentionService.anonymizeInactiveCustomers(24, {
      dryRun: false,
    });

    expect(summary.anonymizedUserIds).not.toContain(user.id);

    const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(freshUser?.firstName).toBe("Active");
  });

  it("strictly excludes customers with active coin holds from anonymization", async () => {
    const pastDate = new Date();
    pastDate.setMonth(pastDate.getMonth() - 25);

    const user = await prisma.user.create({
      data: {
        email: `hold_user_${Date.now()}@daih.ng`,
        clientId: `DAIH-HOLD-${Date.now()}`,
        passwordHash: "test_hash",
        firstName: "Hold",
        lastName: "User",
        role: UserRole.CUSTOMER,
        createdAt: pastDate,
      },
    });
    createdUserIds.push(user.id);

    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-HLD`,
        userId: user.id,
        resourceId: testResourceId,
        startTime: new Date(Date.now() + 3600 * 1000),
        endTime: new Date(Date.now() + 7200 * 1000),
        totalAmount: new Decimal("1000.00"),
        cashDue: new Decimal("800.00"),
        state: BookingState.HELD,
      },
    });
    createdBookingIds.push(booking.id);

    await prisma.coinHold.create({
      data: {
        userId: user.id,
        bookingId: booking.id,
        amount: new Decimal("200.00"),
        nairaValue: new Decimal("200.00"),
        status: HoldStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 900 * 1000),
      },
    });

    const summary = await retentionService.anonymizeInactiveCustomers(24, {
      dryRun: false,
    });

    expect(summary.anonymizedUserIds).not.toContain(user.id);
  });

  it("strictly excludes customers with open refund requests from anonymization", async () => {
    const pastDate = new Date();
    pastDate.setMonth(pastDate.getMonth() - 25);

    const user = await prisma.user.create({
      data: {
        email: `refund_user_${Date.now()}@daih.ng`,
        clientId: `DAIH-REFU-${Date.now()}`,
        passwordHash: "test_hash",
        firstName: "Refund",
        lastName: "User",
        role: UserRole.CUSTOMER,
        createdAt: pastDate,
      },
    });
    createdUserIds.push(user.id);

    await prisma.refundRequest.create({
      data: {
        amount: new Decimal("500.00"),
        reasonCode: RefundReasonCode.CUSTOMER_DISPUTE,
        reason: "Open dispute regarding facility downtime",
        status: RefundStatus.PENDING,
        requestedByUserId: user.id,
      },
    });

    const summary = await retentionService.anonymizeInactiveCustomers(24, {
      dryRun: false,
    });

    expect(summary.anonymizedUserIds).not.toContain(user.id);
  });
});

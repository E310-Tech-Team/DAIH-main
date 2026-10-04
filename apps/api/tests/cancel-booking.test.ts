import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import {
  BookingState,
  HoldStatus,
  PaymentStatus,
  UserRole,
} from "@prisma/client";
import jwt from "jsonwebtoken";
import { config } from "../src/config/env.js";

describe("DAIH-QA-15: Confirmed Booking Cancellation Policy & Cleanup", () => {
  let customerUser: any;
  let customerToken: string;
  let staffUser: any;
  let staffToken: string;
  let resource: any;

  beforeAll(async () => {
    // 1. Create customer user & token
    customerUser = await prisma.user.create({
      data: {
        email: `cancel_cust_${Date.now()}@daih.ng`,
        firstName: "Cancel",
        lastName: "Customer",
        role: UserRole.CUSTOMER,
        clientId: `CUST-CAN-${Date.now()}`,
        isVerified: true,
      },
    });

    customerToken = jwt.sign(
      {
        id: customerUser.id,
        email: customerUser.email,
        role: customerUser.role,
        clientId: customerUser.clientId,
        emailVerified: true,
      },
      config.jwt.secret,
      { expiresIn: "1h" },
    );

    // 2. Create staff user & token
    staffUser = await prisma.user.create({
      data: {
        email: `cancel_staff_${Date.now()}@daih.ng`,
        firstName: "Ops",
        lastName: "Admin",
        role: UserRole.OPERATIONS_ADMIN,
        clientId: `STAFF-CAN-${Date.now()}`,
        isVerified: true,
      },
    });

    staffToken = jwt.sign(
      {
        id: staffUser.id,
        email: staffUser.email,
        role: staffUser.role,
        clientId: staffUser.clientId,
        emailVerified: true,
      },
      config.jwt.secret,
      { expiresIn: "1h" },
    );

    // 3. Create test facility resource
    const ts = Date.now();
    resource = await prisma.facilityResource.create({
      data: {
        name: `Desk-Cancel-Test-${ts}`,
        slug: `desk-cancel-test-${ts}`,
        category: "HOT_DESK",
        description: "Test desk for cancellation policy test",
        location: "Floor 1 Hot Desks",
        capacity: 10,
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({
      where: { booking: { userId: customerUser.id } },
    });
    await prisma.coinHold.deleteMany({
      where: { booking: { userId: customerUser.id } },
    });
    await prisma.booking.deleteMany({
      where: { userId: customerUser.id },
    });
    if (resource) {
      await prisma.facilityResource.delete({ where: { id: resource.id } });
    }
    if (customerUser) {
      await prisma.user.delete({ where: { id: customerUser.id } });
    }
    if (staffUser) {
      await prisma.user.delete({ where: { id: staffUser.id } });
    }
  });

  it("blocks customer from cancelling a CONFIRMED booking with HTTP 403", async () => {
    const confirmedBooking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-CONF-${Date.now()}`,
        resourceId: resource.id,
        userId: customerUser.id,
        startTime: new Date(Date.now() + 24 * 3600000),
        endTime: new Date(Date.now() + 28 * 3600000),
        state: BookingState.CONFIRMED,
        totalAmount: 15000,
        cashDue: 15000,
        currency: "NGN",
      },
    });

    const res = await request(app)
      .post(`/api/v1/bookings/${confirmedBooking.id}/cancel`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ reason: "Emergency conflict" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CANNOT_CANCEL_CONFIRMED_BOOKING");

    // Assert booking remains CONFIRMED in database
    const dbBooking = await prisma.booking.findUnique({
      where: { id: confirmedBooking.id },
    });
    expect(dbBooking?.state).toBe(BookingState.CONFIRMED);
  });

  it("allows cancelling an unconfirmed HELD booking, abandoning pending transactions and releasing coin holds", async () => {
    const heldBooking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-HELD-${Date.now()}`,
        resourceId: resource.id,
        userId: customerUser.id,
        startTime: new Date(Date.now() + 48 * 3600000),
        endTime: new Date(Date.now() + 52 * 3600000),
        state: BookingState.HELD,
        totalAmount: 20000,
        cashDue: 15000,
        redeemedCoins: 50,
        currency: "NGN",
      },
    });

    // Create linked pending transaction
    const pendingTx = await prisma.transaction.create({
      data: {
        bookingId: heldBooking.id,
        userId: customerUser.id,
        reference: `TX-HELD-${Date.now()}`,
        amount: 15000,
        currency: "NGN",
        status: PaymentStatus.PENDING,
      },
    });

    // Create active coin hold
    const activeCoinHold = await prisma.coinHold.create({
      data: {
        bookingId: heldBooking.id,
        userId: customerUser.id,
        amount: 50,
        nairaValue: 50,
        status: HoldStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });

    const res = await request(app)
      .post(`/api/v1/bookings/${heldBooking.id}/cancel`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ reason: "Changed plans" });

    expect(res.status).toBe(200);

    // 1. Verify booking transitioned to CANCELLED
    const dbBooking = await prisma.booking.findUnique({
      where: { id: heldBooking.id },
    });
    expect(dbBooking?.state).toBe(BookingState.CANCELLED);

    // 2. Verify pending transaction was actively ABANDONED
    const dbTx = await prisma.transaction.findUnique({
      where: { id: pendingTx.id },
    });
    expect(dbTx?.status).toBe(PaymentStatus.ABANDONED);

    // 3. Verify active coin hold was marked RELEASED
    const dbCoinHold = await prisma.coinHold.findUnique({
      where: { id: activeCoinHold.id },
    });
    expect(dbCoinHold?.status).toBe(HoldStatus.RELEASED);
  });

  it("allows operations staff to administratively cancel an unconfirmed held booking", async () => {
    const adminTargetBooking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-STAFF-${Date.now()}`,
        resourceId: resource.id,
        userId: customerUser.id,
        startTime: new Date(Date.now() + 72 * 3600000),
        endTime: new Date(Date.now() + 76 * 3600000),
        state: BookingState.HELD,
        totalAmount: 10000,
        cashDue: 10000,
        currency: "NGN",
      },
    });

    const res = await request(app)
      .post(`/api/v1/bookings/${adminTargetBooking.id}/cancel`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ reason: "Administrative hold clearance" });

    expect(res.status).toBe(200);

    const dbBooking = await prisma.booking.findUnique({
      where: { id: adminTargetBooking.id },
    });
    expect(dbBooking?.state).toBe(BookingState.CANCELLED);
  });
});

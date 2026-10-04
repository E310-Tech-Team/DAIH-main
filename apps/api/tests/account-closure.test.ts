import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import {
  BookingState,
  HoldStatus,
  PaymentStatus,
  RefundStatus,
  RefundReasonCode,
  UserRole,
  CoinLedgerAction,
} from "@prisma/client";
import jwt from "jsonwebtoken";
import { config } from "../src/config/env.js";
import { passwordService } from "../src/modules/identity/password.service.js";
import { redis, isRedisAvailable } from "../src/config/redis.js";

describe("DAIH-QA-16: Self-Service Account Closure Flow & Support Reactivation", () => {
  let superAdminUser: any;
  let superAdminToken: string;
  let customerUser: any;
  let customerToken: string;
  let rawPassword = "Password123!";
  let resource: any;

  beforeAll(async () => {
    // 1. Create Super Admin
    superAdminUser = await prisma.user.create({
      data: {
        email: `superadmin_deact_${Date.now()}@daih.ng`,
        firstName: "Super",
        lastName: "Admin",
        role: UserRole.SUPER_ADMIN,
        clientId: `SA-DEACT-${Date.now()}`,
        isVerified: true,
      },
    });
    superAdminToken = jwt.sign(
      {
        id: superAdminUser.id,
        email: superAdminUser.email,
        role: superAdminUser.role,
        clientId: superAdminUser.clientId,
        emailVerified: true,
      },
      config.jwt.secret,
      { expiresIn: "1h" },
    );

    // 2. Create customer with password
    const passwordHash = await passwordService.hashPassword(rawPassword);
    customerUser = await prisma.user.create({
      data: {
        email: `closure_cust_${Date.now()}@daih.ng`,
        firstName: "Closure",
        lastName: "Tester",
        role: UserRole.CUSTOMER,
        clientId: `CUST-CLOSE-${Date.now()}`,
        isVerified: true,
        passwordHash,
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

    // 3. Create test facility resource
    const ts = Date.now();
    resource = await prisma.facilityResource.create({
      data: {
        name: `Resource-Deact-${ts}`,
        slug: `resource-deact-${ts}`,
        category: "HOT_DESK",
        description: "Resource for deactivation tests",
        location: "Floor 2",
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
    await prisma.refundRequest.deleteMany({
      where: { booking: { userId: customerUser.id } },
    });
    await prisma.coinLedgerEntry.deleteMany({
      where: { userId: customerUser.id },
    });
    await prisma.coinBalance.deleteMany({
      where: { userId: customerUser.id },
    });
    if (resource) {
      await prisma.facilityResource.delete({ where: { id: resource.id } });
    }
    if (customerUser) {
      await prisma.user.delete({ where: { id: customerUser.id } });
    }
    if (superAdminUser) {
      await prisma.user.delete({ where: { id: superAdminUser.id } });
    }
  });

  it("blocks deactivation when user has active confirmed bookings", async () => {
    const activeBooking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-ACT-${Date.now()}`,
        resourceId: resource.id,
        userId: customerUser.id,
        startTime: new Date(Date.now() + 2 * 3600000),
        endTime: new Date(Date.now() + 6 * 3600000),
        state: BookingState.CONFIRMED,
        totalAmount: 10000,
        currency: "NGN",
      },
    });

    const res = await request(app)
      .post("/api/v1/identity/account/deactivate")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ password: rawPassword, forfeitCoinsConsent: true });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ACTIVE_BOOKING_PREVENTS_CLOSURE");

    // Cleanup active booking
    await prisma.booking.delete({ where: { id: activeBooking.id } });
  });

  it("blocks deactivation when user has open refund requests", async () => {
    const refundBooking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-REF-${Date.now()}`,
        resourceId: resource.id,
        userId: customerUser.id,
        startTime: new Date(Date.now() - 48 * 3600000),
        endTime: new Date(Date.now() - 40 * 3600000),
        state: BookingState.CANCELLED,
        totalAmount: 10000,
        currency: "NGN",
      },
    });

    const refund = await prisma.refundRequest.create({
      data: {
        bookingId: refundBooking.id,
        amount: 10000,
        reasonCode: RefundReasonCode.CUSTOMER_DISPUTE,
        reason: "Customer dispute pending review",
        status: RefundStatus.PENDING,
      },
    });

    const res = await request(app)
      .post("/api/v1/identity/account/deactivate")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ password: rawPassword, forfeitCoinsConsent: true });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OPEN_REFUND_PREVENTS_CLOSURE");

    // Cleanup
    await prisma.refundRequest.delete({ where: { id: refund.id } });
    await prisma.booking.delete({ where: { id: refundBooking.id } });
  });

  it("rejects deactivation if incorrect password is provided", async () => {
    const res = await request(app)
      .post("/api/v1/identity/account/deactivate")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ password: "WrongPassword123!", forfeitCoinsConsent: true });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PASSWORD");
  });

  it("successfully deactivates account, cancels unconfirmed holds, forfeits coins, and revokes sessions", async () => {
    // Setup 1: Unconfirmed HELD booking
    const heldBooking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-HD-${Date.now()}`,
        resourceId: resource.id,
        userId: customerUser.id,
        startTime: new Date(Date.now() + 10 * 3600000),
        endTime: new Date(Date.now() + 14 * 3600000),
        state: BookingState.HELD,
        totalAmount: 15000,
        currency: "NGN",
      },
    });
    const pendingTx = await prisma.transaction.create({
      data: {
        bookingId: heldBooking.id,
        userId: customerUser.id,
        reference: `TX-HD-${Date.now()}`,
        amount: 15000,
        currency: "NGN",
        status: PaymentStatus.PENDING,
      },
    });
    const coinHold = await prisma.coinHold.create({
      data: {
        bookingId: heldBooking.id,
        userId: customerUser.id,
        amount: 20,
        nairaValue: 20,
        status: HoldStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });

    // Setup 2: PeeDee Coin Balance
    await prisma.coinBalance.upsert({
      where: { userId: customerUser.id },
      create: {
        userId: customerUser.id,
        balance: 50,
        lifetimeEarned: 50,
        lifetimeBurned: 0,
      },
      update: { balance: 50 },
    });

    // Execute Deactivation
    const res = await request(app)
      .post("/api/v1/identity/account/deactivate")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        password: rawPassword,
        forfeitCoinsConsent: true,
        reason: "Relocating abroad",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify 1: User marked deactivatedAt
    const dbUser = await prisma.user.findUnique({
      where: { id: customerUser.id },
    });
    expect(dbUser?.deactivatedAt).not.toBeNull();

    // Verify 2: Held booking CANCELLED, pending TX ABANDONED, coin hold RELEASED
    const dbBooking = await prisma.booking.findUnique({
      where: { id: heldBooking.id },
    });
    expect(dbBooking?.state).toBe(BookingState.CANCELLED);

    const dbTx = await prisma.transaction.findUnique({
      where: { id: pendingTx.id },
    });
    expect(dbTx?.status).toBe(PaymentStatus.ABANDONED);

    const dbHold = await prisma.coinHold.findUnique({
      where: { id: coinHold.id },
    });
    expect(dbHold?.status).toBe(HoldStatus.RELEASED);

    // Verify 3: Coins forfeited and balance zeroed
    const dbBalance = await prisma.coinBalance.findUnique({
      where: { userId: customerUser.id },
    });
    expect(Number(dbBalance?.balance)).toBe(0);

    const forfeitEntry = await prisma.coinLedgerEntry.findFirst({
      where: { userId: customerUser.id, action: CoinLedgerAction.EXPIRY },
    });
    expect(forfeitEntry).not.toBeNull();
    expect(Number(forfeitEntry?.amount)).toBe(-50);
  });

  it("rejects login, registration, and authenticated requests for deactivated user", async () => {
    // 1. Password Login rejected with 403
    const loginRes = await request(app).post("/api/v1/identity/login").send({
      email: customerUser.email,
      password: rawPassword,
    });
    expect(loginRes.status).toBe(403);
    expect(loginRes.body.code).toBe("ACCOUNT_DEACTIVATED");

    // 2. Re-registration rejected with 403
    const registerRes = await request(app)
      .post("/api/v1/identity/register")
      .send({
        firstName: "New",
        lastName: "Attempt",
        email: customerUser.email,
        password: "NewPassword123!",
        consented: true,
      });
    expect(registerRes.status).toBe(403);
    expect(registerRes.body.code).toBe("ACCOUNT_DEACTIVATED");

    // 3. Immediate token termination via auth middleware
    const authRes = await request(app)
      .get("/api/v1/identity/me")
      .set("Authorization", `Bearer ${customerToken}`);
    expect(authRes.status).toBe(403);
    expect(authRes.body.code).toBe("ACCOUNT_DEACTIVATED");
  });

  it("allows Super Admin to reactivate customer account, restoring login access", async () => {
    // 1. Non-admin fails to reactivate
    const unauthorizedRes = await request(app)
      .post("/api/v1/identity/account/reactivate")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        userId: customerUser.id,
        reason: "Customer verified in person with government ID",
      });
    expect(unauthorizedRes.status).toBe(403);

    // 2. Super Admin successfully reactivates account
    const reactivateRes = await request(app)
      .post("/api/v1/identity/account/reactivate")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({
        userId: customerUser.id,
        reason: "Customer verified in person with government ID",
      });
    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.success).toBe(true);

    // 3. Verify user.deactivatedAt is null in DB
    const dbUser = await prisma.user.findUnique({
      where: { id: customerUser.id },
    });
    expect(dbUser?.deactivatedAt).toBeNull();

    // 4. Customer can now log in successfully!
    const loginRes = await request(app).post("/api/v1/identity/login").send({
      email: customerUser.email,
      password: rawPassword,
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.user.email).toBe(customerUser.email);
  });
});

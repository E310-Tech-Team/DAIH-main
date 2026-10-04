import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { app } from "../../app.js";
import { prisma } from "../../db/client.js";
import { config } from "../../config/env.js";
import {
  UserRole,
  BookingState,
  PaymentStatus,
  ResourceCategory,
} from "@daih/types";
import { RefundReasonCode } from "@prisma/client";
import { paymentsService } from "./payments.service.js";
import { paystackClient } from "./paystack.client.js";
import { webhookProcessorWorker } from "../../jobs/webhook-processor.worker.js";

describe("Milestone 1.4: Payment Engine & Reconciliation Module", () => {
  let customerToken: string;
  let customer2Token: string;
  let financeToken: string;
  let opsToken: string;

  let customerUserId: string;
  let customer2UserId: string;
  let financeUserId: string;

  let testResourceId: string;
  let testBookingId: string;
  let testBookingReference: string;
  let testTransactionReference: string;

  const jwtSecret = config.jwt.secret || "dev-secret-key-12345678901234567890";
  /**
   * Helper to sign payload with HMAC-SHA512 using the secret key, as Paystack does
   */
  function signPaystackPayload(payload: any): string {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
    return crypto
      .createHmac("sha512", config.paystack.secretKey)
      .update(raw)
      .digest("hex");
  }

  beforeAll(async () => {
    // 0. Pre-clean test data from prior interrupted runs
    try {
      await prisma.webhookEvent.deleteMany({});
      await prisma.invoice.deleteMany({
        where: { customerEmail: { contains: "payment@daih.ng" } },
      });
      await prisma.transaction.deleteMany({
        where: { user: { email: { contains: "payment@daih.ng" } } },
      });
      await prisma.booking.deleteMany({
        where: { user: { email: { contains: "payment@daih.ng" } } },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: "payment@daih.ng" } },
      });
    } catch {}

    // 1. Setup Test Users
    const customerUser = await prisma.user.upsert({
      where: { email: "customer.payment@daih.ng" },
      update: {
        role: UserRole.CUSTOMER,
        isVerified: true,
        firstName: "Tunde",
        lastName: "Balogun",
        clientId: "DAIH-2026-PAY001",
      },
      create: {
        email: "customer.payment@daih.ng",
        firstName: "Tunde",
        lastName: "Balogun",
        clientId: "DAIH-2026-PAY001",
        role: UserRole.CUSTOMER,
        isVerified: true,
      },
    });
    customerUserId = customerUser.id;

    const customer2 = await prisma.user.upsert({
      where: { email: "customer2.payment@daih.ng" },
      update: {
        role: UserRole.CUSTOMER,
        isVerified: true,
        firstName: "Chioma",
        lastName: "Nwosu",
        clientId: "DAIH-2026-PAY002",
      },
      create: {
        email: "customer2.payment@daih.ng",
        firstName: "Chioma",
        lastName: "Nwosu",
        clientId: "DAIH-2026-PAY002",
        role: UserRole.CUSTOMER,
        isVerified: true,
      },
    });
    customer2UserId = customer2.id;

    const runId = Date.now().toString().slice(-6);
    const financeUser = await prisma.user.upsert({
      where: { email: "finance.payment@daih.ng" },
      update: {
        role: UserRole.FINANCE_OFFICER,
        isVerified: true,
        firstName: "Fola",
        lastName: "Accountant",
      },
      create: {
        email: "finance.payment@daih.ng",
        firstName: "Fola",
        lastName: "Accountant",
        clientId: `DAIH-FIN-${runId}`,
        role: UserRole.FINANCE_OFFICER,
        isVerified: true,
      },
    });
    financeUserId = financeUser.id;

    const opsUser = await prisma.user.upsert({
      where: { email: "ops.payment@daih.ng" },
      update: { role: UserRole.OPERATIONS_ADMIN, isVerified: true },
      create: {
        email: "ops.payment@daih.ng",
        firstName: "Kola",
        lastName: "Operator",
        clientId: `DAIH-OPS-${runId}`,
        role: UserRole.OPERATIONS_ADMIN,
        isVerified: true,
      },
    });

    // 2. Generate Auth Tokens
    customerToken = jwt.sign(
      {
        sub: customerUserId,
        userId: customerUserId,
        email: customerUser.email,
        role: UserRole.CUSTOMER,
      },
      jwtSecret,
      { expiresIn: "1h" },
    );

    customer2Token = jwt.sign(
      {
        sub: customer2UserId,
        userId: customer2UserId,
        email: customer2.email,
        role: UserRole.CUSTOMER,
      },
      jwtSecret,
      { expiresIn: "1h" },
    );

    financeToken = jwt.sign(
      {
        sub: financeUserId,
        userId: financeUserId,
        email: financeUser.email,
        role: UserRole.FINANCE_OFFICER,
      },
      jwtSecret,
      { expiresIn: "1h" },
    );

    opsToken = jwt.sign(
      {
        sub: opsUser.id,
        userId: opsUser.id,
        email: opsUser.email,
        role: UserRole.OPERATIONS_ADMIN,
      },
      jwtSecret,
      { expiresIn: "1h" },
    );

    // 3. Setup Test Resource
    const resource = await prisma.facilityResource.upsert({
      where: { slug: "test-dedicated-suite-payments" },
      update: { isActive: true, capacity: 5 },
      create: {
        name: "Payment Test Suite",
        slug: "test-dedicated-suite-payments",
        category: ResourceCategory.OFFICE_SUITE,
        description: "Test space for payments engine validation",
        capacity: 5,
        location: "Floor 2, Wing A",
        amenities: ["High-speed Wi-Fi", "Dedicated Power", "Ergonomic Chairs"],
        isActive: true,
      },
    });
    testResourceId = resource.id;

    // 4. Setup Test Booking in HELD state
    const now = new Date();
    const startTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 4 * 60 * 60 * 1000);
    const holdExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-TEST-${Date.now()}`,
        resourceId: testResourceId,
        userId: customerUserId,
        startTime,
        endTime,
        state: BookingState.HELD,
        holdExpiresAt,
        totalAmount: 15000,
        cashDue: 15000,
        currency: "NGN",
      },
    });
    testBookingId = booking.id;
    testBookingReference = booking.reference;
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      await prisma.webhookEvent.deleteMany({});
      await prisma.invoice.deleteMany({
        where: { customerEmail: { contains: "payment@daih.ng" } },
      });
      await prisma.transaction.deleteMany({
        where: { user: { email: { contains: "payment@daih.ng" } } },
      });
      await prisma.booking.deleteMany({
        where: { user: { email: { contains: "payment@daih.ng" } } },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: "payment@daih.ng" } },
      });
      await prisma.facilityResource.deleteMany({
        where: { slug: "test-dedicated-suite-payments" },
      });
    } catch (e) {
      // Ignore cleanup error
    }
  });

  describe("1. Payment Initialization", () => {
    it("should initialize a Paystack payment session for a valid HELD booking", async () => {
      const res = await request(app)
        .post(`/api/v1/payments/initialize/${testBookingId}`)
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ callbackUrl: "http://localhost:3000/callback" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("authorization_url");
      expect(res.body.data).toHaveProperty("access_code");
      expect(res.body.data).toHaveProperty("reference");
      expect(res.body.data).toHaveProperty("transactionId");
      expect(res.body.data.amount).toBe(15000);

      testTransactionReference = res.body.data.reference;

      // Verify DB state: booking transitioned to PENDING_PAYMENT
      const booking = await prisma.booking.findUnique({
        where: { id: testBookingId },
      });
      expect(booking?.state).toBe(BookingState.PENDING_PAYMENT);

      // Verify DB state: Transaction created in PENDING status
      const tx = await prisma.transaction.findUnique({
        where: { id: res.body.data.transactionId },
      });
      expect(tx?.status).toBe(PaymentStatus.PENDING);
      expect(Number(tx?.amount)).toBe(15000);
      expect(tx?.paystackReference).toBe(testTransactionReference);
    });

    it("should reject payment initialization by an unauthorized customer", async () => {
      const res = await request(app)
        .post(`/api/v1/payments/initialize/${testBookingId}`)
        .set("Authorization", `Bearer ${customer2Token}`)
        .send({})
        .expect(403);

      expect(res.body.code).toBe("FORBIDDEN");
    });
  });

  describe("2. Paystack Webhook & Idempotent Confirmation", () => {
    const paystackEventId = Math.floor(100000000 + Math.random() * 900000000);

    it("should reject webhook request with missing signature header", async () => {
      await request(app)
        .post("/api/v1/payments/webhook")
        .send({ event: "charge.success" })
        .expect(401);
    });

    it("should reject webhook request with invalid HMAC signature", async () => {
      await request(app)
        .post("/api/v1/payments/webhook")
        .set("x-paystack-signature", "invalid-fake-signature-12345")
        .send({ event: "charge.success" })
        .expect(401);
    });

    it("should handle valid charge.success webhook, confirm booking, and generate invoice", async () => {
      await prisma.webhookEvent.deleteMany({});
      const payload = {
        event: "charge.success",
        data: {
          id: paystackEventId,
          domain: "test",
          status: "success",
          reference: testTransactionReference,
          amount: 1500000, // 15,000 NGN in kobo
          gateway_response: "Successful",
          paid_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          channel: "card",
          currency: "NGN",
          ip_address: "102.89.42.12",
          metadata: 0,
          customer: {
            id: 12345,
            first_name: "Tunde",
            last_name: "Balogun",
            email: "customer.payment@daih.ng",
            customer_code: "CUS_test_001",
          },
          authorization: {
            authorization_code: "AUTH_test123",
            bin: "539999",
            last4: "4242",
            exp_month: "12",
            exp_year: "2028",
            card_type: "mastercard DEBIT",
            bank: "Access Bank",
            country_code: "NG",
            brand: "mastercard",
            account_name: "Tunde Balogun",
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = signPaystackPayload(rawBody);

      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("x-paystack-signature", signature)
        .set("Content-Type", "application/json")
        .send(rawBody)
        .expect(200);

      expect(res.body.received).toBe(true);

      // Process queued webhook asynchronously via worker
      await webhookProcessorWorker.processPendingEvents();

      // Verify Transaction updated to SUCCESSFUL
      const tx = await prisma.transaction.findUnique({
        where: { reference: testTransactionReference },
        include: { invoice: true },
      });
      expect(tx?.status).toBe(PaymentStatus.SUCCESSFUL);
      expect(tx?.webhookEventId).toBe(String(paystackEventId));
      expect(tx?.paystackChannel).toBe("card");
      expect(tx?.paidAt).toBeDefined();

      // Verify Booking updated to CONFIRMED with QR Token
      const booking = await prisma.booking.findUnique({
        where: { id: testBookingId },
      });
      expect(booking?.state).toBe(BookingState.CONFIRMED);
      expect(booking?.qrToken).toBeDefined();
      expect(booking?.qrToken?.startsWith("daih_pass_v1.")).toBe(true);
      expect(booking?.holdExpiresAt).toBeNull();

      // Verify Invoice generated
      expect(tx?.invoice).toBeDefined();
      expect(tx?.invoice?.invoiceNumber).toMatch(/^DAIH-INV-\d{4}-\d{6}$/);
      expect(Number(tx?.invoice?.total)).toBe(15000);
      expect(tx?.invoice?.customerEmail).toBe("customer.payment@daih.ng");
    });

    it("should prove idempotency: duplicate webhook delivery produces zero duplicate state changes", async () => {
      const payload = {
        event: "charge.success",
        data: {
          id: paystackEventId, // Same event ID
          domain: "test",
          status: "success",
          reference: testTransactionReference,
          amount: 1500000,
          currency: "NGN",
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = signPaystackPayload(rawBody);

      // Send duplicate
      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("x-paystack-signature", signature)
        .set("Content-Type", "application/json")
        .send(rawBody)
        .expect(200);

      expect(res.body.received).toBe(true);
      expect(res.body.duplicate).toBe(true);

      // Count invoices for this booking: must still be exactly 1
      const invoiceCount = await prisma.invoice.count({
        where: { bookingId: testBookingId },
      });
      expect(invoiceCount).toBe(1);
    });

    it("should handle charge.failed webhook gracefully", async () => {
      await prisma.webhookEvent.deleteMany({});
      // Create a temporary booking and transaction for failed payment test
      const failedBooking = await prisma.booking.create({
        data: {
          reference: `DAIH-BK-FAIL-${Date.now()}`,
          resourceId: testResourceId,
          userId: customerUserId,
          startTime: new Date(Date.now() + 48 * 60 * 60 * 1000),
          endTime: new Date(Date.now() + 52 * 60 * 60 * 1000),
          state: BookingState.PENDING_PAYMENT,
          totalAmount: 8000,
          cashDue: 8000,
          currency: "NGN",
        },
      });

      const failedTxRef = `DAIH-PAY-FAIL-${Date.now()}`;
      await prisma.transaction.create({
        data: {
          reference: failedTxRef,
          bookingId: failedBooking.id,
          userId: customerUserId,
          amount: 8000,
          status: PaymentStatus.PENDING,
          paystackReference: failedTxRef,
        },
      });

      const payload = {
        event: "charge.failed",
        data: {
          id: 99887766,
          status: "failed",
          reference: failedTxRef,
          amount: 800000,
          currency: "NGN",
          gateway_response: "Insufficient funds",
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = signPaystackPayload(rawBody);

      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("x-paystack-signature", signature)
        .set("Content-Type", "application/json")
        .send(rawBody)
        .expect(200);

      expect(res.body.received).toBe(true);

      // Process queued webhook asynchronously via worker
      await webhookProcessorWorker.processPendingEvents();

      const updatedTx = await prisma.transaction.findUnique({
        where: { reference: failedTxRef },
      });
      expect(updatedTx?.status).toBe(PaymentStatus.FAILED);
      expect(updatedTx?.failedAt).toBeDefined();

      // Booking remains PENDING_PAYMENT until hold expires
      const updatedBooking = await prisma.booking.findUnique({
        where: { id: failedBooking.id },
      });
      expect(updatedBooking?.state).toBe(BookingState.PENDING_PAYMENT);
    });

    it("should not confirm a booking from a signed charge.success webhook that Paystack does not confirm", async () => {
      await prisma.webhookEvent.deleteMany({});
      const unverifiedBooking = await prisma.booking.create({
        data: {
          reference: `DAIH-BK-UNVERIFIED-${Date.now()}`,
          resourceId: testResourceId,
          userId: customerUserId,
          startTime: new Date(Date.now() + 96 * 60 * 60 * 1000),
          endTime: new Date(Date.now() + 100 * 60 * 60 * 1000),
          state: BookingState.PENDING_PAYMENT,
          holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
          totalAmount: 15000,
          cashDue: 15000,
          currency: "NGN",
        },
      });

      const unverifiedTxRef = `DAIH-PAY-UNVERIFIED-${Date.now()}`;
      await prisma.transaction.create({
        data: {
          reference: unverifiedTxRef,
          bookingId: unverifiedBooking.id,
          userId: customerUserId,
          amount: 15000,
          status: PaymentStatus.PENDING,
          paystackReference: unverifiedTxRef,
        },
      });

      // The webhook is correctly signed, but Paystack has no such charge.
      const verifySpy = vi
        .spyOn(paystackClient, "verifyTransaction")
        .mockResolvedValueOnce(null);

      const payload = {
        event: "charge.success",
        data: {
          id: Math.floor(10000000 + Math.random() * 90000000),
          status: "success",
          reference: unverifiedTxRef,
          amount: 1500000,
          currency: "NGN",
        },
      };
      const rawBody = JSON.stringify(payload);

      await request(app)
        .post("/api/v1/payments/webhook")
        .set("x-paystack-signature", signPaystackPayload(rawBody))
        .set("Content-Type", "application/json")
        .send(rawBody)
        .expect(200);

      await webhookProcessorWorker.processPendingEvents();

      expect(verifySpy).toHaveBeenCalledWith(unverifiedTxRef, 1500000);
      verifySpy.mockRestore();

      const tx = await prisma.transaction.findFirst({
        where: { reference: unverifiedTxRef },
      });
      expect(tx?.status).toBe(PaymentStatus.PENDING);

      const booking = await prisma.booking.findUnique({
        where: { id: unverifiedBooking.id },
      });
      expect(booking?.state).toBe(BookingState.PENDING_PAYMENT);
      expect(booking?.qrToken).toBeNull();
    });
  });

  describe("3. Payment Verification & Polling", () => {
    it("should allow customer to fetch transaction details and status", async () => {
      const tx = await prisma.transaction.findUnique({
        where: { reference: testTransactionReference },
      });

      const res = await request(app)
        .get(`/api/v1/payments/${tx?.id}`)
        .set("Authorization", `Bearer ${customerToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.reference).toBe(testTransactionReference);
      expect(res.body.data.status).toBe(PaymentStatus.SUCCESSFUL);
      expect(res.body.data.booking).toBeDefined();
    });

    it("should allow customer to download/view structured invoice", async () => {
      const tx = await prisma.transaction.findUnique({
        where: { reference: testTransactionReference },
      });

      const res = await request(app)
        .get(`/api/v1/payments/${tx?.id}/invoice`)
        .set("Authorization", `Bearer ${customerToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.invoiceNumber).toMatch(/^DAIH-INV-\d{4}-\d{6}$/);
      expect(res.body.data.total).toBe(15000);
      expect(res.body.data.lineItems.length).toBeGreaterThan(0);
    });

    it("should return customer's payment history", async () => {
      const res = await request(app)
        .get("/api/v1/payments/history")
        .set("Authorization", `Bearer ${customerToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("4. No-Refund Policy Enforcement & Late Payment Capacity Conflicts", () => {
    it("should return 404 as refund request routes are removed from the system", async () => {
      await request(app)
        .post(`/api/v1/payments/bookings/${testBookingId}/refund-request`)
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ reason: "Scheduling conflict" })
        .expect(404);
    });

    it("should return 404 as legacy direct refund processing routes are removed from the system", async () => {
      const tx = await prisma.transaction.findFirst({
        where: { paystackReference: testTransactionReference },
      });

      await request(app)
        .post(`/api/v1/payments/${tx?.id || "mock-tx-id"}/refund`)
        .set("Authorization", `Bearer ${financeToken}`)
        .send({
          amount: 15000,
          reason: "Approved per cancellation policy",
        })
        .expect(404);
    });

    it("should handle late webhook arrival on expired slot when slot is re-booked: marks transaction REQUIRES_RECONCILIATION and initiates UNAVAILABLE_RESOURCE system refund", async () => {
      await prisma.webhookEvent.deleteMany({});
      // Set resource capacity to 1 for this test
      await prisma.facilityResource.update({
        where: { id: testResourceId },
        data: { capacity: 1 },
      });

      // 1. Create User A's expired booking
      const userABooking = await prisma.booking.create({
        data: {
          reference: `DAIH-BK-EXPIRE-${Date.now()}`,
          resourceId: testResourceId,
          userId: customerUserId,
          startTime: new Date(Date.now() + 72 * 60 * 60 * 1000),
          endTime: new Date(Date.now() + 76 * 60 * 60 * 1000),
          state: BookingState.EXPIRED,
          totalAmount: 15000,
          cashDue: 15000,
          currency: "NGN",
        },
      });

      const userATxRef = `DAIH-PAY-LATE-${Date.now()}`;
      await prisma.transaction.create({
        data: {
          reference: userATxRef,
          bookingId: userABooking.id,
          userId: customerUserId,
          amount: 15000,
          status: PaymentStatus.PENDING,
          paystackReference: userATxRef,
        },
      });

      // 2. User B books and confirms the exact same slot (capacity is 1)
      const userBBooking = await prisma.booking.create({
        data: {
          reference: `DAIH-BK-OCCUPIED-${Date.now()}`,
          resourceId: testResourceId,
          userId: customer2UserId,
          startTime: new Date(Date.now() + 72 * 60 * 60 * 1000),
          endTime: new Date(Date.now() + 76 * 60 * 60 * 1000),
          state: BookingState.CONFIRMED,
          totalAmount: 15000,
          cashDue: 15000,
          currency: "NGN",
        },
      });

      // 3. Late webhook arrives for User A's transaction
      const payload = {
        event: "charge.success",
        data: {
          id: Math.floor(1000000 + Math.random() * 9000000),
          status: "success",
          reference: userATxRef,
          amount: 1500000,
          currency: "NGN",
          gateway_response: "Successful",
          channel: "card",
          customer: {
            email: "tunde@example.com",
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = signPaystackPayload(rawBody);

      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("x-paystack-signature", signature)
        .set("Content-Type", "application/json")
        .send(rawBody)
        .expect(200);

      expect(res.body.received).toBe(true);

      // Process queued webhook asynchronously via worker
      await webhookProcessorWorker.processPendingEvents();

      // User A's transaction is marked REQUIRES_RECONCILIATION because capacity is claimed
      const updatedTx = await prisma.transaction.findFirst({
        where: { paystackReference: userATxRef },
      });
      expect(updatedTx?.status).toBe(PaymentStatus.REQUIRES_RECONCILIATION);

      // System refund request is automatically spawned for UNAVAILABLE_RESOURCE
      const spawnedRefund = await prisma.refundRequest.findFirst({
        where: { transactionId: updatedTx?.id },
      });
      expect(spawnedRefund).toBeDefined();
      expect(spawnedRefund?.reasonCode).toBe(
        RefundReasonCode.UNAVAILABLE_RESOURCE,
      );

      // User B's booking remains intact and CONFIRMED
      const updatedBookingB = await prisma.booking.findUnique({
        where: { id: userBBooking.id },
      });
      expect(updatedBookingB?.state).toBe(BookingState.CONFIRMED);

      // Verify AuditLog was recorded for CAPACITY_CONFLICT
      const conflictAudit = await prisma.auditLog.findFirst({
        where: {
          entityId: userABooking.id,
          action: "LATE_PAYMENT_CAPACITY_CONFLICT",
        },
      });
      expect(conflictAudit).toBeDefined();

      // Reset resource capacity
      await prisma.facilityResource.update({
        where: { id: testResourceId },
        data: { capacity: 5 },
      });
    });
  });

  describe("5. Finance Officer Reconciliation & Dashboards", () => {
    it("should allow Finance Officer to list all admin transactions with pagination", async () => {
      const res = await request(app)
        .get("/api/v1/payments/admin/transactions?limit=10&page=1")
        .set("Authorization", `Bearer ${financeToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it("should generate reconciliation overview with collections, refunds, and net revenue", async () => {
      const res = await request(app)
        .get("/api/v1/payments/admin/reconciliation")
        .set("Authorization", `Bearer ${financeToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("totalLocalTransactions");
      expect(res.body.data).toHaveProperty("totalCollected");
      expect(res.body.data).toHaveProperty("totalRefunded");
      expect(res.body.data).toHaveProperty("netRevenue");
      expect(res.body.data.currency).toBe("NGN");
    });

    it("should generate daily summary for finance dashboard", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await request(app)
        .get(`/api/v1/payments/admin/daily-summary?date=${today}`)
        .set("Authorization", `Bearer ${financeToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.date).toBe(today);
      expect(res.body.data).toHaveProperty("successfulCount");
      expect(res.body.data).toHaveProperty("refundedCount");
      expect(res.body.data).toHaveProperty("netRevenue");
    });
  });
});

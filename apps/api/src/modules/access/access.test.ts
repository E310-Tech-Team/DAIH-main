import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../app.js";
import { prisma } from "../../db/client.js";
import { config } from "../../config/env.js";
import {
  UserRole,
  BookingState,
  ResourceCategory,
  AccessRejectionReason,
} from "@daih/types";
import {
  generateSignedQrToken,
  verifyAndParseQrToken,
} from "./qr-token.util.js";

describe("Milestone 1.5: QR & Reception Module", () => {
  let customerToken: string;
  let customer2Token: string;
  let receptionToken: string;
  let securityToken: string;
  let opsToken: string;

  let customerUserId: string;
  let customer2UserId: string;
  let receptionUserId: string;
  let securityUserId: string;

  let testResourceId: string;
  let activeBookingId: string;
  let activeBookingRef: string;
  let activeBookingQrToken: string;

  const jwtSecret = config.jwt.secret || "dev-secret-key-12345678901234567890";

  beforeAll(async () => {
    // 0. Pre-clean test data
    try {
      await prisma.visitSession.deleteMany({
        where: { user: { email: { contains: "access.test@daih.ng" } } },
      });
      await prisma.booking.deleteMany({
        where: { user: { email: { contains: "access.test@daih.ng" } } },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: "access.test@daih.ng" } },
      });
    } catch {}

    // 1. Setup Test Users
    const customer = await prisma.user.upsert({
      where: { email: "customer.access.test@daih.ng" },
      update: {
        role: UserRole.CUSTOMER,
        isVerified: true,
        firstName: "Tunde",
        lastName: "Adeleke",
        clientId: "DAIH-2026-ACC001",
      },
      create: {
        email: "customer.access.test@daih.ng",
        firstName: "Tunde",
        lastName: "Adeleke",
        clientId: "DAIH-2026-ACC001",
        role: UserRole.CUSTOMER,
        isVerified: true,
      },
    });
    customerUserId = customer.id;

    const customer2 = await prisma.user.upsert({
      where: { email: "customer2.access.test@daih.ng" },
      update: {
        role: UserRole.CUSTOMER,
        isVerified: true,
        firstName: "Chioma",
        lastName: "Okafor",
        clientId: "DAIH-2026-ACC002",
      },
      create: {
        email: "customer2.access.test@daih.ng",
        firstName: "Chioma",
        lastName: "Okafor",
        clientId: "DAIH-2026-ACC002",
        role: UserRole.CUSTOMER,
        isVerified: true,
      },
    });
    customer2UserId = customer2.id;

    const reception = await prisma.user.upsert({
      where: { email: "reception.access.test@daih.ng" },
      update: {
        role: UserRole.RECEPTION_OFFICER,
        isVerified: true,
        firstName: "Amara",
        lastName: "FrontDesk",
        clientId: "DAIH-2026-REC001",
      },
      create: {
        email: "reception.access.test@daih.ng",
        firstName: "Amara",
        lastName: "FrontDesk",
        clientId: "DAIH-2026-REC001",
        role: UserRole.RECEPTION_OFFICER,
        isVerified: true,
      },
    });
    receptionUserId = reception.id;

    const security = await prisma.user.upsert({
      where: { email: "security.access.test@daih.ng" },
      update: {
        role: UserRole.SECURITY_OFFICER,
        isVerified: true,
        firstName: "Ibrahim",
        lastName: "GateOfficer",
        clientId: "DAIH-2026-SEC001",
      },
      create: {
        email: "security.access.test@daih.ng",
        firstName: "Ibrahim",
        lastName: "GateOfficer",
        clientId: "DAIH-2026-SEC001",
        role: UserRole.SECURITY_OFFICER,
        isVerified: true,
      },
    });
    securityUserId = security.id;

    const opsAdmin = await prisma.user.upsert({
      where: { email: "ops.access.test@daih.ng" },
      update: {
        role: UserRole.OPERATIONS_ADMIN,
        isVerified: true,
        firstName: "Sola",
        lastName: "Operations",
        clientId: "DAIH-2026-OPS001",
      },
      create: {
        email: "ops.access.test@daih.ng",
        firstName: "Sola",
        lastName: "Operations",
        clientId: "DAIH-2026-OPS001",
        role: UserRole.OPERATIONS_ADMIN,
        isVerified: true,
      },
    });

    // Generate JWT Tokens
    customerToken = jwt.sign(
      { sub: customer.id, role: UserRole.CUSTOMER, email: customer.email },
      jwtSecret,
      { expiresIn: "1h" },
    );

    customer2Token = jwt.sign(
      { sub: customer2.id, role: UserRole.CUSTOMER, email: customer2.email },
      jwtSecret,
      { expiresIn: "1h" },
    );

    receptionToken = jwt.sign(
      {
        sub: reception.id,
        role: UserRole.RECEPTION_OFFICER,
        email: reception.email,
      },
      jwtSecret,
      { expiresIn: "1h" },
    );

    securityToken = jwt.sign(
      {
        sub: security.id,
        role: UserRole.SECURITY_OFFICER,
        email: security.email,
      },
      jwtSecret,
      { expiresIn: "1h" },
    );

    opsToken = jwt.sign(
      {
        sub: opsAdmin.id,
        role: UserRole.OPERATIONS_ADMIN,
        email: opsAdmin.email,
      },
      jwtSecret,
      { expiresIn: "1h" },
    );

    // 2. Setup Test Facility Resource
    const resource = await prisma.facilityResource.upsert({
      where: { slug: "dedicated-desk-pod-access-test" },
      update: {
        name: "Dedicated Pod - Terminal Test",
        category: ResourceCategory.HOT_DESK,
        capacity: 10,
        isActive: true,
      },
      create: {
        name: "Dedicated Pod - Terminal Test",
        slug: "dedicated-desk-pod-access-test",
        category: ResourceCategory.HOT_DESK,
        description: "Test hot desk for QR and reception verification",
        capacity: 10,
        location: "Ground Floor",
        amenities: ["High-speed Wi-Fi", "Ergonomic Chair"],
        isActive: true,
      },
    });
    testResourceId = resource.id;

    // 3. Create a valid active confirmed booking (scheduled now to +8 hours)
    const now = new Date();
    const start = new Date(now.getTime() - 10 * 60 * 1000); // started 10 mins ago
    const end = new Date(now.getTime() + 8 * 60 * 60 * 1000); // ends in 8 hours

    activeBookingRef = `DAIH-BK-ACC${Date.now().toString().slice(-6)}`;
    const tempId = `bk_acc_${Date.now()}`;
    activeBookingQrToken = generateSignedQrToken({
      bookingId: tempId,
      reference: activeBookingRef,
      userId: customerUserId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      issuedAt: Date.now(),
    });

    const activeBooking = await prisma.booking.create({
      data: {
        id: tempId,
        reference: activeBookingRef,
        resourceId: testResourceId,
        userId: customerUserId,
        startTime: start,
        endTime: end,
        state: BookingState.CONFIRMED,
        totalAmount: 7500,
        currency: "NGN",
        qrToken: activeBookingQrToken,
      },
    });
    activeBookingId = activeBooking.id;
  });

  afterAll(async () => {
    try {
      await prisma.visitSession.deleteMany({
        where: { user: { email: { contains: "access.test@daih.ng" } } },
      });
      await prisma.booking.deleteMany({
        where: { user: { email: { contains: "access.test@daih.ng" } } },
      });
      await prisma.user.deleteMany({
        where: { email: { contains: "access.test@daih.ng" } },
      });
    } catch {}
  });

  describe("1. Cryptographic HMAC Token Signing & Verification", () => {
    it("generates and verifies valid HMAC-SHA256 signed QR pass", () => {
      const payload = {
        bookingId: "bk_test_123",
        reference: "DAIH-BK-12345",
        userId: customerUserId,
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString(),
        issuedAt: Date.now(),
      };

      const signedToken = generateSignedQrToken(payload);
      expect(signedToken.startsWith("daih_pass_v1.")).toBe(true);

      const parsed = verifyAndParseQrToken(signedToken);
      expect(parsed.valid).toBe(true);
      expect(parsed.payload?.bookingId).toBe("bk_test_123");
      expect(parsed.payload?.reference).toBe("DAIH-BK-12345");
    });

    it("rejects tampered or forged token signatures", () => {
      const payload = {
        bookingId: "bk_test_123",
        reference: "DAIH-BK-12345",
        userId: customerUserId,
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString(),
        issuedAt: Date.now(),
      };

      const signedToken = generateSignedQrToken(payload);
      // Tamper with signature
      const tamperedToken = `${signedToken.slice(0, -4)}XXXX`;

      const parsed = verifyAndParseQrToken(tamperedToken);
      expect(parsed.valid).toBe(false);
      expect(parsed.error).toBe("INVALID_SIGNATURE");
    });
  });

  describe("2. Access Pass Retrieval (GET /api/v1/access/qr/:bookingId)", () => {
    it("allows booking owner to retrieve their signed access pass", async () => {
      const res = await request(app)
        .get(`/api/v1/access/qr/${activeBookingId}`)
        .set("Authorization", `Bearer ${customerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reference).toBe(activeBookingRef);
      expect(res.body.data.token).toBe(activeBookingQrToken);
    });

    it("blocks other customers from viewing someone else's access pass", async () => {
      const res = await request(app)
        .get(`/api/v1/access/qr/${activeBookingId}`)
        .set("Authorization", `Bearer ${customer2Token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    });

    it("blocks reception officers from fetching customer's raw access pass (must use verify-qr scanner)", async () => {
      const res = await request(app)
        .get(`/api/v1/access/qr/${activeBookingId}`)
        .set("Authorization", `Bearer ${receptionToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    });
  });

  describe("3. Verification Rejection Matrix (POST /api/v1/access/verify-qr)", () => {
    it("verifies valid confirmed pass within scheduled time window", async () => {
      const res = await request(app)
        .post("/api/v1/access/verify-qr")
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ token: activeBookingQrToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.canCheckIn).toBe(true);
      expect(res.body.data.canCheckOut).toBe(false);
      expect(res.body.data.booking.reference).toBe(activeBookingRef);
    });

    it("rejects early scan attempts before startTime (TOO_EARLY)", async () => {
      const futureStart = new Date(Date.now() + 3 * 3600 * 1000); // 3 hours from now
      const futureEnd = new Date(Date.now() + 9 * 3600 * 1000);
      const ref = `DAIH-BK-EARLY${Date.now().toString().slice(-4)}`;
      const earlyId = `bk_early_${Date.now()}`;
      const earlyToken = generateSignedQrToken({
        bookingId: earlyId,
        reference: ref,
        userId: customerUserId,
        startTime: futureStart.toISOString(),
        endTime: futureEnd.toISOString(),
        issuedAt: Date.now(),
      });

      await prisma.booking.create({
        data: {
          id: earlyId,
          reference: ref,
          resourceId: testResourceId,
          userId: customerUserId,
          startTime: futureStart,
          endTime: futureEnd,
          state: BookingState.CONFIRMED,
          totalAmount: 5000,
          qrToken: earlyToken,
        },
      });

      const res = await request(app)
        .post("/api/v1/access/verify-qr")
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ token: earlyToken });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
      expect(res.body.data.rejectionReason).toBe(
        AccessRejectionReason.TOO_EARLY,
      );
      expect(res.body.data.canCheckIn).toBe(false);
      expect(res.body.data.rejectionDetails.scheduledStartTime).toBeDefined();
    });

    it("rejects expired and unredeemed pass with audit proof (NO_SHOW)", async () => {
      const pastStart = new Date(Date.now() - 5 * 3600 * 1000);
      const pastEnd = new Date(Date.now() - 1 * 3600 * 1000); // ended 1 hour ago
      const ref = `DAIH-BK-NOSHOW${Date.now().toString().slice(-4)}`;
      const noShowId = `bk_noshow_${Date.now()}`;
      const noShowToken = generateSignedQrToken({
        bookingId: noShowId,
        reference: ref,
        userId: customerUserId,
        startTime: pastStart.toISOString(),
        endTime: pastEnd.toISOString(),
        issuedAt: Date.now(),
      });

      await prisma.booking.create({
        data: {
          id: noShowId,
          reference: ref,
          resourceId: testResourceId,
          userId: customerUserId,
          startTime: pastStart,
          endTime: pastEnd,
          state: BookingState.CONFIRMED,
          checkedInAt: null, // never redeemed
          totalAmount: 5000,
          qrToken: noShowToken,
        },
      });

      const res = await request(app)
        .post("/api/v1/access/verify-qr")
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ token: noShowToken });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
      expect(res.body.data.rejectionReason).toBe(AccessRejectionReason.NO_SHOW);
      expect(res.body.data.rejectionDetails.auditProof).toBeDefined();
      expect(res.body.data.rejectionDetails.auditProof.bookingReference).toBe(
        ref,
      );
      expect(res.body.data.rejectionDetails.adminRescheduleAvailable).toBe(
        true,
      );
    });

    it("rejects cancelled bookings (CANCELLED)", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 10 * 60 * 1000);
      const end = new Date(now.getTime() + 4 * 3600 * 1000);
      const ref = `DAIH-BK-CANC${Date.now().toString().slice(-4)}`;
      const cancId = `bk_canc_${Date.now()}`;
      const cancToken = generateSignedQrToken({
        bookingId: cancId,
        reference: ref,
        userId: customerUserId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        issuedAt: Date.now(),
      });

      await prisma.booking.create({
        data: {
          id: cancId,
          reference: ref,
          resourceId: testResourceId,
          userId: customerUserId,
          startTime: start,
          endTime: end,
          state: BookingState.CANCELLED,
          totalAmount: 5000,
          qrToken: cancToken,
        },
      });

      const res = await request(app)
        .post("/api/v1/access/verify-qr")
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ token: cancToken });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
      expect(res.body.data.rejectionReason).toBe(
        AccessRejectionReason.CANCELLED,
      );
    });

    it("rejects unpaid or held bookings (UNPAID)", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 10 * 60 * 1000);
      const end = new Date(now.getTime() + 4 * 3600 * 1000);
      const ref = `DAIH-BK-HELD${Date.now().toString().slice(-4)}`;
      const heldId = `bk_held_${Date.now()}`;

      await prisma.booking.create({
        data: {
          id: heldId,
          reference: ref,
          resourceId: testResourceId,
          userId: customerUserId,
          startTime: start,
          endTime: end,
          state: BookingState.HELD,
          totalAmount: 5000,
        },
      });

      const res = await request(app)
        .post("/api/v1/access/verify-qr")
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ token: ref });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
      expect(res.body.data.rejectionReason).toBe(AccessRejectionReason.UNPAID);
    });
  });

  describe("4. Check-In, Check-Out & Same-Day Re-Entry Flow", () => {
    it("successfully checks in a confirmed member at reception", async () => {
      const res = await request(app)
        .post(`/api/v1/access/checkin/${activeBookingId}`)
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ terminalId: "REC-GATE-01", notes: "Arrival test" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.action).toBe("CHECKED_IN");
      expect(res.body.data.isReEntry).toBe(false);
      expect(res.body.data.visitSession).toBeDefined();
      expect(res.body.data.visitSession.terminalId).toBe("REC-GATE-01");
      expect(res.body.data.wifiCredentials).toBeDefined();
      expect(res.body.data.wifiCredentials.ssid).toBe("DAIH-Member-HighSpeed");
      expect(res.body.data.wifiCredentials.pin).toBeDefined();

      // Verify DB update
      const updated = await prisma.booking.findUnique({
        where: { id: activeBookingId },
      });
      expect(updated?.state).toBe(BookingState.CHECKED_IN);
      expect(updated?.checkedInAt).toBeDefined();

      // Verify VisitSession record in DB
      const vs = await prisma.visitSession.findFirst({
        where: { bookingId: activeBookingId, checkOutTime: null },
      });
      expect(vs).toBeDefined();
      expect(vs?.terminalId).toBe("REC-GATE-01");
    });

    it("prevents double check-in for an already checked-in member", async () => {
      const res = await request(app)
        .post(`/api/v1/access/checkin/${activeBookingId}`)
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ terminalId: "REC-GATE-01" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("ALREADY_CHECKED_IN");
    });

    it("processes mid-day check-out while keeping Wi-Fi valid through endTime", async () => {
      const res = await request(app)
        .post(`/api/v1/access/checkout/${activeBookingId}`)
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ terminalId: "REC-GATE-01", notes: "Stepped out for lunch" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.action).toBe("CHECKED_OUT");
      expect(res.body.data.wifiStatus).toBe("CONTINUOUS_ACTIVE_UNTIL_END_TIME");
      expect(res.body.data.visitSession.checkOutTime).toBeDefined();

      // Verify DB update
      const updated = await prisma.booking.findUnique({
        where: { id: activeBookingId },
      });
      expect(updated?.state).toBe(BookingState.CHECKED_OUT);
      expect(updated?.checkedOutAt).toBeDefined();
    });

    it("allows same-day re-entry (Re-Check In) before endTime", async () => {
      // 1. Verify scan recognizes member return
      const verifyRes = await request(app)
        .post("/api/v1/access/verify-qr")
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ token: activeBookingQrToken });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.valid).toBe(true);
      expect(verifyRes.body.data.canCheckIn).toBe(true);
      expect(verifyRes.body.data.isReEntry).toBe(true);

      // 2. Perform Re-Check In
      const reCheckInRes = await request(app)
        .post(`/api/v1/access/checkin/${activeBookingId}`)
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ terminalId: "REC-GATE-01", notes: "Returned from lunch" });

      expect(reCheckInRes.status).toBe(200);
      expect(reCheckInRes.body.data.action).toBe("CHECKED_IN");
      expect(reCheckInRes.body.data.isReEntry).toBe(true);

      // Verify DB has 2 distinct visit sessions
      const sessions = await prisma.visitSession.findMany({
        where: { bookingId: activeBookingId },
      });
      expect(sessions.length).toBe(2);
    });
  });

  describe("5. RBAC & Route Access Enforcement", () => {
    it("blocks customers from accessing reception scanner endpoints", async () => {
      const res = await request(app)
        .post("/api/v1/access/verify-qr")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ token: activeBookingQrToken });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    });

    it("allows Security Officers to verify and scan passes at gates", async () => {
      const res = await request(app)
        .post("/api/v1/access/verify-qr")
        .set("Authorization", `Bearer ${securityToken}`)
        .send({ token: activeBookingQrToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("6. Telemetry: Activity Feed & Live Occupancy", () => {
    it("returns terminal activity logs", async () => {
      const res = await request(app)
        .get("/api/v1/access/activity")
        .set("Authorization", `Bearer ${receptionToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].bookingReference).toBeDefined();
    });

    it("returns live workspace occupancy matching checked-in members", async () => {
      const res = await request(app)
        .get("/api/v1/access/occupancy")
        .set("Authorization", `Bearer ${opsToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalCapacity).toBeGreaterThan(0);
      expect(res.body.data.totalCheckedIn).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.data.resources)).toBe(true);
    });
  });

  describe("7. Wi-Fi Daily Lifecycle & Refresh on Daily Check-In", () => {
    let multiDayBookingId: string;
    let multiDayToken: string;

    beforeAll(async () => {
      const start = new Date();
      start.setHours(start.getHours() - 1);
      const end = new Date(start);
      end.setDate(end.getDate() + 7); // 7-day pass

      const booking = await prisma.booking.create({
        data: {
          reference: `DAIH-BK-MULTI${Date.now().toString().slice(-6)}`,
          resourceId: testResourceId,
          userId: customerUserId,
          startTime: start,
          endTime: end,
          state: BookingState.CONFIRMED,
          totalAmount: 35000,
          currency: "NGN",
        },
      });
      multiDayBookingId = booking.id;
      multiDayToken = generateSignedQrToken({
        bookingId: booking.id,
        reference: booking.reference,
        userId: customerUserId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        issuedAt: Date.now(),
      });
      await prisma.booking.update({
        where: { id: booking.id },
        data: { qrToken: multiDayToken },
      });
    });

    it("locks Wi-Fi before check-in on the first day", async () => {
      const res = await request(app)
        .post("/api/v1/access/verify-qr")
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ token: multiDayToken });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.canCheckIn).toBe(true);
      expect(res.body.data.booking.checkedInToday).toBe(false);
      expect(res.body.data.booking.wifiStatus).toBe(
        "LOCKED_PENDING_DAILY_CHECKIN",
      );
      expect(res.body.data.booking.wifiCredentials).toBeNull();
    });

    it("refreshes and unlocks Wi-Fi upon check-in today with end-of-day expiration", async () => {
      const checkInRes = await request(app)
        .post(`/api/v1/access/checkin/${multiDayBookingId}`)
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ terminalId: "REC-GATE-01" });

      expect(checkInRes.status).toBe(200);
      expect(checkInRes.body.data.action).toBe("CHECKED_IN");
      expect(checkInRes.body.data.wifiCredentials).toBeDefined();
      expect(checkInRes.body.data.wifiCredentials.ssid).toBe(
        "DAIH-Member-HighSpeed",
      );
      expect(checkInRes.body.data.wifiCredentials.pin).toBeDefined();
      expect(checkInRes.body.data.wifiCredentials.status).toBe("ACTIVE");

      // Verify validUntil is end of today
      const validUntil = new Date(
        checkInRes.body.data.wifiCredentials.validUntil,
      );
      const now = new Date();
      expect(validUntil.toDateString()).toBe(now.toDateString());
      expect(validUntil.getHours()).toBe(23);
      expect(validUntil.getMinutes()).toBe(59);
    });

    it("locks Wi-Fi when queried as next day before next-day check-in", async () => {
      // Move visit session and checkedInAt to yesterday in database
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      await prisma.visitSession.updateMany({
        where: { bookingId: multiDayBookingId },
        data: { checkInTime: yesterday, checkOutTime: yesterday },
      });
      await prisma.booking.update({
        where: { id: multiDayBookingId },
        data: {
          checkedInAt: yesterday,
          checkedOutAt: yesterday,
          state: BookingState.CHECKED_OUT,
        },
      });

      // Pass verification recognizes that today's check-in is required
      const verifyRes = await request(app)
        .post("/api/v1/access/verify-qr")
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ token: multiDayToken });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.valid).toBe(true);
      expect(verifyRes.body.data.canCheckIn).toBe(true);
      expect(verifyRes.body.data.booking.checkedInToday).toBe(false);
      expect(verifyRes.body.data.booking.wifiStatus).toBe(
        "LOCKED_PENDING_DAILY_CHECKIN",
      );
      expect(verifyRes.body.data.booking.wifiCredentials).toBeNull();
    });

    it("refreshes and unlocks fresh daily Wi-Fi credentials on next-day check-in", async () => {
      const nextDayCheckInRes = await request(app)
        .post(`/api/v1/access/checkin/${multiDayBookingId}`)
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ terminalId: "REC-GATE-01", notes: "Day 2 check-in" });

      expect(nextDayCheckInRes.status).toBe(200);
      expect(nextDayCheckInRes.body.data.action).toBe("CHECKED_IN");
      expect(nextDayCheckInRes.body.data.wifiCredentials).toBeDefined();
      expect(nextDayCheckInRes.body.data.wifiCredentials.status).toBe("ACTIVE");

      // Verify validUntil is today
      const validUntil = new Date(
        nextDayCheckInRes.body.data.wifiCredentials.validUntil,
      );
      const now = new Date();
      expect(validUntil.toDateString()).toBe(now.toDateString());
    });

    it("permanently locks Wi-Fi once subscription ends", async () => {
      // Set booking end time to the past
      const past = new Date();
      past.setHours(past.getHours() - 2);
      const pastStart = new Date(past);
      pastStart.setDate(pastStart.getDate() - 2);

      const expiredBooking = await prisma.booking.create({
        data: {
          reference: `DAIH-BK-EXP${Date.now().toString().slice(-6)}`,
          resourceId: testResourceId,
          userId: customerUserId,
          startTime: pastStart,
          endTime: past,
          state: BookingState.COMPLETED,
          totalAmount: 15000,
          currency: "NGN",
        },
      });

      const expToken = generateSignedQrToken({
        bookingId: expiredBooking.id,
        reference: expiredBooking.reference,
        userId: customerUserId,
        startTime: pastStart.toISOString(),
        endTime: past.toISOString(),
        issuedAt: Date.now(),
      });

      const verifyRes = await request(app)
        .post("/api/v1/access/verify-qr")
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ token: expToken });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.valid).toBe(false);
      expect(verifyRes.body.data.booking?.wifiCredentials).toBeFalsy();
    });
  });

  describe("8. Multi-Day Pass Scheduled Daily Slot Window Enforcement", () => {
    it("blocks check-in after today's scheduled slot has passed even though booking has not expired", async () => {
      const now = new Date();
      // Slot ended 1 hour ago today, started 3 hours ago today
      const pastSlotEnd = new Date(now);
      pastSlotEnd.setHours(now.getHours() - 1);
      const pastSlotStart = new Date(now);
      pastSlotStart.setHours(now.getHours() - 3);

      // Multi-day booking spanning pastSlotStart (2 days ago) to pastSlotEnd (5 days later)
      const testMultiStart = new Date(now);
      testMultiStart.setDate(testMultiStart.getDate() - 2);
      testMultiStart.setHours(
        pastSlotStart.getHours(),
        pastSlotStart.getMinutes(),
        0,
        0,
      );

      const testMultiEnd = new Date(now);
      testMultiEnd.setDate(testMultiEnd.getDate() + 5);
      testMultiEnd.setHours(
        pastSlotEnd.getHours(),
        pastSlotEnd.getMinutes(),
        0,
        0,
      );

      const endedSlotBooking = await prisma.booking.create({
        data: {
          reference: `DAIH-BK-SLOTEND${Date.now().toString().slice(-6)}`,
          resourceId: testResourceId,
          userId: customerUserId,
          startTime: testMultiStart,
          endTime: testMultiEnd,
          state: BookingState.CONFIRMED,
          totalAmount: 40000,
          currency: "NGN",
        },
      });

      const endedSlotToken = generateSignedQrToken({
        bookingId: endedSlotBooking.id,
        reference: endedSlotBooking.reference,
        userId: customerUserId,
        startTime: testMultiStart.toISOString(),
        endTime: testMultiEnd.toISOString(),
        issuedAt: Date.now(),
      });
      await prisma.booking.update({
        where: { id: endedSlotBooking.id },
        data: { qrToken: endedSlotToken },
      });

      // Verification should reject because today's slot ended
      const verifyRes = await request(app)
        .post("/api/v1/access/verify-qr")
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ token: endedSlotToken });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.valid).toBe(false);
      expect(verifyRes.body.data.canCheckIn).toBe(false);
      expect(verifyRes.body.data.rejectionTitle).toBe("Daily Slot Concluded");
      expect(verifyRes.body.data.rejectionReason).toBe("EXPIRED");

      // Check-In endpoint should also reject with 400 EXPIRED
      const checkInRes = await request(app)
        .post(`/api/v1/access/checkin/${endedSlotBooking.id}`)
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ terminalId: "REC-GATE-01" });

      expect(checkInRes.status).toBe(400);
      expect(checkInRes.body.code).toBe("EXPIRED");
      expect(checkInRes.body.message).toContain("concluded");
    });

    it("blocks check-in before today's scheduled slot opens on an active multi-day pass", async () => {
      const now = new Date();
      // Slot opens 2 hours from now and closes 4 hours from now
      const futureSlotStart = new Date(now);
      futureSlotStart.setHours(now.getHours() + 2);
      const futureSlotEnd = new Date(now);
      futureSlotEnd.setHours(now.getHours() + 4);

      const testMultiStart = new Date(now);
      testMultiStart.setDate(testMultiStart.getDate() - 2);
      testMultiStart.setHours(
        futureSlotStart.getHours(),
        futureSlotStart.getMinutes(),
        0,
        0,
      );

      const testMultiEnd = new Date(now);
      testMultiEnd.setDate(testMultiEnd.getDate() + 5);
      testMultiEnd.setHours(
        futureSlotEnd.getHours(),
        futureSlotEnd.getMinutes(),
        0,
        0,
      );

      const earlySlotBooking = await prisma.booking.create({
        data: {
          reference: `DAIH-BK-SLOTEARLY${Date.now().toString().slice(-6)}`,
          resourceId: testResourceId,
          userId: customerUserId,
          startTime: testMultiStart,
          endTime: testMultiEnd,
          state: BookingState.CONFIRMED,
          totalAmount: 40000,
          currency: "NGN",
        },
      });

      const earlySlotToken = generateSignedQrToken({
        bookingId: earlySlotBooking.id,
        reference: earlySlotBooking.reference,
        userId: customerUserId,
        startTime: testMultiStart.toISOString(),
        endTime: testMultiEnd.toISOString(),
        issuedAt: Date.now(),
      });
      await prisma.booking.update({
        where: { id: earlySlotBooking.id },
        data: { qrToken: earlySlotToken },
      });

      // Verification should reject as TOO_EARLY for today's slot
      const verifyRes = await request(app)
        .post("/api/v1/access/verify-qr")
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ token: earlySlotToken });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.valid).toBe(false);
      expect(verifyRes.body.data.canCheckIn).toBe(false);
      expect(verifyRes.body.data.rejectionTitle).toBe(
        "Daily Check-In Not Yet Open",
      );
      expect(verifyRes.body.data.rejectionReason).toBe("TOO_EARLY");

      // Check-In endpoint should also reject with 400 TOO_EARLY
      const checkInRes = await request(app)
        .post(`/api/v1/access/checkin/${earlySlotBooking.id}`)
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ terminalId: "REC-GATE-01" });

      expect(checkInRes.status).toBe(400);
      expect(checkInRes.body.code).toBe("TOO_EARLY");
      expect(checkInRes.body.message).toContain("opens at");
    });
  });
});

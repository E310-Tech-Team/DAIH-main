import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db/client.js";
import { paymentsService } from "../src/modules/payments/payments.service.js";
import {
  BookingState,
  PaymentStatus,
  RefundReasonCode,
  RefundStatus,
  UserRole,
} from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

describe("Strict Payment Reconciliation & State Machine (DAIH-QA-07)", () => {
  let testUserId: string;
  let testResourceId: string;
  const createdBookingIds: string[] = [];
  const createdTransactionIds: string[] = [];

  beforeAll(async () => {
    // Create test user
    const user = await prisma.user.create({
      data: {
        email: `test_reconcile_${Date.now()}@daih.ng`,
        clientId: `DAIH-CUS-${Date.now()}`,
        passwordHash: "test_hash",
        firstName: "Test",
        lastName: "Reconciler",
        role: UserRole.CUSTOMER,
        isVerified: true,
      },
    });
    testUserId = user.id;

    // Create test resource
    const resource = await prisma.facilityResource.create({
      data: {
        name: `Reconcile Desk ${Date.now()}`,
        slug: `reconcile-desk-${Date.now()}`,
        category: "HOT_DESK",
        description: "Test desk for reconciler state machine",
        location: "Floor 1 Hot Desks",
        capacity: 1,
      },
    });
    testResourceId = resource.id;
  });

  afterAll(async () => {
    // Cleanup
    if (createdTransactionIds.length > 0) {
      await prisma.refundRequest.deleteMany({
        where: { transactionId: { in: createdTransactionIds } },
      });
      await prisma.invoice.deleteMany({
        where: { transactionId: { in: createdTransactionIds } },
      });
      await prisma.transaction.deleteMany({
        where: { id: { in: createdTransactionIds } },
      });
    }
    if (createdBookingIds.length > 0) {
      await prisma.coinHold.deleteMany({
        where: { bookingId: { in: createdBookingIds } },
      });
      await prisma.booking.deleteMany({
        where: { id: { in: createdBookingIds } },
      });
    }
    if (testResourceId) {
      await prisma.facilityResource.delete({
        where: { id: testResourceId },
      });
    }
    if (testUserId) {
      await prisma.user.delete({
        where: { id: testUserId },
      });
    }
  });

  it("Case A: Routes cancelled booking to REQUIRES_RECONCILIATION and creates UNAVAILABLE_RESOURCE system refund", async () => {
    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-A`,
        userId: testUserId,
        resourceId: testResourceId,
        startTime: new Date(Date.now() + 3600 * 1000),
        endTime: new Date(Date.now() + 7200 * 1000),
        totalAmount: new Decimal("1000.00"),
        cashDue: new Decimal("1000.00"),
        state: BookingState.CANCELLED,
      },
    });
    createdBookingIds.push(booking.id);

    const tx = await prisma.transaction.create({
      data: {
        reference: `DAIH-TX-${Date.now()}-A`,
        bookingId: booking.id,
        userId: testUserId,
        amount: new Decimal("1000.00"),
        status: PaymentStatus.PENDING,
      },
    });
    createdTransactionIds.push(tx.id);

    const result = await paymentsService.reconcilePaymentTransaction(tx.id, {
      status: "success",
      amount: 100000,
    });

    expect(result.status).toBe(PaymentStatus.REQUIRES_RECONCILIATION);
    expect(result.confirmed).toBe(false);

    // Verify system refund was created
    const refund = await prisma.refundRequest.findFirst({
      where: { transactionId: tx.id },
    });
    expect(refund).not.toBeNull();
    expect(refund?.isSystemInitiated).toBe(true);
    expect(refund?.reasonCode).toBe(RefundReasonCode.UNAVAILABLE_RESOURCE);
    expect(refund?.status).toBe(RefundStatus.PENDING);

    // Verify booking state was NOT changed
    const freshBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
    });
    expect(freshBooking?.state).toBe(BookingState.CANCELLED);
  });

  it("Case B: Routes already-confirmed booking to REQUIRES_RECONCILIATION and creates DUPLICATE_PAYMENT refund", async () => {
    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-B`,
        userId: testUserId,
        resourceId: testResourceId,
        startTime: new Date(Date.now() + 3600 * 1000),
        endTime: new Date(Date.now() + 7200 * 1000),
        totalAmount: new Decimal("1500.00"),
        cashDue: new Decimal("1500.00"),
        state: BookingState.CONFIRMED,
      },
    });
    createdBookingIds.push(booking.id);

    const tx = await prisma.transaction.create({
      data: {
        reference: `DAIH-TX-${Date.now()}-B`,
        bookingId: booking.id,
        userId: testUserId,
        amount: new Decimal("1500.00"),
        status: PaymentStatus.PENDING,
      },
    });
    createdTransactionIds.push(tx.id);

    const result = await paymentsService.reconcilePaymentTransaction(tx.id, {
      status: "success",
      amount: 150000,
    });

    expect(result.status).toBe(PaymentStatus.REQUIRES_RECONCILIATION);
    expect(result.confirmed).toBe(false);

    const refund = await prisma.refundRequest.findFirst({
      where: { transactionId: tx.id },
    });
    expect(refund).not.toBeNull();
    expect(refund?.isSystemInitiated).toBe(true);
    expect(refund?.reasonCode).toBe(RefundReasonCode.DUPLICATE_PAYMENT);
  });

  it("Step 2: Rejects payment when booking end time has already elapsed in real world", async () => {
    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-PAST`,
        userId: testUserId,
        resourceId: testResourceId,
        startTime: new Date(Date.now() - 7200 * 1000),
        endTime: new Date(Date.now() - 3600 * 1000), // Ended 1 hour ago
        totalAmount: new Decimal("1000.00"),
        cashDue: new Decimal("1000.00"),
        state: BookingState.HELD,
        holdExpiresAt: new Date(Date.now() + 600 * 1000),
      },
    });
    createdBookingIds.push(booking.id);

    const tx = await prisma.transaction.create({
      data: {
        reference: `DAIH-TX-${Date.now()}-PAST`,
        bookingId: booking.id,
        userId: testUserId,
        amount: new Decimal("1000.00"),
        status: PaymentStatus.PENDING,
      },
    });
    createdTransactionIds.push(tx.id);

    const result = await paymentsService.reconcilePaymentTransaction(tx.id, {
      status: "success",
      amount: 100000,
    });

    expect(result.status).toBe(PaymentStatus.REQUIRES_RECONCILIATION);
    expect(result.confirmed).toBe(false);

    const refund = await prisma.refundRequest.findFirst({
      where: { transactionId: tx.id },
    });
    expect(refund?.reasonCode).toBe(RefundReasonCode.UNAVAILABLE_RESOURCE);
  });

  it("Step 3 Price Guard: Flags mismatch when transaction amount does not equal booking.cashDue", async () => {
    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-MISMATCH`,
        userId: testUserId,
        resourceId: testResourceId,
        startTime: new Date(Date.now() + 3600 * 1000),
        endTime: new Date(Date.now() + 7200 * 1000),
        totalAmount: new Decimal("2000.00"),
        cashDue: new Decimal("1500.00"), // cashDue is 1500 (e.g. 500 paid in coins)
        state: BookingState.HELD,
        holdExpiresAt: new Date(Date.now() + 600 * 1000),
      },
    });
    createdBookingIds.push(booking.id);

    // Transaction with 2000 instead of 1500
    const tx = await prisma.transaction.create({
      data: {
        reference: `DAIH-TX-${Date.now()}-MISMATCH`,
        bookingId: booking.id,
        userId: testUserId,
        amount: new Decimal("2000.00"),
        status: PaymentStatus.PENDING,
      },
    });
    createdTransactionIds.push(tx.id);

    const result = await paymentsService.reconcilePaymentTransaction(tx.id, {
      status: "success",
      amount: 200000,
    });

    expect(result.status).toBe(PaymentStatus.FLAGGED_MISMATCH);
    expect(result.confirmed).toBe(false);

    const refund = await prisma.refundRequest.findFirst({
      where: { transactionId: tx.id },
    });
    expect(refund?.reasonCode).toBe(RefundReasonCode.PRICE_CHANGED);
  });

  it("Case C: Confirms live hold, marks other pending transactions ABANDONED, and creates invoice", async () => {
    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-C`,
        userId: testUserId,
        resourceId: testResourceId,
        startTime: new Date(Date.now() + 3600 * 1000),
        endTime: new Date(Date.now() + 7200 * 1000),
        totalAmount: new Decimal("1200.00"),
        cashDue: new Decimal("1200.00"),
        state: BookingState.HELD,
        holdExpiresAt: new Date(Date.now() + 600 * 1000), // Live
      },
    });
    createdBookingIds.push(booking.id);

    const winningTx = await prisma.transaction.create({
      data: {
        reference: `DAIH-TX-${Date.now()}-WIN`,
        bookingId: booking.id,
        userId: testUserId,
        amount: new Decimal("1200.00"),
        status: PaymentStatus.PENDING,
      },
    });
    createdTransactionIds.push(winningTx.id);

    const staleTx = await prisma.transaction.create({
      data: {
        reference: `DAIH-TX-${Date.now()}-STALE`,
        bookingId: booking.id,
        userId: testUserId,
        amount: new Decimal("1200.00"),
        status: PaymentStatus.PENDING,
      },
    });
    createdTransactionIds.push(staleTx.id);

    const result = await paymentsService.reconcilePaymentTransaction(
      winningTx.id,
      {
        status: "success",
        amount: 120000,
      },
    );

    expect(result.status).toBe(PaymentStatus.SUCCESSFUL);
    expect(result.confirmed).toBe(true);

    // Verify booking is confirmed
    const confirmedBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
    });
    expect(confirmedBooking?.state).toBe(BookingState.CONFIRMED);
    expect(confirmedBooking?.qrToken).toBeTruthy();

    // Verify stale transaction is ABANDONED
    const updatedStaleTx = await prisma.transaction.findUnique({
      where: { id: staleTx.id },
    });
    expect(updatedStaleTx?.status).toBe(PaymentStatus.ABANDONED);

    // Verify invoice was created
    const invoice = await prisma.invoice.findUnique({
      where: { transactionId: winningTx.id },
    });
    expect(invoice).not.toBeNull();
  });

  it("Case D: Reconfirms expired hold if slot capacity is still available", async () => {
    const start24h = new Date(Date.now() + 24 * 3600 * 1000);
    const end24h = new Date(Date.now() + 25 * 3600 * 1000);
    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-D-OK`,
        userId: testUserId,
        resourceId: testResourceId,
        startTime: start24h,
        endTime: end24h,
        totalAmount: new Decimal("1000.00"),
        cashDue: new Decimal("1000.00"),
        state: BookingState.EXPIRED,
        holdExpiresAt: new Date(Date.now() - 600 * 1000), // Expired
      },
    });
    createdBookingIds.push(booking.id);

    const tx = await prisma.transaction.create({
      data: {
        reference: `DAIH-TX-${Date.now()}-D-OK`,
        bookingId: booking.id,
        userId: testUserId,
        amount: new Decimal("1000.00"),
        status: PaymentStatus.PENDING,
      },
    });
    createdTransactionIds.push(tx.id);

    const result = await paymentsService.reconcilePaymentTransaction(tx.id, {
      status: "success",
      amount: 100000,
    });

    expect(result.status).toBe(PaymentStatus.SUCCESSFUL);
    expect(result.confirmed).toBe(true);

    const confirmedBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
    });
    expect(confirmedBooking?.state).toBe(BookingState.CONFIRMED);
  });

  it("Case D: Rejects expired hold when slot was claimed by another customer", async () => {
    const start48h = new Date(Date.now() + 48 * 3600 * 1000);
    const end48h = new Date(Date.now() + 49 * 3600 * 1000);
    // 1. Another customer confirmed the slot (resource capacity is 1)
    const competitorBooking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-COMP`,
        userId: testUserId,
        resourceId: testResourceId,
        startTime: start48h,
        endTime: end48h,
        totalAmount: new Decimal("1000.00"),
        cashDue: new Decimal("1000.00"),
        state: BookingState.CONFIRMED,
      },
    });
    createdBookingIds.push(competitorBooking.id);

    // 2. Late payment lands for expired booking on same slot
    const lateBooking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-D-FAIL`,
        userId: testUserId,
        resourceId: testResourceId,
        startTime: start48h,
        endTime: end48h,
        totalAmount: new Decimal("1000.00"),
        cashDue: new Decimal("1000.00"),
        state: BookingState.EXPIRED,
        holdExpiresAt: new Date(Date.now() - 600 * 1000),
      },
    });
    createdBookingIds.push(lateBooking.id);

    const tx = await prisma.transaction.create({
      data: {
        reference: `DAIH-TX-${Date.now()}-D-FAIL`,
        bookingId: lateBooking.id,
        userId: testUserId,
        amount: new Decimal("1000.00"),
        status: PaymentStatus.PENDING,
      },
    });
    createdTransactionIds.push(tx.id);

    const result = await paymentsService.reconcilePaymentTransaction(tx.id, {
      status: "success",
      amount: 100000,
    });

    expect(result.status).toBe(PaymentStatus.REQUIRES_RECONCILIATION);
    expect(result.confirmed).toBe(false);

    // Booking remains EXPIRED
    const freshLateBooking = await prisma.booking.findUnique({
      where: { id: lateBooking.id },
    });
    expect(freshLateBooking?.state).toBe(BookingState.EXPIRED);

    // System refund initiated
    const refund = await prisma.refundRequest.findFirst({
      where: { transactionId: tx.id },
    });
    expect(refund?.reasonCode).toBe(RefundReasonCode.UNAVAILABLE_RESOURCE);
  });

  describe("Gateway guard: the charge Paystack reports must match the transaction", () => {
    async function createLiveHold(suffix: string) {
      const booking = await prisma.booking.create({
        data: {
          reference: `DAIH-BK-${Date.now()}-${suffix}`,
          userId: testUserId,
          resourceId: testResourceId,
          startTime: new Date(Date.now() + 3600 * 1000),
          endTime: new Date(Date.now() + 7200 * 1000),
          totalAmount: new Decimal("1000.00"),
          cashDue: new Decimal("1000.00"),
          state: BookingState.HELD,
          holdExpiresAt: new Date(Date.now() + 600 * 1000),
        },
      });
      createdBookingIds.push(booking.id);

      const tx = await prisma.transaction.create({
        data: {
          reference: `DAIH-TX-${Date.now()}-${suffix}`,
          bookingId: booking.id,
          userId: testUserId,
          amount: new Decimal("1000.00"),
          status: PaymentStatus.PENDING,
        },
      });
      createdTransactionIds.push(tx.id);
      return { booking, tx };
    }

    async function expectHeldForReconciliation(
      bookingId: string,
      txId: string,
    ) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
      });
      expect(booking?.state).toBe(BookingState.HELD);
      expect(booking?.qrToken).toBeNull();

      const invoice = await prisma.invoice.findUnique({
        where: { transactionId: txId },
      });
      expect(invoice).toBeNull();

      // Not auto-refunded: nothing proves the money moved, so staff review it.
      const refund = await prisma.refundRequest.findFirst({
        where: { transactionId: txId },
      });
      expect(refund).toBeNull();
    }

    it("does not confirm when the gateway reports a smaller amount", async () => {
      const { booking, tx } = await createLiveHold("UNDERPAID");

      const result = await paymentsService.reconcilePaymentTransaction(tx.id, {
        status: "success",
        amount: 100,
        currency: "NGN",
        reference: tx.reference,
      });

      expect(result.status).toBe(PaymentStatus.REQUIRES_RECONCILIATION);
      expect(result.confirmed).toBe(false);
      await expectHeldForReconciliation(booking.id, tx.id);
    });

    it("does not confirm when the gateway reports a different currency", async () => {
      const { booking, tx } = await createLiveHold("CURRENCY");

      const result = await paymentsService.reconcilePaymentTransaction(tx.id, {
        status: "success",
        amount: 100000,
        currency: "USD",
        reference: tx.reference,
      });

      expect(result.status).toBe(PaymentStatus.REQUIRES_RECONCILIATION);
      expect(result.confirmed).toBe(false);
      await expectHeldForReconciliation(booking.id, tx.id);
    });

    it("does not confirm when the gateway reports another transaction's reference", async () => {
      const { booking, tx } = await createLiveHold("REFERENCE");

      const result = await paymentsService.reconcilePaymentTransaction(tx.id, {
        status: "success",
        amount: 100000,
        currency: "NGN",
        reference: "DAIH-PAY-SOMEONE-ELSE",
      });

      expect(result.status).toBe(PaymentStatus.REQUIRES_RECONCILIATION);
      expect(result.confirmed).toBe(false);
      await expectHeldForReconciliation(booking.id, tx.id);
    });
  });
});

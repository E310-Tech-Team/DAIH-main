import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db/client.js";
import { refundService } from "../src/modules/payments/refund.service.js";
import {
  BookingState,
  PaymentStatus,
  RefundReasonCode,
  RefundStatus,
  UserRole,
} from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

describe("Refund Scoping & Segregation of Duties (DAIH-QA-10)", () => {
  let operatorUserId: string;
  let financeOfficerUserId: string;
  let customerUserId: string;
  let testResourceId: string;
  const createdBookingIds: string[] = [];
  const createdRefundIds: string[] = [];

  beforeAll(async () => {
    // 1. Create Operations Admin
    const op = await prisma.user.create({
      data: {
        email: `op_${Date.now()}@daih.ng`,
        clientId: `DAIH-OP-${Date.now()}`,
        passwordHash: "test_hash",
        firstName: "Op",
        lastName: "Admin",
        role: UserRole.OPERATIONS_ADMIN,
        isVerified: true,
      },
    });
    operatorUserId = op.id;

    // 2. Create Finance Officer
    const fo = await prisma.user.create({
      data: {
        email: `fo_${Date.now()}@daih.ng`,
        clientId: `DAIH-FO-${Date.now()}`,
        passwordHash: "test_hash",
        firstName: "Finance",
        lastName: "Officer",
        role: UserRole.FINANCE_OFFICER,
        isVerified: true,
      },
    });
    financeOfficerUserId = fo.id;

    // 3. Create Customer
    const cust = await prisma.user.create({
      data: {
        email: `cust_${Date.now()}@daih.ng`,
        clientId: `DAIH-CUST-${Date.now()}`,
        passwordHash: "test_hash",
        firstName: "Customer",
        lastName: "User",
        role: UserRole.CUSTOMER,
        isVerified: true,
      },
    });
    customerUserId = cust.id;

    // 4. Create Resource
    const res = await prisma.facilityResource.create({
      data: {
        name: `Refund Resource ${Date.now()}`,
        slug: `refund-res-${Date.now()}`,
        category: "HOT_DESK",
        description: "Test resource for refund scoping",
        location: "Floor 2 Desk Area",
        capacity: 10,
      },
    });
    testResourceId = res.id;
  });

  afterAll(async () => {
    if (createdRefundIds.length > 0) {
      await prisma.refundRequest.deleteMany({
        where: { id: { in: createdRefundIds } },
      });
    }
    if (createdBookingIds.length > 0) {
      await prisma.transaction.deleteMany({
        where: { bookingId: { in: createdBookingIds } },
      });
      await prisma.coinHold.deleteMany({
        where: { bookingId: { in: createdBookingIds } },
      });
      await prisma.booking.deleteMany({
        where: { id: { in: createdBookingIds } },
      });
    }
    if (testResourceId) {
      await prisma.facilityResource.delete({ where: { id: testResourceId } });
    }
    const userIds = [
      operatorUserId,
      financeOfficerUserId,
      customerUserId,
    ].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.user.deleteMany({
        where: {
          id: { in: userIds },
        },
      });
    }
  });

  it("enforces segregation of duties: initiator cannot approve their own refund", async () => {
    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-DUTY`,
        userId: customerUserId,
        resourceId: testResourceId,
        startTime: new Date(Date.now() + 3600 * 1000),
        endTime: new Date(Date.now() + 7200 * 1000),
        totalAmount: new Decimal("2000.00"),
        cashDue: new Decimal("2000.00"),
        state: BookingState.CONFIRMED,
      },
    });
    createdBookingIds.push(booking.id);

    await prisma.transaction.create({
      data: {
        reference: `DAIH-TX-${Date.now()}-DUTY`,
        bookingId: booking.id,
        userId: customerUserId,
        amount: new Decimal("2000.00"),
        status: PaymentStatus.SUCCESSFUL,
      },
    });

    const refund = await refundService.raiseRefundRequest(operatorUserId, {
      bookingId: booking.id,
      reasonCode: RefundReasonCode.CUSTOMER_DISPUTE,
      reason:
        "Customer requested cancellation more than 24h prior to reservation start time",
    });
    createdRefundIds.push(refund.id);

    // Operator attempts to approve their own request
    let errorCaught: any = null;
    try {
      await refundService.approveRefund(operatorUserId, refund.id);
    } catch (err: any) {
      errorCaught = err;
    }

    expect(errorCaught).not.toBeNull();
    expect(errorCaught?.code).toBe("SELF_APPROVAL_PROHIBITED");
  });

  it("scopes system refunds: DUPLICATE_PAYMENT does not alter booking state or cancel booking", async () => {
    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-SYS-DUP`,
        userId: customerUserId,
        resourceId: testResourceId,
        startTime: new Date(Date.now() + 3600 * 1000),
        endTime: new Date(Date.now() + 7200 * 1000),
        totalAmount: new Decimal("3000.00"),
        cashDue: new Decimal("3000.00"),
        state: BookingState.CONFIRMED, // Legitimate booking is CONFIRMED
      },
    });
    createdBookingIds.push(booking.id);

    const dupTx = await prisma.transaction.create({
      data: {
        reference: `DAIH-TX-${Date.now()}-DUP`,
        bookingId: booking.id,
        userId: customerUserId,
        amount: new Decimal("3000.00"),
        status: PaymentStatus.REQUIRES_RECONCILIATION,
      },
    });

    // Create system refund for the duplicate transaction
    const systemRefund = await prisma.refundRequest.create({
      data: {
        bookingId: booking.id,
        transactionId: dupTx.id,
        amount: new Decimal("3000.00"),
        reasonCode: RefundReasonCode.DUPLICATE_PAYMENT,
        reason: "Duplicate payment landed after booking was already confirmed",
        status: RefundStatus.PENDING,
        isSystemInitiated: true,
      },
    });
    createdRefundIds.push(systemRefund.id);

    // Approve the system refund
    await refundService.processSystemRefund(systemRefund.id);

    // Verify refund is processed
    const freshRefund = await prisma.refundRequest.findUnique({
      where: { id: systemRefund.id },
    });
    expect(freshRefund?.status).toBe(RefundStatus.PROCESSED);

    // Verify booking state remained CONFIRMED (did not get cancelled/refunded!)
    const freshBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
    });
    expect(freshBooking?.state).toBe(BookingState.CONFIRMED);
  });

  it("handles zero-cash refund: completes without calling gateway and updates booking", async () => {
    // 100% coin booking (cashDue = 0, transactionId = null)
    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-${Date.now()}-ZERO`,
        userId: customerUserId,
        resourceId: testResourceId,
        startTime: new Date(Date.now() + 3600 * 1000),
        endTime: new Date(Date.now() + 7200 * 1000),
        totalAmount: new Decimal("1000.00"),
        cashDue: new Decimal("0.00"),
        coinsRedeemed: new Decimal("1000.00"),
        state: BookingState.CONFIRMED,
      },
    });
    createdBookingIds.push(booking.id);

    const refund = await prisma.refundRequest.create({
      data: {
        bookingId: booking.id,
        transactionId: null, // Zero cash
        amount: new Decimal("0.00"),
        coinsToReverse: new Decimal("1000.00"),
        reasonCode: RefundReasonCode.CUSTOMER_DISPUTE,
        reason: "Customer requested cancellation for 100% coin booking",
        status: RefundStatus.PENDING,
        isSystemInitiated: false,
        requestedByUserId: operatorUserId,
      },
    });
    createdRefundIds.push(refund.id);

    // Finance officer approves
    await refundService.approveRefund(financeOfficerUserId, refund.id);

    const freshRefund = await prisma.refundRequest.findUnique({
      where: { id: refund.id },
    });
    expect(freshRefund?.status).toBe(RefundStatus.PROCESSED);

    // For standard customer refund, booking is marked REFUNDED
    const freshBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
    });
    expect(freshBooking?.state).toBe(BookingState.REFUNDED);
  });
});

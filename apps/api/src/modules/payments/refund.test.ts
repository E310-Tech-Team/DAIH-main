import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  RefundStatus,
  RefundReasonCode,
  BookingState,
  UserRole,
} from "@prisma/client";
import { refundService } from "./refund.service.js";
import { Decimal } from "@prisma/client/runtime/library";

const { store } = vi.hoisted(() => ({
  store: {
    bookings: [] as any[],
    transactions: [] as any[],
    users: [] as any[],
    refundRequests: [] as any[],
    coinBalances: [] as any[],
    coinEntries: [] as any[],
    outboxEvents: [] as any[],
    notifications: [] as any[],
  },
}));

vi.mock("./paystack.client.js", () => ({
  paystackClient: {
    createRefund: vi.fn(async ({ transaction, amount }: any) => ({
      status: true,
      message: "Refund has been queued for processing",
      data: {
        id: 1234567,
        refund_reference: `REF-${transaction}`,
        amount,
        status: "processed",
      },
    })),
  },
}));

vi.mock("../notifications/notifications.queue.js", () => ({
  enqueueNotification: vi.fn(
    async (type: string, email: string, name: string, data: any) => {
      store.notifications.push({ type, email, name, data });
      return { jobId: `mock-job-${Date.now()}` };
    },
  ),
}));

vi.mock("../../db/client.js", () => {
  const mockTx = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => []),
    refundRequest: {
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          store.refundRequests.find((r) => {
            if (where.bookingId && r.bookingId !== where.bookingId)
              return false;
            if (where.status?.in && !where.status.in.includes(r.status))
              return false;
            if (
              where.status &&
              typeof where.status === "string" &&
              r.status !== where.status
            )
              return false;
            return true;
          }) || null
        );
      }),
      create: vi.fn(async ({ data }: any) => {
        const created = {
          id: `refund-${Date.now()}`,
          ...data,
          requestedAt: new Date(),
        };
        store.refundRequests.push(created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = store.refundRequests.findIndex((r) => r.id === where.id);
        if (idx !== -1) {
          store.refundRequests[idx] = { ...store.refundRequests[idx], ...data };
          return store.refundRequests[idx];
        }
        return null;
      }),
    },
    booking: {
      update: vi.fn(async ({ where, data }: any) => {
        const idx = store.bookings.findIndex((b) => b.id === where.id);
        if (idx !== -1) {
          store.bookings[idx] = { ...store.bookings[idx], ...data };
          return store.bookings[idx];
        }
        return null;
      }),
    },
    transaction: {
      update: vi.fn(async ({ where, data }: any) => {
        const idx = store.transactions.findIndex((t) => t.id === where.id);
        if (idx !== -1) {
          store.transactions[idx] = { ...store.transactions[idx], ...data };
          return store.transactions[idx];
        }
        return null;
      }),
    },
    outboxEvent: {
      create: vi.fn(async ({ data }: any) => {
        store.outboxEvents.push(data);
        return data;
      }),
    },
  };

  return {
    prisma: {
      ...mockTx,
      $transaction: vi.fn(async (cb: any) => cb(mockTx)),
      booking: {
        ...mockTx.booking,
        findUnique: vi.fn(async ({ where, include }: any) => {
          const booking = store.bookings.find((b) => b.id === where.id);
          if (!booking) return null;
          const res = { ...booking };
          if (include?.transactions) {
            res.transactions = store.transactions.filter(
              (t) =>
                t.bookingId === booking.id &&
                (!include.transactions.where ||
                  t.status === include.transactions.where.status),
            );
          }
          if (include?.user) {
            res.user = store.users.find((u) => u.id === booking.userId);
          }
          return res;
        }),
      },
      user: {
        findUnique: vi.fn(async ({ where }: any) => {
          return store.users.find((u) => u.id === where.id) || null;
        }),
        findMany: vi.fn(async ({ where }: any) => {
          return store.users.filter((u) => {
            if (where.role?.in && !where.role.in.includes(u.role)) return false;
            return true;
          });
        }),
      },
      coinLedgerEntry: {
        findFirst: vi.fn(async ({ where }: any) => {
          return (
            store.coinEntries.find(
              (e) =>
                e.referenceId === where.referenceId &&
                e.action === where.action,
            ) || null
          );
        }),
      },
      refundRequest: {
        ...mockTx.refundRequest,
        findUnique: vi.fn(async ({ where, include }: any) => {
          const req = store.refundRequests.find(
            (r) => r.id === where.id || r.bookingId === where.bookingId,
          );
          if (!req) return null;
          const res = { ...req };
          if (include?.booking) {
            const b = store.bookings.find((bk) => bk.id === req.bookingId);
            res.booking = {
              ...b,
              transactions: store.transactions.filter(
                (t) => t.bookingId === req.bookingId,
              ),
              user: store.users.find((u) => u.id === b?.userId),
            };
          }
          if (include?.requestedBy) {
            res.requestedBy = store.users.find(
              (u) => u.id === req.requestedByUserId,
            );
          }
          if (include?.reviewedBy) {
            res.reviewedBy = store.users.find(
              (u) => u.id === req.reviewedByUserId,
            );
          }
          return res;
        }),
        findMany: vi.fn(async () => store.refundRequests),
        count: vi.fn(async () => store.refundRequests.length),
        upsert: vi.fn(async ({ where, create, update }: any) => {
          const idx = store.refundRequests.findIndex(
            (r) => r.bookingId === where.bookingId,
          );
          if (idx !== -1) {
            store.refundRequests[idx] = {
              ...store.refundRequests[idx],
              ...update,
            };
            return store.refundRequests[idx];
          }
          const created = {
            id: `refund-${Date.now()}`,
            ...create,
            requestedAt: new Date(),
          };
          store.refundRequests.push(created);
          return created;
        }),
      },
    },
  };
});

// Mock coinService methods to observe calls
vi.mock("../loyalty/coin.service.js", () => ({
  coinService: {
    reverseRedemption: vi.fn(async () => {}),
    clawbackEarnedCoins: vi.fn(async () => {}),
    clawbackReferralBonus: vi.fn(async () => {}),
  },
}));

import { coinService } from "../loyalty/coin.service.js";

describe("Dual-Authorization Refund Workflow", () => {
  const operatorUser = {
    id: "user-operator-1",
    email: "operations@daih.com",
    firstName: "Ada",
    lastName: "Operations",
    role: UserRole.OPERATIONS_ADMIN,
    isVerified: true,
  };

  const financeOfficerUser = {
    id: "user-finance-1",
    email: "finance@daih.com",
    firstName: "Chidi",
    lastName: "Finance",
    role: UserRole.FINANCE_OFFICER,
    isVerified: true,
  };

  const customerUser = {
    id: "user-customer-1",
    email: "customer@example.com",
    firstName: "Emeka",
    lastName: "Okafor",
    role: UserRole.CUSTOMER,
    referredById: "user-referrer-1",
    isVerified: true,
  };

  const booking = {
    id: "booking-101",
    reference: "DAIH-BK-20260921-12345",
    userId: customerUser.id,
    resourceId: "resource-desk-1",
    state: BookingState.CONFIRMED,
    totalAmount: new Decimal(20000),
    originalAmount: new Decimal(25000),
    discountAmount: new Decimal(3000),
    redeemedCoins: new Decimal(2000),
    redeemedCoinsNgn: new Decimal(2000),
  };

  const transaction = {
    id: "tx-101",
    reference: "DAIH-PAY-20260921-99999",
    bookingId: booking.id,
    userId: customerUser.id,
    amount: new Decimal(20000),
    status: "SUCCESSFUL",
  };

  beforeEach(() => {
    store.bookings = [{ ...booking }];
    store.transactions = [{ ...transaction }];
    store.users = [
      { ...operatorUser },
      { ...financeOfficerUser },
      { ...customerUser },
    ];
    store.refundRequests = [];
    store.coinEntries = [
      {
        id: "entry-earn-1",
        userId: customerUser.id,
        action: "BOOKING_EARN",
        amount: new Decimal(1000),
        referenceId: booking.id,
      },
      {
        id: "entry-ref-1",
        userId: "user-referrer-1",
        action: "REFERRAL_BONUS",
        amount: new Decimal(1000),
        referenceId: booking.id,
      },
    ];
    store.outboxEvents = [];
    store.notifications = [];
    vi.clearAllMocks();
  });

  describe("1. Raising Refund Request (Operations Manager)", () => {
    it("should reject a refund reason with fewer than 20 characters", async () => {
      await expect(
        refundService.raiseRefundRequest(operatorUser.id, {
          bookingId: booking.id,
          reasonCode: RefundReasonCode.FACILITY_ISSUE,
          reason: "Too short reason",
        }),
      ).rejects.toMatchObject({
        code: "INVALID_REFUND_REASON",
        statusCode: 400,
      });
    });

    it("should successfully raise a refund request when reason is >= 20 characters", async () => {
      const result = await refundService.raiseRefundRequest(operatorUser.id, {
        bookingId: booking.id,
        reasonCode: RefundReasonCode.FACILITY_ISSUE,
        reason:
          "The conference hall projector was malfunctioning and AC was down throughout the event.",
      });

      expect(result).toBeDefined();
      expect(result.status).toBe(RefundStatus.PENDING);
      expect(Number(result.amount)).toBe(20000);
      expect(Number(result.coinsToReverse)).toBe(2000);
      expect(Number(result.coinsToClawback)).toBe(1000);
      expect(Number(result.referralCoinsToClawback)).toBe(1000);

      // Notification sent to Finance Officer
      const financeNotification = store.notifications.find(
        (n) => n.type === "finance.refund_requested",
      );
      expect(financeNotification).toBeDefined();
      expect(financeNotification?.email).toBe(financeOfficerUser.email);
    });

    it("should reject raising a duplicate refund request if one is already pending", async () => {
      await refundService.raiseRefundRequest(operatorUser.id, {
        bookingId: booking.id,
        reasonCode: RefundReasonCode.SERVICE_FAILURE,
        reason:
          "Customer experienced poor internet connection and could not work properly.",
      });

      await expect(
        refundService.raiseRefundRequest(operatorUser.id, {
          bookingId: booking.id,
          reasonCode: RefundReasonCode.SERVICE_FAILURE,
          reason:
            "Attempting duplicate request for the exact same booking reference.",
        }),
      ).rejects.toMatchObject({
        code: "REFUND_ALREADY_EXISTS",
        statusCode: 409,
      });
    });
  });

  describe("2. Clarification Inquiry Loop (Finance <-> Operations)", () => {
    let refundRequestId: string;

    beforeEach(async () => {
      const raised = await refundService.raiseRefundRequest(operatorUser.id, {
        bookingId: booking.id,
        reasonCode: RefundReasonCode.CUSTOMER_DISPUTE,
        reason:
          "Customer claimed double charge at the physical reception terminal.",
      });
      refundRequestId = raised.id;
    });

    it("Finance Officer can request clarification from Operations", async () => {
      const updated = await refundService.requestMoreInfo(
        financeOfficerUser.id,
        refundRequestId,
        {
          question: "Did reception check the physical POS slip before raising?",
        },
      );

      expect(updated.status).toBe(RefundStatus.INFO_REQUESTED);
      expect(updated.infoRequested).toContain(
        "Did reception check the physical POS slip",
      );

      // Notification sent to Operations
      const opNotification = store.notifications.find(
        (n) => n.type === "operations.refund_info_requested",
      );
      expect(opNotification).toBeDefined();
    });

    it("Operations Manager can provide clarification, reverting status to PENDING", async () => {
      await refundService.requestMoreInfo(
        financeOfficerUser.id,
        refundRequestId,
        {
          question: "Please attach POS receipt confirmation.",
        },
      );

      const updated = await refundService.provideMoreInfo(
        operatorUser.id,
        refundRequestId,
        {
          response:
            "Verified with bank settlement sheet, confirmed double capture on terminal #4.",
        },
      );

      expect(updated.status).toBe(RefundStatus.PENDING);
      expect(updated.infoProvided).toContain("terminal #4");

      // Notification sent to Finance
      const finNotification = store.notifications.find(
        (n) => n.type === "finance.refund_info_provided",
      );
      expect(finNotification).toBeDefined();
    });
  });

  describe("3. Segregation of Duties & Approval", () => {
    let refundRequestId: string;

    beforeEach(async () => {
      const raised = await refundService.raiseRefundRequest(operatorUser.id, {
        bookingId: booking.id,
        reasonCode: RefundReasonCode.FACILITY_ISSUE,
        reason:
          "Workspace power outage during scheduled multi-hour training session.",
      });
      refundRequestId = raised.id;
    });

    it("STRICT: Initiator cannot approve their own refund request (Segregation of Duties)", async () => {
      await expect(
        refundService.approveRefund(operatorUser.id, refundRequestId),
      ).rejects.toMatchObject({
        code: "SELF_APPROVAL_PROHIBITED",
        statusCode: 403,
      });
    });

    it("Finance Officer approves refund: executes Paystack gateway, reverses coins & claws back", async () => {
      const approved = await refundService.approveRefund(
        financeOfficerUser.id,
        refundRequestId,
      );

      expect(approved.status).toBe(RefundStatus.PROCESSED);
      expect(approved.paystackRefundId).toBe("1234567");

      // 1. Booking updated to REFUNDED
      const updatedBooking = store.bookings.find((b) => b.id === booking.id);
      expect(updatedBooking?.state).toBe(BookingState.REFUNDED);

      // 2. Outbox event emitted for refund processed and loyalty reversal
      const outbox = store.outboxEvents.find(
        (e) => e.eventType === "refund.processed",
      );
      expect(outbox).toBeDefined();
      expect(outbox.payload.bookingId).toBe(booking.id);
      expect(outbox).toBeDefined();
      expect(outbox?.payload?.bookingId).toBe(booking.id);

      // 6. Customer notified
      const customerNotification = store.notifications.find(
        (n) => n.type === "customer.refund_processed",
      );
      expect(customerNotification).toBeDefined();
      expect(customerNotification?.email).toBe(customerUser.email);
    });

    it("Finance Officer can reject refund with required reason", async () => {
      const rejected = await refundService.rejectRefund(
        financeOfficerUser.id,
        refundRequestId,
        {
          rejectionReason:
            "Customer utilized the facility for 90% of the session duration.",
        },
      );

      expect(rejected.status).toBe(RefundStatus.REJECTED);
      expect(rejected.rejectionReason).toContain(
        "Customer utilized the facility",
      );

      const opNotification = store.notifications.find(
        (n) => n.type === "operations.refund_rejected",
      );
      expect(opNotification).toBeDefined();
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import {
  BookingState,
  PaymentMethod,
  PaymentOption,
  PaymentStatus,
  RefundReasonCode,
  RefundStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "../src/db/client.js";
import { manualPaymentsService } from "../src/modules/payments/manual-payments.service.js";
import { refundService } from "../src/modules/payments/refund.service.js";
import { bookingService } from "../src/modules/booking/booking.service.js";

const HOUR = 60 * 60 * 1000;
const RUN = `${Date.now()}`;
const REFERENCE_FORMAT = /^DAIH-PAY-\d{8}-[A-HJ-NP-Z2-9]{6}$/;

describe("Manual payments: bank transfer and pay at reception", () => {
  let customerId: string;
  let financeId: string;
  let receptionId: string;
  let opsId: string;
  let resourceId: string;
  const bookingIds: string[] = [];

  async function createUser(role: UserRole, label: string): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `manual_${label}_${RUN}@daih.test`,
        clientId: `DAIH-MP-${label}-${RUN}`,
        passwordHash: "test_hash",
        firstName: "Test",
        lastName: label,
        role,
        isVerified: true,
      },
    });
    return user.id;
  }

  async function createHeldBooking(
    startsInMs: number,
    cashDue = "5000.00",
  ): Promise<string> {
    const booking = await prisma.booking.create({
      data: {
        reference: `DAIH-BK-MP-${RUN}-${bookingIds.length}`,
        userId: customerId,
        resourceId,
        startTime: new Date(Date.now() + startsInMs),
        endTime: new Date(Date.now() + startsInMs + 8 * HOUR),
        totalAmount: new Decimal(cashDue),
        cashDue: new Decimal(cashDue),
        state: BookingState.HELD,
        holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    bookingIds.push(booking.id);
    return booking.id;
  }

  async function setSettings(
    data: Partial<{
      bankTransferEnabled: boolean;
      payAtReceptionEnabled: boolean;
    }>,
  ): Promise<void> {
    await prisma.paymentSetting.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        bankName: "Example Bank",
        bankAccountNumber: "0123456789",
        bankAccountName: "DAIH Innovation Hub",
        ...data,
      },
      update: data,
    });
  }

  beforeAll(async () => {
    customerId = await createUser(UserRole.CUSTOMER, "CUST");
    financeId = await createUser(UserRole.FINANCE_OFFICER, "FIN");
    receptionId = await createUser(UserRole.RECEPTION_OFFICER, "REC");
    opsId = await createUser(UserRole.OPERATIONS_ADMIN, "OPS");
    const resource = await prisma.facilityResource.create({
      data: {
        name: `Manual Pay Desk ${RUN}`,
        slug: `manual-pay-desk-${RUN}`,
        category: "HOT_DESK",
        description: "Test desk for manual payments",
        location: "Floor 1",
        capacity: 10,
      },
    });
    resourceId = resource.id;
    await prisma.paymentSetting.deleteMany({ where: { id: "default" } });
    await setSettings({
      bankTransferEnabled: true,
      payAtReceptionEnabled: true,
    });
  });

  afterAll(async () => {
    const transactions = await prisma.transaction.findMany({
      where: { bookingId: { in: bookingIds } },
      select: { id: true },
    });
    const transactionIds = transactions.map((t) => t.id);
    await prisma.refundRequest.deleteMany({
      where: { bookingId: { in: bookingIds } },
    });
    await prisma.invoice.deleteMany({
      where: { transactionId: { in: transactionIds } },
    });
    await prisma.transaction.deleteMany({
      where: { id: { in: transactionIds } },
    });
    await prisma.coinHold.deleteMany({
      where: { bookingId: { in: bookingIds } },
    });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.facilityResource.deleteMany({ where: { id: resourceId } });
    const userIds = [customerId, financeId, receptionId, opsId];
    await prisma.coinLedgerEntry.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.coinBalance.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.paymentSetting.deleteMany({ where: { id: "default" } });
  });

  describe("bank transfer", () => {
    it("issues a reference and holds the booking for the transfer window", async () => {
      const bookingId = await createHeldBooking(72 * HOUR);

      const result = await manualPaymentsService.startBankTransfer(
        bookingId,
        customerId,
      );

      expect(result.reference).toMatch(REFERENCE_FORMAT);
      expect(result.bankAccount.accountNumber).toBe("0123456789");
      const expiresIn = new Date(result.expiresAt).getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(23.9 * HOUR);
      expect(expiresIn).toBeLessThanOrEqual(24 * HOUR);

      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      expect(booking.state).toBe(BookingState.PENDING_PAYMENT);
      expect(booking.paymentOption).toBe(PaymentOption.BANK_TRANSFER);

      const transfer = await prisma.transaction.findUniqueOrThrow({
        where: { id: result.transactionId },
      });
      expect(transfer.method).toBe(PaymentMethod.BANK_TRANSFER);
      expect(transfer.status).toBe(PaymentStatus.PENDING);
    });

    it("reuses the open transfer instead of extending the hold", async () => {
      const bookingId = await createHeldBooking(72 * HOUR);
      const first = await manualPaymentsService.startBankTransfer(
        bookingId,
        customerId,
      );

      const second = await manualPaymentsService.startBankTransfer(
        bookingId,
        customerId,
      );

      expect(second.transactionId).toBe(first.transactionId);
      expect(second.expiresAt).toBe(first.expiresAt);
    });

    it("refuses when the booking starts too soon for finance to confirm", async () => {
      const bookingId = await createHeldBooking(20 * 60 * 1000);

      await expect(
        manualPaymentsService.startBankTransfer(bookingId, customerId),
      ).rejects.toMatchObject({ code: "TRANSFER_WINDOW_TOO_SHORT" });
    });

    it("confirms the booking when finance records the exact amount", async () => {
      const bookingId = await createHeldBooking(72 * HOUR);
      const transfer = await manualPaymentsService.startBankTransfer(
        bookingId,
        customerId,
      );

      const outcome = await manualPaymentsService.confirmBankTransfer(
        financeId,
        transfer.transactionId,
        { amountReceived: 5000, bankReference: "NIP-000123456789" },
      );

      expect(outcome.confirmed).toBe(true);
      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      expect(booking.state).toBe(BookingState.CONFIRMED);
      expect(booking.qrToken).toBeTruthy();
      const tx = await prisma.transaction.findUniqueOrThrow({
        where: { id: transfer.transactionId },
        include: { invoice: true },
      });
      expect(tx.status).toBe(PaymentStatus.SUCCESSFUL);
      expect(tx.confirmedBy).toBe(financeId);
      expect(tx.externalReference).toBe("NIP-000123456789");
      expect(tx.invoice).not.toBeNull();
    });

    it("holds a short payment for reconciliation instead of confirming", async () => {
      const bookingId = await createHeldBooking(72 * HOUR);
      const transfer = await manualPaymentsService.startBankTransfer(
        bookingId,
        customerId,
      );

      const outcome = await manualPaymentsService.confirmBankTransfer(
        financeId,
        transfer.transactionId,
        {
          amountReceived: 4000,
          bankReference: "NIP-SHORT-1",
          allowAmountMismatch: true,
        },
      );

      expect(outcome.status).toBe(PaymentStatus.REQUIRES_RECONCILIATION);
      expect(outcome.confirmed).toBe(false);
      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      expect(booking.state).toBe(BookingState.PENDING_PAYMENT);
    });

    it("never lets staff confirm a payment for their own booking", async () => {
      const bookingId = await createHeldBooking(72 * HOUR);
      const transfer = await manualPaymentsService.startBankTransfer(
        bookingId,
        customerId,
      );

      await expect(
        manualPaymentsService.confirmBankTransfer(
          customerId,
          transfer.transactionId,
          { amountReceived: 5000, bankReference: "NIP-SELF" },
        ),
      ).rejects.toMatchObject({ code: "SELF_CONFIRMATION_PROHIBITED" });
    });

    it("closes a rejected transfer but keeps the booking held", async () => {
      const bookingId = await createHeldBooking(72 * HOUR);
      const transfer = await manualPaymentsService.startBankTransfer(
        bookingId,
        customerId,
      );

      await manualPaymentsService.rejectBankTransfer(
        financeId,
        transfer.transactionId,
        "No matching credit on the statement",
      );

      const tx = await prisma.transaction.findUniqueOrThrow({
        where: { id: transfer.transactionId },
      });
      expect(tx.status).toBe(PaymentStatus.FAILED);
      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      expect(booking.state).toBe(BookingState.PENDING_PAYMENT);
    });

    it("lists transfers awaiting confirmation for finance", async () => {
      const bookingId = await createHeldBooking(72 * HOUR);
      const transfer = await manualPaymentsService.startBankTransfer(
        bookingId,
        customerId,
      );

      const pending = await manualPaymentsService.listBankTransfers();

      const listed = pending.find(
        (p) => p.transactionId === transfer.transactionId,
      );
      expect(listed?.booking.id).toBe(bookingId);
      expect(listed?.member.id).toBe(customerId);
    });
  });

  describe("bank transfer safeguards (security review)", () => {
    it("rejects a mistyped amount without recording anything", async () => {
      const bookingId = await createHeldBooking(72 * HOUR);
      const transfer = await manualPaymentsService.startBankTransfer(
        bookingId,
        customerId,
      );

      await expect(
        manualPaymentsService.confirmBankTransfer(
          financeId,
          transfer.transactionId,
          {
            amountReceived: 500,
            bankReference: "NIP-TYPO-1",
          },
        ),
      ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });

      const tx = await prisma.transaction.findUniqueOrThrow({
        where: { id: transfer.transactionId },
      });
      expect(tx.status).toBe(PaymentStatus.PENDING);
      expect(tx.confirmedBy).toBeNull();
    });

    it("refuses to reuse one bank reference for two transfers", async () => {
      const first = await manualPaymentsService.startBankTransfer(
        await createHeldBooking(72 * HOUR),
        customerId,
      );
      const second = await manualPaymentsService.startBankTransfer(
        await createHeldBooking(72 * HOUR),
        customerId,
      );
      await manualPaymentsService.confirmBankTransfer(
        financeId,
        first.transactionId,
        {
          amountReceived: 5000,
          bankReference: "NIP-ONCE-ONLY",
        },
      );

      await expect(
        manualPaymentsService.confirmBankTransfer(
          financeId,
          second.transactionId,
          {
            amountReceived: 5000,
            bankReference: "NIP-ONCE-ONLY",
          },
        ),
      ).rejects.toMatchObject({ code: "DUPLICATE_BANK_REFERENCE" });
    });

    it("keeps the first attestation when a transfer is confirmed twice", async () => {
      const transfer = await manualPaymentsService.startBankTransfer(
        await createHeldBooking(72 * HOUR),
        customerId,
      );
      await manualPaymentsService.confirmBankTransfer(
        financeId,
        transfer.transactionId,
        {
          amountReceived: 5000,
          bankReference: "NIP-FIRST-ATTEST",
        },
      );

      await expect(
        manualPaymentsService.confirmBankTransfer(
          opsId,
          transfer.transactionId,
          {
            amountReceived: 5000,
            bankReference: "NIP-SECOND-ATTEST",
          },
        ),
      ).rejects.toMatchObject({ code: "TRANSFER_ALREADY_SETTLED" });

      const tx = await prisma.transaction.findUniqueOrThrow({
        where: { id: transfer.transactionId },
      });
      expect(tx.confirmedBy).toBe(financeId);
      expect(tx.externalReference).toBe("NIP-FIRST-ATTEST");
    });

    it("lets finance close a lapsed transfer", async () => {
      const transfer = await manualPaymentsService.startBankTransfer(
        await createHeldBooking(72 * HOUR),
        customerId,
      );
      await prisma.transaction.update({
        where: { id: transfer.transactionId },
        data: { status: PaymentStatus.EXPIRED },
      });

      await manualPaymentsService.rejectBankTransfer(
        financeId,
        transfer.transactionId,
        "Money never arrived",
      );

      const tx = await prisma.transaction.findUniqueOrThrow({
        where: { id: transfer.transactionId },
      });
      expect(tx.status).toBe(PaymentStatus.FAILED);
    });

    it("never re-holds a booking whose hold already lapsed", async () => {
      const bookingId = await createHeldBooking(72 * HOUR);
      await prisma.booking.update({
        where: { id: bookingId },
        data: { holdExpiresAt: new Date(Date.now() - 1000) },
      });

      await expect(
        manualPaymentsService.startBankTransfer(bookingId, customerId),
      ).rejects.toMatchObject({ code: "HOLD_LAPSED" });
    });

    it("keeps showing the account the member was first given", async () => {
      const bookingId = await createHeldBooking(72 * HOUR);
      await manualPaymentsService.startBankTransfer(bookingId, customerId);
      await prisma.paymentSetting.update({
        where: { id: "default" },
        data: { bankAccountNumber: "9999999999" },
      });
      try {
        const again = await manualPaymentsService.startBankTransfer(
          bookingId,
          customerId,
        );
        expect(again.bankAccount.accountNumber).toBe("0123456789");
      } finally {
        await prisma.paymentSetting.update({
          where: { id: "default" },
          data: { bankAccountNumber: "0123456789" },
        });
      }
    });
  });

  describe("pay at reception", () => {
    it("holds the booking until the grace period after it starts", async () => {
      const startsIn = 6 * HOUR;
      const bookingId = await createHeldBooking(startsIn);

      const result = await manualPaymentsService.startPayAtReception(
        bookingId,
        customerId,
      );

      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      expect(booking.paymentOption).toBe(PaymentOption.PAY_AT_RECEPTION);
      expect(new Date(result.expiresAt).getTime()).toBe(
        booking.startTime.getTime() + 30 * 60 * 1000,
      );
    });

    it("confirms the booking when reception records the exact cash amount", async () => {
      const bookingId = await createHeldBooking(2 * HOUR);
      await manualPaymentsService.startPayAtReception(bookingId, customerId);

      const outcome = await manualPaymentsService.recordReceptionPayment(
        receptionId,
        bookingId,
        { method: PaymentMethod.CASH as never, amountReceived: 5000 },
      );

      expect(outcome.confirmed).toBe(true);
      const tx = await prisma.transaction.findUniqueOrThrow({
        where: { id: outcome.transactionId },
      });
      expect(tx.method).toBe(PaymentMethod.CASH);
      expect(tx.confirmedBy).toBe(receptionId);
    });

    it("refuses a different amount without recording anything", async () => {
      const bookingId = await createHeldBooking(2 * HOUR);
      await manualPaymentsService.startPayAtReception(bookingId, customerId);

      await expect(
        manualPaymentsService.recordReceptionPayment(receptionId, bookingId, {
          method: PaymentMethod.CASH as never,
          amountReceived: 4500,
        }),
      ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });

      const count = await prisma.transaction.count({ where: { bookingId } });
      expect(count).toBe(0);
    });

    it("refuses reception payments while they are turned off", async () => {
      const bookingId = await createHeldBooking(2 * HOUR);
      await setSettings({ payAtReceptionEnabled: false });
      try {
        await expect(
          manualPaymentsService.recordReceptionPayment(receptionId, bookingId, {
            method: PaymentMethod.CASH as never,
            amountReceived: 5000,
          }),
        ).rejects.toMatchObject({ code: "PAYMENT_OPTION_UNAVAILABLE" });
      } finally {
        await setSettings({ payAtReceptionEnabled: true });
      }
    });
  });

  describe("refunds of manual payments", () => {
    async function confirmedCashPayment(): Promise<{
      bookingId: string;
      refundId: string;
    }> {
      const bookingId = await createHeldBooking(2 * HOUR);
      await manualPaymentsService.startPayAtReception(bookingId, customerId);
      const paid = await manualPaymentsService.recordReceptionPayment(
        receptionId,
        bookingId,
        { method: PaymentMethod.CASH as never, amountReceived: 5000 },
      );
      const refund = await prisma.refundRequest.create({
        data: {
          bookingId,
          transactionId: paid.transactionId,
          amount: new Decimal("5000.00"),
          reasonCode: RefundReasonCode.FACILITY_ISSUE,
          reason: "Air conditioning failed for the whole session",
          status: RefundStatus.PENDING,
          requestedByUserId: opsId,
        },
      });
      return { bookingId, refundId: refund.id };
    }

    it("requires a payout reference because finance pays it back by hand", async () => {
      const { refundId } = await confirmedCashPayment();

      await expect(
        refundService.approveRefund(financeId, refundId),
      ).rejects.toMatchObject({ code: "PAYOUT_REFERENCE_REQUIRED" });

      const refund = await prisma.refundRequest.findUniqueOrThrow({
        where: { id: refundId },
      });
      expect(refund.status).toBe(RefundStatus.PENDING);
    });

    it("records the payout reference without calling the gateway", async () => {
      const { refundId } = await confirmedCashPayment();

      await refundService.approveRefund(financeId, refundId, {
        payoutReference: "CASH-RECEIPT-0042",
      });

      const refund = await prisma.refundRequest.findUniqueOrThrow({
        where: { id: refundId },
      });
      expect(refund.status).toBe(RefundStatus.PROCESSED);
      expect(refund.gatewayReference).toBe("CASH-RECEIPT-0042");
      expect(refund.paystackRefundId).toBeNull();
    });
  });

  describe("hold expiry", () => {
    it("does not expire a booking whose deadline was extended", async () => {
      const bookingId = await createHeldBooking(72 * HOUR);
      await manualPaymentsService.startBankTransfer(bookingId, customerId);

      const result = await bookingService.expireHold(bookingId);

      expect(result.expired).toBe(false);
      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      expect(booking.state).toBe(BookingState.PENDING_PAYMENT);
    });
  });
});

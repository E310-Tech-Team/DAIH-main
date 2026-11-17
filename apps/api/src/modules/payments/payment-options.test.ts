import { describe, it, expect } from "vitest";
import { PaymentOption } from "@daih/types";
import {
  DEFAULT_PAYMENT_SETTINGS,
  MIN_TRANSFER_WINDOW_MINUTES,
  bankTransferDeadline,
  receptionDeadline,
  resolveAvailableOptions,
  validatePaymentSettings,
  type PaymentSettingsValues,
} from "./payment-options.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = new Date("2026-11-17T09:00:00.000Z");

const BANK_DETAILS = {
  bankName: "Example Bank",
  bankAccountNumber: "0123456789",
  bankAccountName: "DAIH Innovation Hub",
};

const withBank: PaymentSettingsValues = {
  ...DEFAULT_PAYMENT_SETTINGS,
  ...BANK_DETAILS,
};

describe("resolveAvailableOptions", () => {
  it("offers only Paystack with the default settings and a configured key", () => {
    const options = resolveAvailableOptions(DEFAULT_PAYMENT_SETTINGS, true);

    expect(options).toEqual([{ option: PaymentOption.PAYSTACK }]);
  });

  it("hides Paystack while the server has no real key", () => {
    const options = resolveAvailableOptions(DEFAULT_PAYMENT_SETTINGS, false);

    expect(options).toEqual([]);
  });

  it("offers bank transfer with the account details once enabled", () => {
    const options = resolveAvailableOptions(
      { ...withBank, bankTransferEnabled: true },
      true,
    );

    expect(options).toContainEqual({
      option: PaymentOption.BANK_TRANSFER,
      bankAccount: {
        bankName: "Example Bank",
        accountNumber: "0123456789",
        accountName: "DAIH Innovation Hub",
      },
      transferWindowHours: 24,
    });
  });

  it("never offers bank transfer without complete account details", () => {
    const options = resolveAvailableOptions(
      {
        ...DEFAULT_PAYMENT_SETTINGS,
        bankTransferEnabled: true,
        bankName: "Example Bank",
      },
      true,
    );

    expect(options.map((o) => o.option)).not.toContain(
      PaymentOption.BANK_TRANSFER,
    );
  });

  it("offers pay at reception with its grace period once enabled", () => {
    const options = resolveAvailableOptions(
      {
        ...DEFAULT_PAYMENT_SETTINGS,
        payAtReceptionEnabled: true,
        receptionGraceMinutes: 45,
      },
      true,
    );

    expect(options).toContainEqual({
      option: PaymentOption.PAY_AT_RECEPTION,
      graceMinutes: 45,
    });
  });

  it("lists options in a stable order: online, bank transfer, reception", () => {
    const options = resolveAvailableOptions(
      { ...withBank, bankTransferEnabled: true, payAtReceptionEnabled: true },
      true,
    );

    expect(options.map((o) => o.option)).toEqual([
      PaymentOption.PAYSTACK,
      PaymentOption.BANK_TRANSFER,
      PaymentOption.PAY_AT_RECEPTION,
    ]);
  });
});

describe("bankTransferDeadline", () => {
  it("holds for the configured window when the booking starts later", () => {
    const start = new Date(NOW.getTime() + 72 * HOUR);

    const deadline = bankTransferDeadline(NOW, start, 24);

    expect(deadline).toEqual(new Date(NOW.getTime() + 24 * HOUR));
  });

  it("never holds past the booking start", () => {
    const start = new Date(NOW.getTime() + 5 * HOUR);

    const deadline = bankTransferDeadline(NOW, start, 24);

    expect(deadline).toEqual(start);
  });

  it("allows exactly the minimum window", () => {
    const start = new Date(
      NOW.getTime() + MIN_TRANSFER_WINDOW_MINUTES * MINUTE,
    );

    const deadline = bankTransferDeadline(NOW, start, 24);

    expect(deadline).toEqual(start);
  });

  it("refuses when less than the minimum window remains", () => {
    const start = new Date(
      NOW.getTime() + (MIN_TRANSFER_WINDOW_MINUTES - 1) * MINUTE,
    );

    const deadline = bankTransferDeadline(NOW, start, 24);

    expect(deadline).toBeNull();
  });
});

describe("receptionDeadline", () => {
  it("holds until the grace period after the start", () => {
    const start = new Date(NOW.getTime() + 2 * HOUR);

    const deadline = receptionDeadline(NOW, start, 30);

    expect(deadline).toEqual(new Date(start.getTime() + 30 * MINUTE));
  });

  it("still allows a booking that started within the grace period", () => {
    const start = new Date(NOW.getTime() - 10 * MINUTE);

    const deadline = receptionDeadline(NOW, start, 30);

    expect(deadline).toEqual(new Date(start.getTime() + 30 * MINUTE));
  });

  it("refuses once the grace period has passed", () => {
    const start = new Date(NOW.getTime() - 31 * MINUTE);

    const deadline = receptionDeadline(NOW, start, 30);

    expect(deadline).toBeNull();
  });
});

describe("validatePaymentSettings", () => {
  it("accepts the defaults", () => {
    expect(validatePaymentSettings(DEFAULT_PAYMENT_SETTINGS)).toEqual([]);
  });

  it("accepts bank transfer with complete details", () => {
    const errors = validatePaymentSettings({
      ...withBank,
      bankTransferEnabled: true,
    });

    expect(errors).toEqual([]);
  });

  it("requires full bank details before bank transfer can be enabled", () => {
    const errors = validatePaymentSettings({
      ...DEFAULT_PAYMENT_SETTINGS,
      bankTransferEnabled: true,
      bankName: "Example Bank",
    });

    expect(errors.join(" ")).toMatch(
      /bank name, account number and account name/i,
    );
  });

  it("rejects an account number that is not 10 digits", () => {
    const errors = validatePaymentSettings({
      ...withBank,
      bankAccountNumber: "01234-5678",
    });

    expect(errors.join(" ")).toMatch(/10 digits/);
  });

  it.each([0, 169, 1.5])("rejects a transfer window of %s hours", (hours) => {
    const errors = validatePaymentSettings({
      ...DEFAULT_PAYMENT_SETTINGS,
      transferWindowHours: hours,
    });

    expect(errors.join(" ")).toMatch(/transfer window/i);
  });

  it.each([-1, 241, 2.5])(
    "rejects a reception grace period of %s minutes",
    (minutes) => {
      const errors = validatePaymentSettings({
        ...DEFAULT_PAYMENT_SETTINGS,
        receptionGraceMinutes: minutes,
      });

      expect(errors.join(" ")).toMatch(/grace period/i);
    },
  );

  it("rejects turning every payment option off", () => {
    const errors = validatePaymentSettings({
      ...DEFAULT_PAYMENT_SETTINGS,
      paystackEnabled: false,
    });

    expect(errors.join(" ")).toMatch(/at least one/i);
  });
});

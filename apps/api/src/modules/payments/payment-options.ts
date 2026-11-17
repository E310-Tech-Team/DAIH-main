import {
  AvailablePaymentOption,
  BankAccountDetails,
  PaymentOption,
} from "@daih/types";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** How long a bank-transfer booking may be held while finance checks the statement. */
export const TRANSFER_WINDOW_HOURS = { min: 1, max: 168 } as const;
/** How long after its start a pay-at-reception booking may be held unpaid. */
export const RECEPTION_GRACE_MINUTES = { min: 0, max: 240 } as const;
/** Bank transfer is not offered when less than this remains: finance could not confirm in time. */
export const MIN_TRANSFER_WINDOW_MINUTES = 30;
/** Nigerian (NUBAN) account numbers are exactly 10 digits. */
export const NUBAN_PATTERN = /^\d{10}$/;

export interface PaymentSettingsValues {
  paystackEnabled: boolean;
  bankTransferEnabled: boolean;
  payAtReceptionEnabled: boolean;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  transferWindowHours: number;
  receptionGraceMinutes: number;
}

/** Matches the column defaults in the payment_settings migration. */
export const DEFAULT_PAYMENT_SETTINGS: Readonly<PaymentSettingsValues> =
  Object.freeze({
    paystackEnabled: true,
    bankTransferEnabled: false,
    payAtReceptionEnabled: false,
    bankName: null,
    bankAccountNumber: null,
    bankAccountName: null,
    transferWindowHours: 24,
    receptionGraceMinutes: 30,
  });

/** The Hub's account for manual transfers, or null until all three details are set. */
export function bankAccountOf(
  settings: PaymentSettingsValues,
): BankAccountDetails | null {
  const { bankName, bankAccountNumber, bankAccountName } = settings;
  if (!bankName || !bankAccountNumber || !bankAccountName) return null;
  return {
    bankName,
    accountNumber: bankAccountNumber,
    accountName: bankAccountName,
  };
}

/** The checkout options a member may choose, in display order. */
export function resolveAvailableOptions(
  settings: PaymentSettingsValues,
  paystackConfigured: boolean,
): AvailablePaymentOption[] {
  const bankAccount = bankAccountOf(settings);
  const candidates: Array<AvailablePaymentOption | null> = [
    settings.paystackEnabled && paystackConfigured
      ? { option: PaymentOption.PAYSTACK }
      : null,
    settings.bankTransferEnabled && bankAccount
      ? {
          option: PaymentOption.BANK_TRANSFER,
          bankAccount,
          transferWindowHours: settings.transferWindowHours,
        }
      : null,
    settings.payAtReceptionEnabled
      ? {
          option: PaymentOption.PAY_AT_RECEPTION,
          graceMinutes: settings.receptionGraceMinutes,
        }
      : null,
  ];
  return candidates.filter((o): o is AvailablePaymentOption => o !== null);
}

/**
 * When a bank-transfer hold lapses: the configured window, but never after the
 * booking starts. Null when too little time remains for finance to confirm.
 */
export function bankTransferDeadline(
  now: Date,
  startTime: Date,
  windowHours: number,
): Date | null {
  const deadline = Math.min(
    now.getTime() + windowHours * HOUR_MS,
    startTime.getTime(),
  );
  const remaining = deadline - now.getTime();
  return remaining >= MIN_TRANSFER_WINDOW_MINUTES * MINUTE_MS
    ? new Date(deadline)
    : null;
}

/**
 * When a pay-at-reception hold lapses: the grace period after the booking
 * starts. Null once that has already passed.
 */
export function receptionDeadline(
  now: Date,
  startTime: Date,
  graceMinutes: number,
): Date | null {
  const deadline = startTime.getTime() + graceMinutes * MINUTE_MS;
  return deadline > now.getTime() ? new Date(deadline) : null;
}

function isIntegerInRange(
  value: number,
  range: { min: number; max: number },
): boolean {
  return Number.isInteger(value) && value >= range.min && value <= range.max;
}

/** Problems with a complete settings record, as user-facing messages; empty when valid. */
export function validatePaymentSettings(
  settings: PaymentSettingsValues,
): string[] {
  const noOptionEnabled =
    !settings.paystackEnabled &&
    !settings.bankTransferEnabled &&
    !settings.payAtReceptionEnabled;

  const problems: Array<string | null> = [
    isIntegerInRange(settings.transferWindowHours, TRANSFER_WINDOW_HOURS)
      ? null
      : `The transfer window must be a whole number of hours between ${TRANSFER_WINDOW_HOURS.min} and ${TRANSFER_WINDOW_HOURS.max}.`,
    isIntegerInRange(settings.receptionGraceMinutes, RECEPTION_GRACE_MINUTES)
      ? null
      : `The reception grace period must be a whole number of minutes between ${RECEPTION_GRACE_MINUTES.min} and ${RECEPTION_GRACE_MINUTES.max}.`,
    settings.bankAccountNumber !== null &&
    !NUBAN_PATTERN.test(settings.bankAccountNumber)
      ? "The account number must be exactly 10 digits."
      : null,
    settings.bankTransferEnabled && !bankAccountOf(settings)
      ? "Enter the bank name, account number and account name before turning on bank transfer."
      : null,
    noOptionEnabled ? "Keep at least one payment option turned on." : null,
  ];
  return problems.filter((p): p is string => p !== null);
}

import type {
  PaymentSettingsDTO,
  UpdatePaymentSettingsInput,
} from "@daih/types";

/** Mirrors the API's limits for payment settings. */
export const TRANSFER_WINDOW_HOURS = { min: 1, max: 168 } as const;
export const RECEPTION_GRACE_MINUTES = { min: 0, max: 240 } as const;
export const BANK_TEXT_MAX_LENGTH = 100;
export const ACCOUNT_NUMBER_LENGTH = 10;

/** Nigerian (NUBAN) account numbers are exactly 10 digits. */
const ACCOUNT_NUMBER_PATTERN = /^\d{10}$/;
/** Bank and account names: letters, digits, spaces and basic punctuation (as the API accepts). */
const PRINTABLE_NAME_PATTERN = /^[\p{L}\p{N} .,'&()\-/]+$/u;
const WHOLE_NUMBER_PATTERN = /^\d+$/;

const BANK_DETAIL_FIELDS: ReadonlyArray<keyof UpdatePaymentSettingsInput> = [
  "bankName",
  "bankAccountNumber",
  "bankAccountName",
];

interface WholeNumberRange {
  min: number;
  max: number;
}

/** The settings form as typed: text inputs hold strings until saved. */
export interface PaymentSettingsDraft {
  paystackEnabled: boolean;
  bankTransferEnabled: boolean;
  payAtReceptionEnabled: boolean;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  transferWindowHours: string;
  receptionGraceMinutes: string;
}

export type DraftField = keyof PaymentSettingsDraft;
export type DraftErrors = Partial<Record<DraftField, string>>;

export function toDraft(settings: PaymentSettingsDTO): PaymentSettingsDraft {
  return {
    paystackEnabled: settings.paystackEnabled,
    bankTransferEnabled: settings.bankTransferEnabled,
    payAtReceptionEnabled: settings.payAtReceptionEnabled,
    bankName: settings.bankName ?? "",
    bankAccountNumber: settings.bankAccountNumber ?? "",
    bankAccountName: settings.bankAccountName ?? "",
    transferWindowHours: String(settings.transferWindowHours),
    receptionGraceMinutes: String(settings.receptionGraceMinutes),
  };
}

function isWholeNumberInRange(value: string, range: WholeNumberRange): boolean {
  const trimmed = value.trim();
  if (!WHOLE_NUMBER_PATTERN.test(trimmed)) return false;
  const amount = Number(trimmed);
  return amount >= range.min && amount <= range.max;
}

function nameProblem(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > BANK_TEXT_MAX_LENGTH) {
    return `The ${label} can be at most ${BANK_TEXT_MAX_LENGTH} characters.`;
  }
  return PRINTABLE_NAME_PATTERN.test(trimmed)
    ? null
    : `Use only letters, digits, spaces and . , ' & ( ) - / in the ${label}.`;
}

function accountNumberProblem(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" || ACCOUNT_NUMBER_PATTERN.test(trimmed)
    ? null
    : `The account number must be exactly ${ACCOUNT_NUMBER_LENGTH} digits.`;
}

function rangeProblem(
  value: string,
  range: WholeNumberRange,
  unit: string,
): string | null {
  return isWholeNumberInRange(value, range)
    ? null
    : `Enter a whole number of ${unit} from ${range.min} to ${range.max}.`;
}

/**
 * Problems with individual fields, keyed by field; empty when all are valid.
 * Rules that span fields (bank details before turning on transfers, at least
 * one option on) are left to the API, whose message is shown as returned.
 */
export function validateDraft(draft: PaymentSettingsDraft): DraftErrors {
  const checks: Array<[DraftField, string | null]> = [
    ["bankName", nameProblem(draft.bankName, "bank name")],
    ["bankAccountNumber", accountNumberProblem(draft.bankAccountNumber)],
    ["bankAccountName", nameProblem(draft.bankAccountName, "account name")],
    [
      "transferWindowHours",
      rangeProblem(draft.transferWindowHours, TRANSFER_WINDOW_HOURS, "hours"),
    ],
    [
      "receptionGraceMinutes",
      rangeProblem(
        draft.receptionGraceMinutes,
        RECEPTION_GRACE_MINUTES,
        "minutes",
      ),
    ],
  ];
  return Object.fromEntries(
    checks.filter((check): check is [DraftField, string] => check[1] !== null),
  ) as DraftErrors;
}

/** Blank text clears a saved value, as the API expects. */
function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Only the fields that differ from what is saved, ready for `updateSettings`. */
export function changedSettings(
  saved: PaymentSettingsDTO,
  draft: PaymentSettingsDraft,
): UpdatePaymentSettingsInput {
  const next: Required<UpdatePaymentSettingsInput> = {
    paystackEnabled: draft.paystackEnabled,
    bankTransferEnabled: draft.bankTransferEnabled,
    payAtReceptionEnabled: draft.payAtReceptionEnabled,
    bankName: textOrNull(draft.bankName),
    bankAccountNumber: textOrNull(draft.bankAccountNumber),
    bankAccountName: textOrNull(draft.bankAccountName),
    transferWindowHours: Number(draft.transferWindowHours.trim()),
    receptionGraceMinutes: Number(draft.receptionGraceMinutes.trim()),
  };
  const changedKeys = (Object.keys(next) as Array<keyof typeof next>).filter(
    (key) => next[key] !== saved[key],
  );
  return Object.fromEntries(
    changedKeys.map((key) => [key, next[key]]),
  ) as UpdatePaymentSettingsInput;
}

/** True when an update touches the bank account (which emails finance and super admins). */
export function changesBankDetails(
  changes: UpdatePaymentSettingsInput,
): boolean {
  return BANK_DETAIL_FIELDS.some((field) => field in changes);
}

export function withoutError(
  errors: DraftErrors,
  field: DraftField,
): DraftErrors {
  if (!(field in errors)) return errors;
  return Object.fromEntries(
    Object.entries(errors).filter(([key]) => key !== field),
  ) as DraftErrors;
}

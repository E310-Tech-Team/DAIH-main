import {
  PaymentMethod,
  PaymentOption,
  UserRole,
  type ReceptionPaymentMethod,
  type VerifyAccessPassResponse,
} from "@daih/types";

/** What reception can collect, as attached to an UNPAID verification result. */
export type PaymentDue = NonNullable<VerifyAccessPassResponse["paymentDue"]>;

/**
 * Roles that may record cash or POS at the desk. Mirrors `requireRoles` on
 * POST /payments/reception/:bookingId; the API is the real gate.
 */
const RECEPTION_PAYMENT_ROLES: ReadonlySet<UserRole> = new Set([
  UserRole.RECEPTION_OFFICER,
  UserRole.OPERATIONS_ADMIN,
  UserRole.SUPER_ADMIN,
]);

export function canRoleRecordPayment(role: UserRole): boolean {
  return RECEPTION_PAYMENT_ROLES.has(role);
}

/** "₦12,500.00": thousands separators and 2 decimals. Other currencies keep their code. */
export function formatAmountDue(amount: number, currency: string): string {
  const figure = amount.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const code = currency.trim().toUpperCase() || "NGN";
  return code === "NGN" ? `₦${figure}` : `${code} ${figure}`;
}

/** How the member chose to pay at checkout, in front-desk language. */
export function describePaymentChoice(option: PaymentOption | null): string {
  switch (option) {
    case PaymentOption.PAY_AT_RECEPTION:
      return "Chose to pay at reception";
    case PaymentOption.BANK_TRANSFER:
      return "Chose bank transfer — not yet confirmed by finance";
    default:
      // Paystack, or no option chosen yet
      return "Online payment not completed";
  }
}

/** "in cash" or "by POS, receipt 12345". */
export function describeTender(
  method: ReceptionPaymentMethod,
  receiptNumber: string,
): string {
  return method === PaymentMethod.CASH
    ? "in cash"
    : `by POS, receipt ${receiptNumber}`;
}

// POS receipt numbers follow the API's RecordReceptionPaymentBodySchema.
export const RECEIPT_MAX_LENGTH = 100;
const RECEIPT_MIN_LENGTH = 3;
const RECEIPT_PATTERN = /^[A-Za-z0-9 \-_/.:#]+$/;

/** True once a character outside letters, digits and - _ / . : # is typed. */
export function hasDisallowedReceiptCharacters(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== "" && !RECEIPT_PATTERN.test(trimmed);
}

export function isValidReceiptNumber(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length >= RECEIPT_MIN_LENGTH &&
    trimmed.length <= RECEIPT_MAX_LENGTH &&
    RECEIPT_PATTERN.test(trimmed)
  );
}

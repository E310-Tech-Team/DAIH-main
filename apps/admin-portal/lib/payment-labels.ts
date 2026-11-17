import { PaymentMethod, type ManualPaymentMethod } from "@daih/types";

const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  [PaymentMethod.PAYSTACK]: "Paystack",
  [PaymentMethod.SUBSCRIPTION_CREDIT]: "Subscription credit",
  [PaymentMethod.BANK_TRANSFER]: "Bank transfer",
  [PaymentMethod.POS_TERMINAL]: "POS",
  [PaymentMethod.CASH]: "Cash",
};

/** Payments recorded by staff rather than a gateway; their refunds are paid back by hand. */
const MANUAL_PAYMENT_METHODS: ReadonlySet<string> = new Set<string>([
  PaymentMethod.BANK_TRANSFER,
  PaymentMethod.CASH,
  PaymentMethod.POS_TERMINAL,
]);

function isKnownPaymentMethod(value: string): value is PaymentMethod {
  return Object.prototype.hasOwnProperty.call(PAYMENT_METHOD_LABELS, value);
}

/** A readable name for a payment method, e.g. "Bank transfer" for BANK_TRANSFER. */
export function paymentMethodLabel(
  method: string | null | undefined,
): string | null {
  if (!method) return null;
  if (isKnownPaymentMethod(method)) return PAYMENT_METHOD_LABELS[method];
  const words = method.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** True for bank transfer, cash and POS payments. */
export function isManualPaymentMethod(
  method: string | null | undefined,
): method is ManualPaymentMethod {
  return !!method && MANUAL_PAYMENT_METHODS.has(method);
}

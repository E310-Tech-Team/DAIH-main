export enum PaymentStatus {
  PENDING = "PENDING",
  SUCCESSFUL = "SUCCESSFUL",
  FAILED = "FAILED",
  REFUNDED = "REFUNDED",
  PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED",
  ABANDONED = "ABANDONED",
  EXPIRED = "EXPIRED",
  FLAGGED_MISMATCH = "FLAGGED_MISMATCH",
  REQUIRES_RECONCILIATION = "REQUIRES_RECONCILIATION",
}

export enum PaymentMethod {
  PAYSTACK = "PAYSTACK",
  SUBSCRIPTION_CREDIT = "SUBSCRIPTION_CREDIT",
  BANK_TRANSFER = "BANK_TRANSFER",
  POS_TERMINAL = "POS_TERMINAL",
  CASH = "CASH",
}

/** How a member chose to pay for a booking at checkout. */
export enum PaymentOption {
  PAYSTACK = "PAYSTACK",
  BANK_TRANSFER = "BANK_TRANSFER",
  PAY_AT_RECEPTION = "PAY_AT_RECEPTION",
}

/** Methods recorded by staff rather than confirmed by a payment gateway. */
export type ManualPaymentMethod =
  PaymentMethod.BANK_TRANSFER | PaymentMethod.CASH | PaymentMethod.POS_TERMINAL;

/** Tenders reception can record at the desk. */
export type ReceptionPaymentMethod =
  PaymentMethod.CASH | PaymentMethod.POS_TERMINAL;

export interface BankAccountDetails {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

/** One option a member can choose at checkout. Only enabled, configured options are offered. */
export type AvailablePaymentOption =
  | { option: PaymentOption.PAYSTACK }
  | {
      option: PaymentOption.BANK_TRANSFER;
      bankAccount: BankAccountDetails;
      transferWindowHours: number;
    }
  | { option: PaymentOption.PAY_AT_RECEPTION; graceMinutes: number };

export interface PaymentOptionsResponse {
  options: AvailablePaymentOption[];
}

export interface OnlineCheckoutResult {
  option: PaymentOption.PAYSTACK;
  authorization_url: string;
  access_code?: string;
  reference: string;
  transactionId?: string;
  amount: number;
  currency: string;
}

export interface BankTransferCheckoutResult {
  option: PaymentOption.BANK_TRANSFER;
  /** Put this in the transfer narration so finance can match the payment. */
  reference: string;
  transactionId: string;
  amount: number;
  currency: string;
  /** ISO-8601; the booking is released if the transfer is not confirmed by then. */
  expiresAt: string;
  bankAccount: BankAccountDetails;
}

export interface ReceptionCheckoutResult {
  option: PaymentOption.PAY_AT_RECEPTION;
  amount: number;
  currency: string;
  /** ISO-8601; the booking is released if it is not paid at reception by then. */
  expiresAt: string;
}

/** Result of POST /payments/initialize/:bookingId, by chosen option. */
export type InitializePaymentResult =
  OnlineCheckoutResult | BankTransferCheckoutResult | ReceptionCheckoutResult;

export interface PaymentSettingsDTO {
  paystackEnabled: boolean;
  bankTransferEnabled: boolean;
  payAtReceptionEnabled: boolean;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  transferWindowHours: number;
  receptionGraceMinutes: number;
  /** Read-only: whether the server has a real Paystack secret key. */
  paystackConfigured: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export type UpdatePaymentSettingsInput = Partial<
  Omit<PaymentSettingsDTO, "paystackConfigured" | "updatedAt" | "updatedBy">
>;

export interface ConfirmBankTransferInput {
  /** Naira actually received, as shown on the bank statement. */
  amountReceived: number;
  /** The bank's transaction or session reference for the incoming transfer. */
  bankReference: string;
  note?: string;
  /** Set when the member genuinely sent a different amount: it is recorded for reconciliation, not confirmed. */
  allowAmountMismatch?: boolean;
}

export interface RejectBankTransferInput {
  reason: string;
}

export interface RecordReceptionPaymentInput {
  method: ReceptionPaymentMethod;
  amountReceived: number;
  /** POS receipt or terminal reference; required for POS payments. */
  receiptReference?: string;
}

/** What happened when staff confirmed a transfer or recorded a reception payment. */
export interface ManualPaymentOutcome {
  status: PaymentStatus;
  /** True when the booking is now confirmed and its QR pass issued. */
  confirmed: boolean;
  reference: string;
  message: string;
  transactionId: string;
  bookingId: string;
}

/** A bank transfer waiting for finance to confirm it against the bank statement. */
export interface PendingBankTransfer {
  transactionId: string;
  reference: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  createdAt: string;
  /** When the booking hold lapses (null once the booking has expired). */
  expiresAt: string | null;
  member: {
    id: string;
    name: string;
    email: string;
    clientId: string;
  };
  booking: {
    id: string;
    reference: string;
    resourceName: string;
    startTime: string;
    endTime: string;
    state: string;
  };
}

export enum TransactionType {
  PAYMENT = "PAYMENT",
  REFUND = "REFUND",
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface InvoiceDTO {
  id: string;
  invoiceNumber: string;
  transactionId: string;
  bookingId: string;
  userId: string;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  lineItems: InvoiceLineItem[];
  issuedAt: string;
  customerName: string;
  customerEmail: string;
  customerClientId: string;
  resourceName: string;
  bookingReference: string;
  createdAt: string;
}

export interface PaymentTransaction {
  id: string;
  reference: string;
  bookingId: string;
  userId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  method: PaymentMethod;
  paystackReference?: string | null;
  paystackChannel?: string | null;
  gatewayResponse?: any;
  webhookEventId?: string | null;
  webhookReceivedAt?: string | null;
  paidAt?: string | null;
  failedAt?: string | null;
  refundedAt?: string | null;
  refundAmount?: number | null;
  refundReason?: string | null;
  refundedBy?: string | null;
  /** Manual payments: the staff member who confirmed or recorded it. */
  confirmedBy?: string | null;
  /** Manual payments: the bank transfer reference or POS receipt number. */
  externalReference?: string | null;
  createdAt: string;
  updatedAt: string;
  booking?: {
    id: string;
    reference: string;
    resourceName?: string;
    startTime: string;
    endTime: string;
    state: string;
  };
  invoice?: InvoiceDTO | null;
}

export interface PaystackInitializeResponse {
  authorization_url: string;
  access_code: string;
  reference: string;
  transactionId?: string;
}

export interface PaystackWebhookPayload {
  event: string;
  data: {
    id: number;
    domain?: string;
    status: string;
    reference: string;
    amount: number; // in kobo
    message?: string | null;
    gateway_response?: string | null;
    paid_at?: string | null;
    created_at?: string | null;
    channel?: string | null;
    currency: string;
    ip_address?: string | null;
    metadata?: any;
    log?: any;
    fees?: number | null;
    customer: {
      id?: number;
      first_name?: string | null;
      last_name?: string | null;
      email: string;
      customer_code?: string;
      phone?: string | null;
      metadata?: any;
      risk_action?: string;
    };
    authorization?: {
      authorization_code?: string;
      bin?: string;
      last4?: string;
      exp_month?: string;
      exp_year?: string;
      card_type?: string;
      bank?: string;
      country_code?: string;
      brand?: string;
      account_name?: string;
    } | null;
    plan?: any;
  };
}

export enum RefundStatus {
  PENDING = "PENDING",
  INFO_REQUESTED = "INFO_REQUESTED",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  PROCESSED = "PROCESSED",
  FAILED = "FAILED",
  PROCESSING = "PROCESSING",
  REQUIRES_RECONCILIATION = "REQUIRES_RECONCILIATION",
}

export enum RefundReasonCode {
  FACILITY_ISSUE = "FACILITY_ISSUE",
  SERVICE_FAILURE = "SERVICE_FAILURE",
  DUPLICATE_PAYMENT = "DUPLICATE_PAYMENT",
  UNAVAILABLE_RESOURCE = "UNAVAILABLE_RESOURCE",
  CUSTOMER_DISPUTE = "CUSTOMER_DISPUTE",
  PRICE_CHANGED = "PRICE_CHANGED",
  OTHER = "OTHER",
}

export interface RaiseRefundRequestDTO {
  bookingId: string;
  reasonCode: RefundReasonCode;
  reason: string;
}

export interface RequestInfoDTO {
  question: string;
}

export interface ProvideInfoDTO {
  response: string;
}

export interface RejectRefundDTO {
  rejectionReason: string;
}

export interface RefundRequestItemDTO {
  id: string;
  bookingId: string;
  transactionId?: string | null;
  /**
   * How the refunded payment was made. Bank transfer, cash and POS refunds are
   * paid back by hand, so approving one needs a payout reference.
   */
  transactionMethod?: PaymentMethod | null;
  amount: number;
  coinsToReverse: number;
  coinsToClawback: number;
  referralCoinsToClawback: number;
  referrerId?: string | null;
  reasonCode: RefundReasonCode;
  reason: string;
  status: RefundStatus;
  requestedByUserId: string;
  reviewedByUserId?: string | null;
  rejectionReason?: string | null;
  infoRequested?: string | null;
  infoProvided?: string | null;
  paystackRefundId?: string | null;
  gatewayReference?: string | null;
  failureReason?: string | null;
  requestedAt: string;
  reviewedAt?: string | null;
  booking?: {
    id: string;
    reference: string;
    state: string;
    totalAmount: number;
    user?: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    };
  };
  requestedBy?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  };
  reviewedBy?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  };
}

export interface RefundRequestDTO {
  amount?: number;
  reason: string;
}

export interface ReconciliationDiscrepancy {
  transactionId: string;
  reference: string;
  type:
    | "AMOUNT_MISMATCH"
    | "STATUS_MISMATCH"
    | "ORPHAN_LOCAL"
    | "ORPHAN_GATEWAY"
    | "CAPACITY_CONFLICT";
  localStatus?: PaymentStatus;
  gatewayStatus?: string;
  localAmount?: number;
  gatewayAmount?: number;
  details?: string;
}

export interface ReconciliationSummary {
  period: {
    startDate: string;
    endDate: string;
  };
  totalLocalTransactions: number;
  matchedCount: number;
  discrepancyCount: number;
  totalCollected: number;
  totalRefunded: number;
  netRevenue: number;
  currency: string;
  discrepancies: ReconciliationDiscrepancy[];
}

export interface DailyPaymentSummary {
  date: string;
  totalTransactions: number;
  successfulCount: number;
  successfulAmount: number;
  failedCount: number;
  failedAmount: number;
  refundedCount: number;
  refundedAmount: number;
  pendingCount: number;
  pendingAmount: number;
  netRevenue: number;
  currency: string;
}

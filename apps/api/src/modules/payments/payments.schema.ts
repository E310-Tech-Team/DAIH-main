import { z } from "zod";
import { sanitizeString } from "../../middleware/validate.middleware.js";
import {
  PaymentStatus,
  PaymentMethod,
  PaymentOption,
  RefundStatus,
  RefundReasonCode,
} from "@daih/types";
import {
  NUBAN_PATTERN,
  RECEPTION_GRACE_MINUTES,
  TRANSFER_WINDOW_HOURS,
} from "./payment-options.js";

export const InitializePaymentParamsSchema = z.object({
  bookingId: z
    .string()
    .trim()
    .min(1, "Booking ID is required")
    .transform(sanitizeString),
});

export const InitializePaymentBodySchema = z.object({
  callbackUrl: z.string().url("Invalid callback URL").optional(),
  /** Defaults to Paystack so existing clients keep working. */
  option: z.nativeEnum(PaymentOption).optional(),
});

/** Naira with at most 2 decimal places (kobo precision). */
const nairaAmount = z
  .number({ invalid_type_error: "Amount must be a number" })
  .positive("Amount must be greater than zero")
  .max(100_000_000, "Amount is too large")
  .multipleOf(0.01, "Amount can have at most 2 decimal places");

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

export const UpdatePaymentSettingsSchema = z
  .object({
    paystackEnabled: z.boolean().optional(),
    bankTransferEnabled: z.boolean().optional(),
    payAtReceptionEnabled: z.boolean().optional(),
    bankName: optionalText(100),
    bankAccountNumber: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || NUBAN_PATTERN.test(value),
        "The account number must be exactly 10 digits",
      )
      .nullable()
      .optional(),
    bankAccountName: optionalText(100),
    transferWindowHours: z
      .number()
      .int()
      .min(TRANSFER_WINDOW_HOURS.min)
      .max(TRANSFER_WINDOW_HOURS.max)
      .optional(),
    receptionGraceMinutes: z
      .number()
      .int()
      .min(RECEPTION_GRACE_MINUTES.min)
      .max(RECEPTION_GRACE_MINUTES.max)
      .optional(),
  })
  .strict();

export const BankTransferListQuerySchema = z.object({
  status: z
    .enum([
      PaymentStatus.PENDING,
      PaymentStatus.EXPIRED,
      PaymentStatus.ABANDONED,
      PaymentStatus.FAILED,
    ])
    .default(PaymentStatus.PENDING),
});

export const ConfirmBankTransferBodySchema = z.object({
  amountReceived: nairaAmount,
  bankReference: z
    .string()
    .trim()
    .min(4, "Enter the bank's reference for this transfer")
    .max(100),
  note: z.string().trim().max(500).optional(),
});

export const RejectBankTransferBodySchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Reason must be at least 5 characters")
    .max(500),
});

export const RecordReceptionPaymentBodySchema = z
  .object({
    method: z.enum([PaymentMethod.CASH, PaymentMethod.POS_TERMINAL]),
    amountReceived: nairaAmount,
    receiptReference: z.string().trim().min(3).max(100).optional(),
  })
  .refine(
    (body) =>
      body.method !== PaymentMethod.POS_TERMINAL || !!body.receiptReference,
    {
      message: "Enter the POS receipt number",
      path: ["receiptReference"],
    },
  );

export const ApproveRefundBodySchema = z
  .object({
    /** Required for bank transfer, cash and POS refunds, which finance pays out by hand. */
    payoutReference: z.string().trim().min(3).max(100).optional(),
  })
  .default({});

export const TransactionIdParamsSchema = z.object({
  transactionId: z
    .string()
    .trim()
    .min(1, "Transaction ID is required")
    .transform(sanitizeString),
});

export const BookingIdParamsSchema = z.object({
  bookingId: z
    .string()
    .trim()
    .min(1, "Booking ID is required")
    .transform(sanitizeString),
});

export const TransactionFilterQuerySchema = z.object({
  status: z.nativeEnum(PaymentStatus).optional(),
  method: z.nativeEnum(PaymentMethod).optional(),
  search: z.string().trim().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(20),
});

export const ReconciliationQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const DailySummaryQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .optional(),
});

export const PaystackWebhookSchema = z.object({
  event: z.string().trim().min(1, "Webhook event is required"),
  data: z
    .object({
      id: z.union([z.number(), z.string()]).optional(),
      reference: z.string().optional(),
      amount: z.number().optional(),
      status: z.string().optional(),
      channel: z.string().nullable().optional(),
      paid_at: z.string().nullable().optional(),
      gateway_response: z.string().nullable().optional(),
      currency: z.string().optional(),
      metadata: z
        .union([z.record(z.unknown()), z.number(), z.string(), z.null()])
        .optional(),
    })
    .passthrough()
    .optional(),
});

// Dual-Authorization Refund Schemas
export const RaiseRefundRequestSchema = z.object({
  bookingId: z
    .string()
    .trim()
    .min(1, "Booking ID is required")
    .transform(sanitizeString),
  reasonCode: z.nativeEnum(RefundReasonCode),
  reason: z
    .string()
    .trim()
    .min(
      20,
      "Refund request reason must be at least 20 characters describing the justification",
    ),
});

export const RefundRequestIdParamsSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, "Refund request ID is required")
    .transform(sanitizeString),
});

export const RequestInfoBodySchema = z.object({
  question: z
    .string()
    .trim()
    .min(5, "Clarification question must be at least 5 characters"),
});

export const ProvideInfoBodySchema = z.object({
  response: z
    .string()
    .trim()
    .min(5, "Response clarification must be at least 5 characters"),
});

export const RejectRefundBodySchema = z.object({
  rejectionReason: z
    .string()
    .trim()
    .min(5, "Rejection reason must be at least 5 characters"),
});

export const ListRefundsQuerySchema = z.object({
  status: z.nativeEnum(RefundStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

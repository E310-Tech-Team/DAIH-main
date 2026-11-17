import express, { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import {
  requireRoles,
  requirePermission,
} from "../../middleware/rbac.middleware.js";
import { UserRole, Permission } from "@daih/types";
import {
  validateParams,
  validateBody,
  validateQuery,
} from "../../middleware/validate.middleware.js";
import { paymentsController } from "./payments.controller.js";
import { paymentOptionsController } from "./payment-options.controller.js";
import { verifyPaystackWebhookSignature } from "./webhook.verifier.js";
import {
  ApproveRefundBodySchema,
  BankTransferListQuerySchema,
  ConfirmBankTransferBodySchema,
  RecordReceptionPaymentBodySchema,
  RejectBankTransferBodySchema,
  UpdatePaymentSettingsSchema,
  InitializePaymentParamsSchema,
  InitializePaymentBodySchema,
  TransactionIdParamsSchema,
  TransactionFilterQuerySchema,
  ReconciliationQuerySchema,
  DailySummaryQuerySchema,
  RaiseRefundRequestSchema,
  RefundRequestIdParamsSchema,
  RequestInfoBodySchema,
  ProvideInfoBodySchema,
  RejectRefundBodySchema,
  ListRefundsQuerySchema,
} from "./payments.schema.js";

// Dedicated Webhook Router that preserves raw body for cryptographic HMAC verification
export const paymentsWebhookRouter = Router();

paymentsWebhookRouter.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  verifyPaystackWebhookSignature,
  paymentsController.webhook,
);

// Main Payments API Router
export const paymentsRouter = Router();

// Customer: Initialize Paystack checkout
paymentsRouter.post(
  "/initialize/:bookingId",
  authenticate,
  validateParams(InitializePaymentParamsSchema),
  validateBody(InitializePaymentBodySchema),
  paymentsController.initialize,
);

// Customer: payment options offered at checkout (registered before "/:transactionId")
paymentsRouter.get(
  "/options",
  authenticate,
  paymentOptionsController.getOptions,
);

// Reception: record cash or POS taken at the desk for an unpaid booking
paymentsRouter.post(
  "/reception/:bookingId",
  authenticate,
  requireRoles([
    UserRole.RECEPTION_OFFICER,
    UserRole.OPERATIONS_ADMIN,
    UserRole.SUPER_ADMIN,
  ]),
  validateParams(InitializePaymentParamsSchema),
  validateBody(RecordReceptionPaymentBodySchema),
  paymentOptionsController.recordReceptionPayment,
);

// Payment settings: readable by finance, operations and management; only a
// super admin may change them (the bank account is a fraud target)
paymentsRouter.get(
  "/admin/settings",
  authenticate,
  requirePermission(Permission.PAYMENTS_READ_SUMMARY),
  paymentOptionsController.getSettings,
);
paymentsRouter.put(
  "/admin/settings",
  authenticate,
  requireRoles([UserRole.SUPER_ADMIN]),
  validateBody(UpdatePaymentSettingsSchema),
  paymentOptionsController.updateSettings,
);

// Finance: bank transfers awaiting confirmation against the bank statement
paymentsRouter.get(
  "/admin/bank-transfers",
  authenticate,
  requirePermission(Permission.PAYMENTS_CONFIRM),
  validateQuery(BankTransferListQuerySchema),
  paymentOptionsController.listBankTransfers,
);
paymentsRouter.post(
  "/admin/bank-transfers/:transactionId/confirm",
  authenticate,
  requirePermission(Permission.PAYMENTS_CONFIRM),
  validateParams(TransactionIdParamsSchema),
  validateBody(ConfirmBankTransferBodySchema),
  paymentOptionsController.confirmBankTransfer,
);
paymentsRouter.post(
  "/admin/bank-transfers/:transactionId/reject",
  authenticate,
  requirePermission(Permission.PAYMENTS_CONFIRM),
  validateParams(TransactionIdParamsSchema),
  validateBody(RejectBankTransferBodySchema),
  paymentOptionsController.rejectBankTransfer,
);

// Customer: Personal Payment History
paymentsRouter.get("/history", authenticate, paymentsController.getHistory);

// Finance Officer / Admin: List all transactions with filters
paymentsRouter.get(
  "/admin/transactions",
  authenticate,
  requirePermission(Permission.PAYMENTS_READ_FULL),
  validateQuery(TransactionFilterQuerySchema),
  paymentsController.getAdminTransactions,
);

// Finance Officer / Admin: Reconciliation overview
paymentsRouter.get(
  "/admin/reconciliation",
  authenticate,
  requirePermission(Permission.PAYMENTS_READ_SUMMARY),
  validateQuery(ReconciliationQuerySchema),
  paymentsController.getReconciliation,
);

// Finance Officer / Admin: Daily summary
paymentsRouter.get(
  "/admin/daily-summary",
  authenticate,
  requirePermission(Permission.PAYMENTS_READ_SUMMARY),
  validateQuery(DailySummaryQuerySchema),
  paymentsController.getDailySummary,
);

// Customer / Staff: Get transaction details
paymentsRouter.get(
  "/:transactionId",
  authenticate,
  validateParams(TransactionIdParamsSchema),
  paymentsController.getTransaction,
);

// Customer: Poll payment status / verify
paymentsRouter.post(
  "/:transactionId/verify",
  authenticate,
  validateParams(TransactionIdParamsSchema),
  paymentsController.verifyPayment,
);

// Customer: Get invoice / receipt for transaction
paymentsRouter.get(
  "/:transactionId/invoice",
  authenticate,
  validateParams(TransactionIdParamsSchema),
  paymentsController.getInvoice,
);

// ---------------------------------------------------------------------------
// Dual-Authorization Refund Workflow Routes
// Operations Admin raises -> Finance Officer / Super Admin approves
// ---------------------------------------------------------------------------

// Operations Admin: Raise a refund request with >= 20 characters justification
paymentsRouter.post(
  "/admin/refunds",
  authenticate,
  requireRoles([UserRole.OPERATIONS_ADMIN, UserRole.SUPER_ADMIN]),
  validateBody(RaiseRefundRequestSchema),
  paymentsController.raiseRefund,
);

// Staff: List refund requests with filter & pagination
paymentsRouter.get(
  "/admin/refunds",
  authenticate,
  requireRoles([
    UserRole.OPERATIONS_ADMIN,
    UserRole.FINANCE_OFFICER,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGEMENT_VIEWER,
  ]),
  validateQuery(ListRefundsQuerySchema),
  paymentsController.listRefunds,
);

// Staff: Retrieve details of single refund request
paymentsRouter.get(
  "/admin/refunds/:id",
  authenticate,
  requireRoles([
    UserRole.OPERATIONS_ADMIN,
    UserRole.FINANCE_OFFICER,
    UserRole.SUPER_ADMIN,
    UserRole.MANAGEMENT_VIEWER,
  ]),
  validateParams(RefundRequestIdParamsSchema),
  paymentsController.getRefund,
);

// Finance Officer: Request more information / clarification from Operations Admin
paymentsRouter.post(
  "/admin/refunds/:id/request-info",
  authenticate,
  requirePermission(Permission.PAYMENTS_REFUND),
  validateParams(RefundRequestIdParamsSchema),
  validateBody(RequestInfoBodySchema),
  paymentsController.requestRefundInfo,
);

// Operations Admin: Respond to clarification request from Finance
paymentsRouter.post(
  "/admin/refunds/:id/provide-info",
  authenticate,
  requireRoles([UserRole.OPERATIONS_ADMIN, UserRole.SUPER_ADMIN]),
  validateParams(RefundRequestIdParamsSchema),
  validateBody(ProvideInfoBodySchema),
  paymentsController.provideRefundInfo,
);

// Finance Officer / Super Admin: Approve refund request (triggers Paystack gateway refund & loyalty clawbacks)
paymentsRouter.post(
  "/admin/refunds/:id/approve",
  authenticate,
  requirePermission(Permission.PAYMENTS_REFUND),
  validateParams(RefundRequestIdParamsSchema),
  validateBody(ApproveRefundBodySchema),
  paymentsController.approveRefund,
);

// Finance Officer / Super Admin: Reject refund request with reason
paymentsRouter.post(
  "/admin/refunds/:id/reject",
  authenticate,
  requirePermission(Permission.PAYMENTS_REFUND),
  validateParams(RefundRequestIdParamsSchema),
  validateBody(RejectRefundBodySchema),
  paymentsController.rejectRefund,
);

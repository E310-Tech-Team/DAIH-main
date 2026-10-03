import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth.middleware.js";
import { paymentsService, PaymentsService } from "./payments.service.js";
import { invoiceService, InvoiceService } from "./invoice.service.js";
import { refundService, RefundService } from "./refund.service.js";
import { prisma } from "../../db/client.js";

export function getWebhookDedupKey(event: any): string {
  if (!event) return `event_${Date.now()}`;
  if (event.event === "charge.success") {
    return `charge.success_${event.data?.reference || event.data?.id}`;
  }
  if (event.event && event.event.startsWith("refund.")) {
    const refundId = event.data?.id || event.data?.transaction_reference;
    return `${event.event}_${refundId}`;
  }
  return `${event.event}_${event.data?.id || event.data?.reference || Date.now()}`;
}

export class PaymentsController {
  constructor(
    private service: PaymentsService = paymentsService,
    private invoices: InvoiceService = invoiceService,
    private refunds: RefundService = refundService,
  ) {}

  /**
   * POST /api/v1/payments/initialize/:bookingId
   * Initialize a Paystack hosted checkout session
   */
  initialize = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const bookingId = req.params.bookingId as string;
      const { callbackUrl } = req.body || {};
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      const result = await this.service.initializePayment(
        bookingId,
        userId,
        callbackUrl,
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/payments/webhook
   * Paystack webhook endpoint (HMAC signature verified)
   * Persist-Then-Ack architecture
   */
  webhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
      let event = (req as any).paystackEvent;
      if (!event) {
        if (Buffer.isBuffer(req.body)) {
          event = JSON.parse(req.body.toString("utf8"));
        } else if (typeof req.body === "string") {
          event = JSON.parse(req.body);
        } else {
          event = req.body;
        }
      }

      const dedupKey = getWebhookDedupKey(event);
      const eventType = event?.event || "unknown";

      try {
        await prisma.webhookEvent.create({
          data: {
            eventId: dedupKey,
            eventType,
            payload: event as any,
            status: "PENDING",
            nextAttemptAt: null,
          },
        });
      } catch (err: any) {
        if (err.code === "P2002") {
          // Idempotent duplicate delivery
          return res.status(200).json({ received: true, duplicate: true });
        }
        // DB failure -> throw to trigger HTTP 500/503 so Paystack retries
        console.error("❌ Failed to persist webhook event:", err);
        return res.status(500).json({
          received: false,
          error: "Database error persisting webhook event",
        });
      }

      // Return HTTP 200 immediately to acknowledge gateway
      return res.status(200).json({ received: true });
    } catch (err: any) {
      console.error("❌ Unhandled webhook ingestion error:", err.message);
      return res.status(500).json({ received: false, error: err.message });
    }
  };

  /**
   * GET /api/v1/payments/history
   * Customer's personal payment history
   */
  getHistory = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      const page = req.query.page ? Number(req.query.page) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 20;

      const result = await this.service.getPaymentHistory(userId, {
        page,
        limit,
      });
      res.status(200).json({
        success: true,
        data: result.transactions,
        total: result.total,
        page: result.page,
        limit: result.limit,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/payments/:transactionId
   * Retrieve single transaction details
   */
  getTransaction = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const transactionId = req.params.transactionId as string;
      const userId = req.user?.id;
      const role = req.user?.role;

      const isStaff = role && ["FINANCE_OFFICER", "SUPER_ADMIN"].includes(role);
      const result = await this.service.verifyPayment(
        transactionId,
        isStaff ? undefined : userId,
      );

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/payments/:transactionId/verify
   * Poll or trigger payment verification
   */
  verifyPayment = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const transactionId = req.params.transactionId as string;
      const userId = req.user?.id;
      const role = req.user?.role;

      const isStaff = role && ["FINANCE_OFFICER", "SUPER_ADMIN"].includes(role);
      const result = await this.service.verifyPayment(
        transactionId,
        isStaff ? undefined : userId,
      );

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/payments/:transactionId/invoice
   * Download or fetch structured invoice / receipt
   */
  getInvoice = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const transactionId = req.params.transactionId as string;
      const userId = req.user?.id;
      const role = req.user?.role;

      const isStaff = role && ["FINANCE_OFFICER", "SUPER_ADMIN"].includes(role);
      const invoice = await this.invoices.getInvoice(
        transactionId,
        isStaff ? undefined : userId,
      );

      if (!invoice) {
        return res.status(404).json({
          success: false,
          code: "INVOICE_NOT_FOUND",
          message: "Invoice not found for this transaction",
        });
      }

      res.status(200).json({ success: true, data: invoice });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/payments/admin/transactions
   * Finance Officer / Admin list all transactions with filters
   */
  getAdminTransactions = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const filters = req.query as any;
      const result = await this.service.getAdminTransactions(filters);
      res.status(200).json({
        success: true,
        data: result.transactions,
        total: result.total,
        page: result.page,
        limit: result.limit,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/payments/admin/reconciliation
   * Finance Officer reconciliation overview
   */
  getReconciliation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { startDate, endDate } = req.query as {
        startDate?: string;
        endDate?: string;
      };
      const result = await this.service.getReconciliationView(
        startDate,
        endDate,
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/payments/admin/daily-summary
   * Daily payment breakdown for Finance
   */
  getDailySummary = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { date } = req.query as { date?: string };
      const result = await this.service.getDailySummary(date);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/payments/admin/refunds
   * Operations Admin raises a dual-authorization refund request
   */
  raiseRefund = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }
      const result = await this.refunds.raiseRefundRequest(userId, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/payments/admin/refunds
   * Staff lists all refund requests with status filter & pagination
   */
  listRefunds = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const filters = req.query as any;
      const result = await this.refunds.listRefundRequests(filters);
      res.status(200).json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/v1/payments/admin/refunds/:id
   * Staff retrieves single refund request details
   */
  getRefund = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const result = await this.refunds.getRefundRequest(id);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/payments/admin/refunds/:id/request-info
   * Finance Officer requests clarification from Operations Admin
   */
  requestRefundInfo = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }
      const id = req.params.id as string;
      const result = await this.refunds.requestMoreInfo(userId, id, req.body);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/payments/admin/refunds/:id/provide-info
   * Operations Admin responds to Finance Officer's inquiry
   */
  provideRefundInfo = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }
      const id = req.params.id as string;
      const result = await this.refunds.provideMoreInfo(userId, id, req.body);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/payments/admin/refunds/:id/approve
   * Finance Officer or Super Admin approves refund (triggers Paystack + coin clawbacks)
   */
  approveRefund = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }
      const id = req.params.id as string;
      const result = await this.refunds.approveRefund(userId, id);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/payments/admin/refunds/:id/reject
   * Finance Officer or Super Admin rejects refund request with reason
   */
  rejectRefund = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }
      const id = req.params.id as string;
      const result = await this.refunds.rejectRefund(userId, id, req.body);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };
}

export const paymentsController = new PaymentsController();

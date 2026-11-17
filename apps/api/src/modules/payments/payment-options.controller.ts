import { Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth.middleware.js";
import {
  manualPaymentsService,
  TransferListStatus,
} from "./manual-payments.service.js";
import { paymentSettingsService } from "./payment-settings.service.js";
import { paymentError } from "./payment-errors.js";

function currentUserId(req: AuthRequest): string {
  const userId = req.user?.id;
  if (!userId) {
    throw paymentError(401, "UNAUTHORIZED", "User not authenticated");
  }
  return userId;
}

/** Checkout options, payment settings, bank-transfer confirmation and reception payments. */
export class PaymentOptionsController {
  getOptions = async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const options = await paymentSettingsService.getAvailableOptions();
      res.status(200).json({ success: true, data: { options } });
    } catch (err) {
      next(err);
    }
  };

  getSettings = async (
    _req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await paymentSettingsService.getSettings();
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  updateSettings = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await paymentSettingsService.updateSettings(
        currentUserId(req),
        req.body,
      );
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  listBankTransfers = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const status = req.query.status as unknown as TransferListStatus;
      const data = await manualPaymentsService.listBankTransfers(status);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  confirmBankTransfer = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await manualPaymentsService.confirmBankTransfer(
        currentUserId(req),
        req.params.transactionId as string,
        req.body,
      );
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  rejectBankTransfer = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await manualPaymentsService.rejectBankTransfer(
        currentUserId(req),
        req.params.transactionId as string,
        req.body.reason,
      );
      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  recordReceptionPayment = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await manualPaymentsService.recordReceptionPayment(
        currentUserId(req),
        req.params.bookingId as string,
        req.body,
      );
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };
}

export const paymentOptionsController = new PaymentOptionsController();

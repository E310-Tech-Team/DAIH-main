import { Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth.middleware.js";
import { accessService } from "./access.service.js";
import { bookingService } from "../booking/booking.service.js";
import { BookingState, UserRole } from "@daih/types";

export class AccessController {
  /**
   * GET /api/v1/access/qr/:bookingId
   * Return digital access pass for booking owner or authorized staff
   */
  async getAccessPass(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const bookingId = String(req.params.bookingId);
      const booking = await bookingService.getBookingById(bookingId);

      if (!booking) {
        res.status(404).json({
          code: "BOOKING_NOT_FOUND",
          message: `Booking '${bookingId}' was not found`,
        });
        return;
      }

      // Enforce strict booking ownership: Pass retrieval is customer-facing and restricted to the booking owner.
      // Staff must use the verify-qr scanner to inspect passes presented by visitors.
      const isOwner = booking.userId === req.user?.id;

      if (!isOwner) {
        res.status(403).json({
          code: "FORBIDDEN",
          message: "You are not authorized to view this booking access pass",
        });
        return;
      }

      const isActiveState = [
        BookingState.CONFIRMED,
        BookingState.ACTIVE,
        BookingState.CHECKED_IN,
      ].includes(booking.state as BookingState);

      if (!isActiveState || !booking.qrToken) {
        res.status(400).json({
          code: "BOOKING_NOT_ACTIVE",
          message:
            "QR code access pass is only available for active, confirmed bookings",
        });
        return;
      }

      res.json({
        success: true,
        data: {
          token: booking.qrToken,
          bookingId: booking.id,
          reference: booking.reference,
          resourceName: booking.resourceName,
          customerName: booking.customerName,
          startTime: booking.startTime,
          expiresAt: booking.endTime,
          state: booking.state,
          checkedInAt: booking.checkedInAt,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/access/verify-qr
   * Verify access pass from scanned QR token or typed reference
   */
  async verifyPass(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { token } = req.body;
      const result = await accessService.verifyPass(token);

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/access/checkin/:bookingId
   * Check in member at terminal
   */
  async checkIn(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const bookingId = String(req.params.bookingId);
      const { terminalId, notes } = req.body || {};
      const staffUserId = req.user?.id;
      const ipAddress = req.ip || req.socket.remoteAddress;

      const result = await accessService.checkIn(bookingId, {
        staffUserId,
        terminalId,
        ipAddress,
        notes,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/access/checkout/:bookingId
   * Check out member at terminal
   */
  async checkOut(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const bookingId = String(req.params.bookingId);
      const { terminalId, notes } = req.body || {};
      const staffUserId = req.user?.id;
      const ipAddress = req.ip || req.socket.remoteAddress;

      const result = await accessService.checkOut(bookingId, {
        staffUserId,
        terminalId,
        ipAddress,
        notes,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/access/search?q=query
   * Search bookings for manual check-in
   */
  async searchBookings(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const query = String(req.query.q || "");
      const results = await accessService.searchBookings(query);

      res.json({
        success: true,
        data: results,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/access/activity
   * Get terminal scan / visit session activity feed
   */
  async getTerminalActivity(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const terminalId = req.query.terminalId
        ? String(req.query.terminalId)
        : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const offset = req.query.offset ? Number(req.query.offset) : 0;

      const activity = await accessService.getTerminalActivity({
        terminalId,
        limit,
        offset,
      });

      res.json({
        success: true,
        data: activity,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/access/visits
   * Get filtered visits activity with audit roll-call for check-in / check-out log
   */
  async getVisitsActivity(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const terminalId = req.query.terminalId
        ? String(req.query.terminalId)
        : undefined;
      const startDate = req.query.startDate
        ? String(req.query.startDate)
        : undefined;
      const endDate = req.query.endDate ? String(req.query.endDate) : undefined;
      const status = req.query.status
        ? (String(req.query.status) as any)
        : undefined;
      const search = req.query.search ? String(req.query.search) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const offset = req.query.offset ? Number(req.query.offset) : 0;

      const result = await accessService.getVisitsActivity({
        terminalId,
        startDate,
        endDate,
        status,
        search,
        limit,
        offset,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/access/occupancy
   * Get live occupancy statistics
   */
  async getLiveOccupancy(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const occupancy = await accessService.getLiveOccupancy();
      res.json({
        success: true,
        data: occupancy,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/access/terminal-summary
   * Single-roundtrip reception terminal telemetry (shift metrics, live occupancy & activity)
   */
  async getTerminalSummary(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const terminalId = req.query.terminalId
        ? String(req.query.terminalId)
        : undefined;
      const summary = await accessService.getTerminalSummary({ terminalId });
      res.json({
        success: true,
        data: summary,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const accessController = new AccessController();

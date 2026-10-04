import { OutboxEvent, Prisma } from "@prisma/client";
import { NotificationDTO, UserRole } from "@daih/types";
import { prisma } from "../../db/client.js";
import {
  CreateNotificationInput,
  ListNotificationsOptions,
  NotificationListResult,
} from "./notifications.types.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  const numericLimit = Number(limit);
  if (!Number.isFinite(numericLimit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(numericLimit, 1), MAX_LIMIT);
}

function customerName(user?: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}) {
  return (
    `${user?.firstName || ""} ${user?.lastName || ""}`.trim() ||
    user?.email ||
    "Member"
  );
}

function formatCurrency(amount?: unknown, currency = "NGN") {
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value <= 0) return currency;
  return `${currency} ${value.toLocaleString("en-NG", {
    maximumFractionDigits: 2,
  })}`;
}

export class NotificationsService {
  private mapNotification(row: any): NotificationDTO {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      linkHref: row.linkHref || null,
      metadata: row.metadata || null,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listForUser(
    userId: string,
    options: ListNotificationsOptions = {},
  ): Promise<NotificationListResult> {
    const limit = clampLimit(options.limit);
    const where: any = {
      userId,
      archivedAt: null,
    };

    if (options.cursor) {
      const cursorRow = await prisma.notification.findFirst({
        where: { id: options.cursor, userId },
        select: { id: true, createdAt: true },
      });

      if (cursorRow) {
        where.OR = [
          { createdAt: { lt: cursorRow.createdAt } },
          {
            createdAt: cursorRow.createdAt,
            id: { lt: cursorRow.id },
          },
        ];
      }
    }

    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      }),
      this.getUnreadCount(userId),
    ]);

    const pageRows = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? pageRows.at(-1)?.id || null : null;

    return {
      notifications: pageRows.map((row) => this.mapNotification(row)),
      unreadCount,
      nextCursor,
    };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return prisma.notification.count({
      where: {
        userId,
        readAt: null,
        archivedAt: null,
      },
    });
  }

  async markRead(userId: string, notificationId: string) {
    const existing = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId,
        archivedAt: null,
      },
    });

    if (!existing) {
      const err: any = new Error("Notification not found");
      err.statusCode = 404;
      err.code = "NOTIFICATION_NOT_FOUND";
      throw err;
    }

    if (existing.readAt) return this.mapNotification(existing);

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });

    return this.mapNotification(updated);
  }

  async markAllRead(userId: string) {
    await prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        archivedAt: null,
      },
      data: { readAt: new Date() },
    });

    return {
      success: true,
      unreadCount: await this.getUnreadCount(userId),
    };
  }

  async archive(userId: string, notificationId: string) {
    const existing = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId,
        archivedAt: null,
      },
    });

    if (!existing) {
      const err: any = new Error("Notification not found");
      err.statusCode = 404;
      err.code = "NOTIFICATION_NOT_FOUND";
      throw err;
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: {
        archivedAt: new Date(),
        readAt: existing.readAt || new Date(),
      },
    });

    return this.mapNotification(updated);
  }

  async createForUser(input: CreateNotificationInput) {
    if (!input.userId) return null;

    try {
      const row = await prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          message: input.message,
          linkHref: input.linkHref || null,
          metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
          sourceEventId: input.sourceEventId || null,
        },
      });
      return this.mapNotification(row);
    } catch (err: any) {
      if (err?.code === "P2002" && input.sourceEventId) {
        const existing = await prisma.notification.findUnique({
          where: { sourceEventId: input.sourceEventId },
        });
        return existing ? this.mapNotification(existing) : null;
      }
      throw err;
    }
  }

  async createForEmail(
    email: string | undefined | null,
    input: Omit<CreateNotificationInput, "userId">,
  ) {
    if (!email) return null;

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) return null;
    return this.createForUser({ ...input, userId: user.id });
  }

  async createForRoles(
    roles: UserRole[],
    input: Omit<CreateNotificationInput, "userId" | "sourceEventId"> & {
      sourceEventIdPrefix?: string;
    },
  ) {
    const users = await prisma.user.findMany({
      where: { role: { in: roles as any[] } },
      select: { id: true },
    });

    return Promise.all(
      users.map((user) =>
        this.createForUser({
          userId: user.id,
          type: input.type,
          title: input.title,
          message: input.message,
          linkHref: input.linkHref,
          metadata: input.metadata,
          sourceEventId: input.sourceEventIdPrefix
            ? `${input.sourceEventIdPrefix}:${user.id}`
            : null,
        }),
      ),
    );
  }

  async createFromOutboxEvent(event: OutboxEvent) {
    const payload = event.payload as any;

    switch (event.eventType) {
      case "booking.confirmed":
        return this.createBookingNotification(event, {
          title: "Booking confirmed",
          message: (booking) =>
            `Your ${booking.resource?.name || "workspace"} booking ${booking.reference} is confirmed. Your QR pass is ready.`,
          fallbackMessage: `Your booking ${payload?.reference || ""} is confirmed. Your QR pass is ready.`,
          linkHref: (booking) => `/qr?bookingId=${booking.id}`,
        });

      case "booking.rescheduled":
        return this.createBookingNotification(event, {
          title: "Booking rescheduled",
          message: (booking) =>
            `Your ${booking.resource?.name || "workspace"} booking ${booking.reference} has been rescheduled.`,
          fallbackMessage: `Your booking ${payload?.reference || ""} has been rescheduled.`,
          linkHref: () => "/bookings",
        });

      case "booking.cancelled":
        return this.createBookingNotification(event, {
          title: "Booking cancelled",
          message: (booking) =>
            `Your ${booking.resource?.name || "workspace"} booking ${booking.reference} has been cancelled.`,
          fallbackMessage: `Your booking ${payload?.reference || ""} has been cancelled.`,
          linkHref: () => "/bookings",
        });

      case "access.checked_in":
        return this.createAccessNotification(event, {
          title: payload?.isReEntry ? "Welcome back" : "Check-in confirmed",
          message: `${payload?.customerName || "Your"} check-in for ${payload?.resourceName || "your workspace"} has been recorded.`,
        });

      case "access.checked_out":
        return this.createAccessNotification(event, {
          title: "Check-out recorded",
          message: `Your check-out for ${payload?.resourceName || "your workspace"} has been recorded.`,
        });

      case "payment.successful":
        return this.createPaymentNotification(event, {
          title: "Payment received",
          message: (payment) =>
            `We received ${formatCurrency(payment.amount, payment.currency)} for booking ${payment.bookingReference || payment.reference || ""}.`,
          fallbackMessage: `We received your payment for booking ${payload?.bookingReference || payload?.reference || ""}.`,
        });

      case "payment.failed":
        return this.createPaymentNotification(event, {
          title: "Payment failed",
          message: (payment) =>
            `Payment for booking ${payment.bookingReference || payment.reference || ""} was not completed.`,
          fallbackMessage: "Your payment was not completed.",
        });

      case "payment.capacity_conflict":
        await this.createForEmail(payload?.customerEmail, {
          type: event.eventType,
          title: "Booking needs attention",
          message:
            "Your payment was received, but the selected slot needs rescheduling. Our operations team will assist.",
          linkHref: "/bookings",
          metadata: payload || null,
          sourceEventId: `${event.id}:customer`,
        });

        return this.createForRoles(
          [UserRole.OPERATIONS_ADMIN, UserRole.SUPER_ADMIN],
          {
            type: event.eventType,
            title: "Booking needs rescheduling",
            message: `Late payment conflict for booking ${payload?.reference || payload?.bookingId || ""}.`,
            linkHref: "/dashboard",
            metadata: payload || null,
            sourceEventIdPrefix: `${event.id}:staff`,
          },
        );

      default:
        return null;
    }
  }

  private async findBookingFromPayload(payload: any) {
    if (!payload?.bookingId) return null;

    return prisma.booking.findUnique({
      where: { id: payload.bookingId },
      include: { user: true, resource: true },
    });
  }

  private async createBookingNotification(
    event: OutboxEvent,
    config: {
      title: string;
      message: (booking: any) => string;
      fallbackMessage: string;
      linkHref: (booking: any) => string;
    },
  ) {
    const payload = event.payload as any;
    const booking = await this.findBookingFromPayload(payload);

    if (booking?.userId) {
      return this.createForUser({
        userId: booking.userId,
        type: event.eventType,
        title: config.title,
        message: config.message(booking),
        linkHref: config.linkHref(booking),
        metadata: {
          bookingId: booking.id,
          reference: booking.reference,
          resourceName: booking.resource?.name,
        },
        sourceEventId: `${event.id}:customer`,
      });
    }

    return this.createForEmail(payload?.customerEmail, {
      type: event.eventType,
      title: config.title,
      message: config.fallbackMessage.trim(),
      linkHref: "/bookings",
      metadata: payload || null,
      sourceEventId: `${event.id}:customer`,
    });
  }

  private async createAccessNotification(
    event: OutboxEvent,
    input: {
      title: string;
      message: string;
    },
  ) {
    const payload = event.payload as any;
    const base = {
      type: event.eventType,
      title: input.title,
      message: input.message,
      linkHref: "/dashboard",
      metadata: payload || null,
      sourceEventId: `${event.id}:customer`,
    };

    if (payload?.userId) {
      return this.createForUser({ ...base, userId: payload.userId });
    }

    return this.createForEmail(payload?.customerEmail, base);
  }

  private async createPaymentNotification(
    event: OutboxEvent,
    config: {
      title: string;
      message: (payment: any) => string;
      fallbackMessage: string;
    },
  ) {
    const payload = event.payload as any;
    let userId = payload?.userId;
    let paymentPayload = payload;

    if (!userId && payload?.transactionId) {
      const transaction = await prisma.transaction.findUnique({
        where: { id: payload.transactionId },
        include: {
          booking: { include: { resource: true } },
          user: true,
        },
      });

      if (transaction) {
        userId = transaction.userId;
        paymentPayload = {
          ...payload,
          amount: Number(transaction.amount),
          currency: transaction.currency,
          bookingReference: transaction.booking?.reference,
          resourceName: transaction.booking?.resource?.name,
          customerName: customerName(transaction.user),
        };
      }
    }

    const base = {
      type: event.eventType,
      title: config.title,
      message: userId
        ? config.message(paymentPayload)
        : config.fallbackMessage.trim(),
      linkHref: "/bookings",
      metadata: paymentPayload || null,
      sourceEventId: `${event.id}:customer`,
    };

    if (userId) {
      return this.createForUser({ ...base, userId });
    }

    return this.createForEmail(payload?.customerEmail, base);
  }

  async sendAdminAlert(title: string, message: string, metadata?: any) {
    try {
      const adminUsers = await prisma.user.findMany({
        where: {
          role: {
            in: [
              UserRole.SUPER_ADMIN,
              UserRole.FINANCE_OFFICER,
              UserRole.OPERATIONS_ADMIN,
            ],
          },
        },
        select: { id: true },
      });
      for (const admin of adminUsers) {
        await this.createForUser({
          userId: admin.id,
          type: "admin.alert",
          title,
          message,
          linkHref: "/finance",
          metadata,
        });
      }
    } catch (err: any) {
      console.error(
        "[Notifications] Failed to dispatch admin alert:",
        err?.message,
      );
    }
  }
}

export const notificationsService = new NotificationsService();

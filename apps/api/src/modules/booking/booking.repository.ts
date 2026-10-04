import { prisma } from "../../db/client.js";
import {
  BookingState,
  PaymentStatus,
  HoldStatus,
  Prisma,
} from "@prisma/client";
import { ACTIVE_BOOKING_STATES } from "./booking.state-machine.js";
import { outboxService } from "../events/outbox.service.js";

export class BookingRepository {
  /**
   * Find a bookable resource by ID or Slug with active pricing, schedules, and blackouts
   */
  async findResource(idOrSlug: string) {
    return prisma.facilityResource.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      },
      include: {
        pricing: {
          where: { isActive: true },
          orderBy: { price: "asc" },
        },
        schedules: {
          orderBy: { dayOfWeek: "asc" },
        },
        blackouts: {
          where: { isActive: true },
          orderBy: { startDate: "asc" },
        },
      },
    });
  }

  /**
   * Count active overlapping bookings/holds for a given resource and time window.
   * Excludes expired holds automatically.
   */
  async countActiveOverlappingBookings(
    tx: Prisma.TransactionClient | typeof prisma,
    resourceId: string,
    startTime: Date,
    endTime: Date,
    excludeBookingId?: string,
  ): Promise<number> {
    const now = new Date();

    const aggregate = await tx.booking.aggregate({
      where: {
        resourceId,
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
        state: { in: ACTIVE_BOOKING_STATES },
        startTime: { lt: endTime },
        endTime: { gt: startTime },
        OR: [
          // Confirmed/Active bookings don't expire
          {
            state: {
              in: [
                BookingState.CONFIRMED,
                BookingState.ACTIVE,
                BookingState.CHECKED_IN,
              ],
            },
          },
          // Holds or Pending Payment are only active if not yet expired
          {
            state: { in: [BookingState.HELD, BookingState.PENDING_PAYMENT] },
            OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
          },
        ],
      },
      _sum: {
        quantity: true,
      },
    });

    return aggregate._sum.quantity || 0;
  }

  /**
   * Create a new booking in HELD state
   */
  async createHold(
    tx: Prisma.TransactionClient | typeof prisma,
    data: {
      reference: string;
      resourceId: string;
      userId: string;
      startTime: Date;
      endTime: Date;
      quantity?: number;
      totalAmount: number | Prisma.Decimal;
      cashDue?: number | Prisma.Decimal;
      coinsRedeemed?: number | Prisma.Decimal;
      coinTenderAmount?: number | Prisma.Decimal;
      conversionRateSnapshot?: number | Prisma.Decimal;
      originalAmount?: number | Prisma.Decimal;
      discountAmount?: number | Prisma.Decimal;
      discountId?: string;
      discountCode?: string;
      currency?: string;
      holdExpiresAt: Date;
    },
  ) {
    return tx.booking.create({
      data: {
        reference: data.reference,
        resourceId: data.resourceId,
        userId: data.userId,
        startTime: data.startTime,
        endTime: data.endTime,
        state: BookingState.HELD,
        quantity: data.quantity ?? 1,
        holdExpiresAt: data.holdExpiresAt,
        totalAmount: data.totalAmount,
        cashDue: data.cashDue ?? data.totalAmount,
        coinsRedeemed: data.coinsRedeemed ?? 0,
        coinTenderAmount: data.coinTenderAmount ?? 0,
        conversionRateSnapshot: data.conversionRateSnapshot,
        originalAmount: data.originalAmount,
        discountAmount: data.discountAmount ?? 0,
        discountId: data.discountId,
        discountCode: data.discountCode,
        currency: data.currency || "NGN",
      },
      include: {
        resource: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            clientId: true,
            phoneNumber: true,
          },
        },
      },
    });
  }

  /**
   * Find booking by unique ID
   */
  async findById(id: string) {
    return prisma.booking.findUnique({
      where: { id },
      include: {
        resource: {
          include: {
            pricing: true,
          },
        },
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            clientId: true,
            phoneNumber: true,
          },
        },
        transactions: true,
        visitSessions: {
          orderBy: { checkInTime: "desc" },
          take: 5,
        },
      },
    });
  }

  /**
   * Find booking by human-readable reference number
   */
  async findByReference(reference: string) {
    return prisma.booking.findUnique({
      where: { reference },
      include: {
        resource: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            clientId: true,
            phoneNumber: true,
          },
        },
        transactions: true,
        visitSessions: {
          orderBy: { checkInTime: "desc" },
          take: 5,
        },
      },
    });
  }

  /**
   * Find customer's own bookings (with automatic overdue sweep)
   */
  async findMyBookings(userId: string) {
    return prisma.booking.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        resource: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            clientId: true,
          },
        },
        visitSessions: {
          orderBy: { checkInTime: "desc" },
          take: 5,
        },
      },
    });
  }

  /**
   * Find all bookings for Admin console with filters and pagination
   */
  async findAllAdminBookings(filters: {
    state?: string;
    resourceId?: string;
    userId?: string;
    search?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(1000, filters.limit || 20));
    const skip = (page - 1) * limit;

    const now = new Date();
    const isActiveFilter = filters.state === "ACTIVE";

    const where: Prisma.BookingWhereInput = {
      ...(isActiveFilter
        ? {
            state: BookingState.CONFIRMED,
            startTime: { lte: now },
            endTime: { gte: now },
          }
        : filters.state
          ? { state: filters.state as BookingState }
          : {
              state: {
                notIn: [
                  BookingState.EXPIRED,
                  BookingState.DRAFT,
                  BookingState.HELD,
                  BookingState.PENDING_PAYMENT,
                ],
              },
            }),
      ...(filters.resourceId ? { resourceId: filters.resourceId } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(!isActiveFilter && (filters.startDate || filters.endDate)
        ? {
            startTime: {
              ...(filters.startDate ? { gte: filters.startDate } : {}),
              ...(filters.endDate ? { lte: filters.endDate } : {}),
            },
          }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { reference: { contains: filters.search, mode: "insensitive" } },
              {
                user: {
                  email: { contains: filters.search, mode: "insensitive" },
                },
              },
              {
                user: {
                  firstName: { contains: filters.search, mode: "insensitive" },
                },
              },
              {
                user: {
                  lastName: { contains: filters.search, mode: "insensitive" },
                },
              },
              {
                resource: {
                  name: { contains: filters.search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };

    const [total, bookings] = await prisma.$transaction([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          resource: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              clientId: true,
              phoneNumber: true,
            },
          },
        },
      }),
    ]);

    return { total, bookings, page, limit };
  }

  /**
   * Update booking state inside a transaction or standalone
   */
  async updateState(
    tx: Prisma.TransactionClient | typeof prisma,
    id: string,
    toState: BookingState,
    extraData: {
      qrToken?: string;
      checkedInAt?: Date;
      checkedOutAt?: Date;
      holdExpiresAt?: Date | null;
    } = {},
  ) {
    return tx.booking.update({
      where: { id },
      data: {
        state: toState,
        ...extraData,
      },
      include: {
        resource: true,
        user: true,
      },
    });
  }

  /**
   * Extend hold expiry timestamp
   */
  async extendHold(
    tx: Prisma.TransactionClient | typeof prisma,
    id: string,
    newExpiresAt: Date,
  ) {
    return tx.booking.update({
      where: { id },
      data: {
        holdExpiresAt: newExpiresAt,
      },
      include: {
        resource: true,
        user: true,
      },
    });
  }

  /**
   * Bulk updates all overdue HELD / PENDING_PAYMENT bookings to EXPIRED
   */
  async sweepOverdueHolds(now: Date = new Date()): Promise<number> {
    const overdueBookings = await prisma.booking.findMany({
      where: {
        state: { in: [BookingState.HELD, BookingState.PENDING_PAYMENT] },
        holdExpiresAt: { lte: now },
      },
      select: { id: true },
    });

    let count = 0;
    for (const b of overdueBookings) {
      try {
        await prisma.$transaction(
          async (tx) => {
            // 1. Lock pending transactions
            await tx.$queryRaw`
              SELECT id FROM "transactions" WHERE "bookingId" = ${b.id} AND "status" = 'PENDING' FOR UPDATE
            `;

            // 2. Lock booking
            const rows = await tx.$queryRaw<
              Array<{ id: string; state: string }>
            >`
              SELECT id, state FROM "bookings" WHERE id = ${b.id} FOR UPDATE
            `;
            if (
              rows.length === 0 ||
              !["HELD", "PENDING_PAYMENT"].includes(rows[0].state)
            ) {
              return;
            }

            // 3. Lock active coin hold
            await tx.$queryRaw`
              SELECT id FROM "coin_holds" WHERE "bookingId" = ${b.id} AND "status" = 'ACTIVE' FOR UPDATE
            `;

            // Update transactions: PENDING -> EXPIRED
            await tx.transaction.updateMany({
              where: { bookingId: b.id, status: PaymentStatus.PENDING },
              data: { status: PaymentStatus.EXPIRED },
            });

            // Update booking: state -> EXPIRED
            await tx.booking.update({
              where: { id: b.id },
              data: { state: BookingState.EXPIRED },
            });

            // Update coin hold: ACTIVE -> RELEASED
            await tx.coinHold.updateMany({
              where: { bookingId: b.id, status: HoldStatus.ACTIVE },
              data: { status: HoldStatus.RELEASED },
            });

            count++;
          },
          { timeout: 15000, maxWait: 10000 },
        );
      } catch (err: any) {
        console.warn(
          `Error sweeping overdue hold for booking ${b.id}:`,
          err?.message,
        );
      }
    }
    return count;
  }

  /**
   * Bulk updates overdue CONFIRMED bookings with no check-in to NO_SHOW,
   * and overdue CHECKED_IN/ACTIVE bookings to COMPLETED.
   */
  async sweepOverdueBookings(
    now: Date = new Date(),
  ): Promise<{ noShowCount: number; completedCount: number }> {
    // 1. Confirmed bookings whose end time has passed and never checked in -> NO_SHOW
    const noShowResult = await prisma.booking.updateMany({
      where: {
        state: BookingState.CONFIRMED,
        endTime: { lte: now },
        checkedInAt: null,
      },
      data: {
        state: BookingState.NO_SHOW,
      },
    });

    // 2. Find overdue checked-in, active, or checked-out bookings to mark COMPLETED
    const bookingsToComplete = await prisma.booking.findMany({
      where: {
        state: {
          in: [
            BookingState.CHECKED_IN,
            BookingState.ACTIVE,
            BookingState.CHECKED_OUT,
          ],
        },
        endTime: { lte: now },
      },
      select: {
        id: true,
        reference: true,
        resource: { select: { name: true } },
        user: { select: { email: true, firstName: true, lastName: true } },
        review: { select: { id: true } },
      },
    });

    if (bookingsToComplete.length === 0) {
      return {
        noShowCount: noShowResult.count,
        completedCount: 0,
      };
    }

    const completedResult = await prisma.booking.updateMany({
      where: {
        id: { in: bookingsToComplete.map((b) => b.id) },
      },
      data: {
        state: BookingState.COMPLETED,
      },
    });

    // Dispatch booking.completed event so the review prompt email is sent to eligible members
    for (const b of bookingsToComplete) {
      if (!b.review && b.user?.email) {
        const customerName =
          `${b.user.firstName || ""} ${b.user.lastName || ""}`.trim() ||
          b.user.email;
        try {
          await outboxService.recordEvent({
            eventType: "booking.completed",
            aggregateType: "Booking",
            aggregateId: b.id,
            payload: {
              bookingId: b.id,
              reference: b.reference,
              customerEmail: b.user.email,
              customerName,
              resourceName: b.resource?.name || "Workspace",
            },
          });
        } catch (err) {
          console.warn(
            `[sweepOverdueBookings] Could not emit booking.completed for ${b.id}:`,
            err,
          );
        }
      }
    }

    return {
      noShowCount: noShowResult.count,
      completedCount: completedResult.count,
    };
  }
}

export const bookingRepository = new BookingRepository();

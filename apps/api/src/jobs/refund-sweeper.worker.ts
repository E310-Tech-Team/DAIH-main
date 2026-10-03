import { prisma } from "../db/client.js";
import { refundService } from "../modules/payments/refund.service.js";
import { outboxService } from "../modules/events/outbox.service.js";
import { RefundStatus } from "@prisma/client";

export class RefundSweeperWorker {
  private isSweeping = false;

  async sweepSystemRefunds(
    batchSize: number = 10,
    workerId: string = `refund-sweeper-${process.pid}`,
  ): Promise<{
    processed: number;
    failed: number;
  }> {
    if (this.isSweeping) return { processed: 0, failed: 0 };
    this.isSweeping = true;

    let processed = 0;
    let failed = 0;

    try {
      // 1. Recover stale PROCESSING refunds (> 15 minutes)
      const staleTime = new Date(Date.now() - 15 * 60 * 1000);
      const staleRefunds = await prisma.refundRequest.findMany({
        where: {
          status: RefundStatus.PROCESSING,
          claimedAt: { lt: staleTime },
        },
      });

      for (const st of staleRefunds) {
        if (!st.gatewayRequestedAt) {
          // Crashed before gateway call -> safely revert to PENDING
          await prisma.refundRequest.update({
            where: { id: st.id },
            data: {
              status: RefundStatus.PENDING,
              claimedAt: null,
              workerId: null,
            },
          });
        }
      }

      // 2. Claim pending system refunds with FOR UPDATE SKIP LOCKED
      const claimedRefunds = await prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<
            Array<{
              id: string;
              attempts: number;
            }>
          >`
          SELECT id, attempts
          FROM "refund_requests"
          WHERE "isSystemInitiated" = true AND status = 'PENDING'
          ORDER BY "createdAt" ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        `;

          if (rows.length === 0) return [];

          const ids = rows.map((r) => r.id);
          await tx.$executeRaw`
          UPDATE "refund_requests"
          SET status = 'PROCESSING', "claimedAt" = NOW(), "workerId" = ${workerId}, attempts = attempts + 1
          WHERE id = ANY(${ids}::text[])
        `;

          return rows;
        },
        { timeout: 15000, maxWait: 10000 },
      );

      for (const ref of claimedRefunds) {
        try {
          await refundService.processSystemRefund(ref.id, workerId);
          processed++;
        } catch (err: any) {
          console.error(
            `[RefundSweeper] Error processing system refund ${ref.id}:`,
            err,
          );
          const newAttempts = ref.attempts + 1;
          if (newAttempts >= 3) {
            await prisma.refundRequest.update({
              where: { id: ref.id },
              data: {
                status: RefundStatus.FAILED,
                failureReason:
                  err?.message || "SYSTEM_REFUND_RETRIES_EXHAUSTED",
                lastError: err?.message,
              },
            });

            await prisma.auditLog.create({
              data: {
                action: "SYSTEM_REFUND_EXHAUSTED",
                entityType: "RefundRequest",
                entityId: ref.id,
                metadata: {
                  attempts: newAttempts,
                  error: err?.message,
                },
              },
            });

            await outboxService.recordEvent({
              eventType: "admin.system_refund_failed",
              aggregateType: "RefundRequest",
              aggregateId: ref.id,
              payload: {
                refundRequestId: ref.id,
                attempts: newAttempts,
                error: err?.message,
              },
            });

            failed++;
          } else {
            await prisma.refundRequest.update({
              where: { id: ref.id },
              data: {
                status: RefundStatus.PENDING,
                claimedAt: null,
                workerId: null,
                lastError: err?.message,
              },
            });
          }
        }
      }
    } finally {
      this.isSweeping = false;
    }

    return { processed, failed };
  }
}

export const refundSweeperWorker = new RefundSweeperWorker();

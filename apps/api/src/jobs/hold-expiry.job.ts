import { Queue } from "bullmq";
import { redis } from "../config/redis.js";
import { config } from "../config/env.js";

export const HOLD_EXPIRY_QUEUE_NAME = "booking-holds";

export let holdExpiryQueue: Queue | null = null;

if (config.env !== "test") {
  try {
    holdExpiryQueue = new Queue(HOLD_EXPIRY_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  } catch (err: any) {
    console.warn("⚠️ Redis BullMQ queue initialization notice:", err?.message);
  }
}

/**
 * Schedules a delayed job to automatically expire an uncompleted booking hold.
 * @param bookingId ID of the booking
 * @param delayMs Delay in milliseconds (default: 10 minutes)
 */
export async function scheduleHoldExpiry(
  bookingId: string,
  delayMs: number = 10 * 60 * 1000,
): Promise<void> {
  if (!holdExpiryQueue || config.env === "test") return;
  try {
    const jobId = `hold_expiry_${bookingId}`;
    // BullMQ ignores add() while a job with the same id is still pending, so
    // an extended hold would keep its original timer. Replace it instead.
    const existing = await holdExpiryQueue.getJob(jobId);
    if (existing) {
      await existing.remove().catch((err: unknown) => {
        console.warn(
          `Could not replace hold-expiry job for booking '${bookingId}':`,
          err instanceof Error ? err.message : err,
        );
      });
    }
    await holdExpiryQueue.add(
      "expire-hold",
      { bookingId },
      {
        jobId,
        delay: Math.max(1000, delayMs),
      },
    );
    console.log(
      `⏱️ Scheduled hold auto-expiry job for booking '${bookingId}' in ${Math.round(delayMs / 1000)}s`,
    );
  } catch (err: any) {
    console.warn(
      `Could not enqueue hold-expiry job for booking '${bookingId}':`,
      err?.message,
    );
  }
}

/**
 * Cancels or reschedules a hold expiry job.
 */
export async function cancelHoldExpiryJob(bookingId: string): Promise<void> {
  if (!holdExpiryQueue || config.env === "test") return;
  try {
    const jobId = `hold_expiry_${bookingId}`;
    const job = await holdExpiryQueue.getJob(jobId);
    if (job) {
      await job.remove();
      console.log(`⏱️ Removed hold-expiry job for booking '${bookingId}'`);
    }
  } catch (err: any) {
    console.warn(
      `Could not remove hold-expiry job for booking '${bookingId}':`,
      err?.message,
    );
  }
}

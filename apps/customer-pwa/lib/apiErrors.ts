import { ApiError } from "@daih/api-client";

/**
 * The API's HOLD_LAPSED message, for when the page can already see that a hold
 * has run out without asking the server.
 */
export const HOLD_LAPSED_MESSAGE =
  "This reservation has expired, so its slot may have been released. Please make a new booking.";

/** Codes whose server message is too technical to show members as-is. */
const FRIENDLY_MESSAGES: Readonly<Record<string, string>> = {
  NETWORK_ERROR: "We couldn't reach DAIH. Check your connection and try again.",
  INVALID_BOOKING_STATE:
    "This booking can no longer be paid for. It may have expired, been cancelled or already been paid.",
};

/** The DAIH API error code, or undefined for anything else. */
export function getErrorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

/**
 * A message that is safe to show members: the API's own message (or a friendlier
 * one for technical codes), and the fallback for anything that is not an API error.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  return FRIENDLY_MESSAGES[error.code] ?? (error.message.trim() || fallback);
}

/** The booking's hold ran out before payment started (409 HOLD_LAPSED). */
export function isHoldLapsedError(error: unknown): boolean {
  return getErrorCode(error) === "HOLD_LAPSED";
}

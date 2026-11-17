const NETWORK_ERROR_CODE = "NETWORK_ERROR";

/** The API's machine-readable error code (e.g. "AMOUNT_MISMATCH"), if the error has one. */
export function apiErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** A message to show staff: the API's own wording, or `fallback` when there is none. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (apiErrorCode(err) === NETWORK_ERROR_CODE) {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (err instanceof Error && err.message.trim() !== "") {
    return err.message;
  }
  return fallback;
}

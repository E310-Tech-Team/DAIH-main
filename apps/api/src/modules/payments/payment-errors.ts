/** An error the API error handler returns to the client with its status and code. */
export interface PaymentHttpError extends Error {
  statusCode: number;
  code: string;
}

export function paymentError(
  statusCode: number,
  code: string,
  message: string,
): PaymentHttpError {
  return Object.assign(new Error(message), { statusCode, code });
}

/** Prisma's unique-constraint violation, e.g. two requests creating the same row. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}

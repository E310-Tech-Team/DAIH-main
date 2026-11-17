/** Mirrors the API: naira above zero, at most 2 decimal places, up to ₦100,000,000. */
const MAX_NAIRA_AMOUNT = 100_000_000;
const NAIRA_AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/** Accepts what staff naturally type or paste: "₦12,500.00", "12 500", "12500". */
function normalise(text: string): string {
  return text.replace(/[₦,\s]/g, "");
}

/** What is wrong with a typed naira amount; null when it is valid. */
export function nairaInputProblem(text: string): string | null {
  const cleaned = normalise(text);
  if (cleaned === "") return "Enter the amount received.";
  if (!NAIRA_AMOUNT_PATTERN.test(cleaned)) {
    return "Enter an amount in naira, like 12500 or 12500.50.";
  }
  const amount = Number(cleaned);
  if (amount <= 0) return "The amount must be more than ₦0.";
  if (amount > MAX_NAIRA_AMOUNT) return "The amount is too large.";
  return null;
}

/** The typed amount in naira, or null while it is not a valid amount. */
export function parseNairaInput(text: string): number | null {
  return nairaInputProblem(text) === null ? Number(normalise(text)) : null;
}

/** Whole kobo, so two amounts compare exactly (the API compares the same way). */
export function toKobo(amount: number): number {
  return Math.round(amount * 100);
}

/** How an amount is prefilled in an input: "12500" or "12500.50". */
export function formatAmountForInput(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

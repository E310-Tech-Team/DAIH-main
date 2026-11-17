/**
 * Mirrors the API's rule for bank, POS and payout references: letters, digits,
 * spaces and - _ / . : # only, at most 100 characters (checked after trimming).
 */
const REFERENCE_PATTERN = /^[A-Za-z0-9 \-_/.:#]+$/;

/** The same rule for an input's `pattern` attribute (browsers compile it with the `v` flag). */
export const REFERENCE_INPUT_PATTERN = "[A-Za-z0-9 \\-_\\/.:#]+";
export const REFERENCE_MAX_LENGTH = 100;

const INVALID_CHARACTERS_MESSAGE =
  "Use only letters, digits, spaces and - _ / . : #";

interface ReferenceRule {
  /** Shortest accepted reference, after trimming. */
  minLength: number;
  /** How the field is named in messages, e.g. "bank reference". */
  label: string;
}

/** The invalid-characters message as soon as one is typed, so staff see it before submitting. */
export function referenceCharacterProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return REFERENCE_PATTERN.test(trimmed) ? null : INVALID_CHARACTERS_MESSAGE;
}

/** Everything wrong with a required reference, as one message; null when it is valid. */
export function validateReference(
  value: string,
  { minLength, label }: ReferenceRule,
): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return `Enter the ${label}.`;
  const characterProblem = referenceCharacterProblem(trimmed);
  if (characterProblem) return characterProblem;
  if (trimmed.length < minLength) {
    return `The ${label} must be at least ${minLength} characters.`;
  }
  if (trimmed.length > REFERENCE_MAX_LENGTH) {
    return `The ${label} can be at most ${REFERENCE_MAX_LENGTH} characters.`;
  }
  return null;
}

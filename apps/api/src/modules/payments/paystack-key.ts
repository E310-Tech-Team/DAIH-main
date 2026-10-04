/**
 * Template and mock markers that must never be trusted as a Paystack secret key.
 * Real keys are `sk_test_`/`sk_live_` followed by hex, so they cannot contain these.
 */
const PLACEHOLDER_MARKERS = /mock|xxx|placeholder|changeme|your[_-]/i;

/** True when `key` looks like a real Paystack secret key rather than a template or mock value. */
export function isRealPaystackSecretKey(
  key: string | undefined | null,
): key is string {
  return (
    !!key && /^sk_(test|live)_\w+$/.test(key) && !PLACEHOLDER_MARKERS.test(key)
  );
}

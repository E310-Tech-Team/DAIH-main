import { describe, it, expect } from "vitest";
import { isRealPaystackSecretKey } from "./paystack-key.js";

// Fixture keys are assembled at runtime so secret scanners don't mistake them for real ones.
const HEX40 = "0123456789abcdef".repeat(3).slice(0, 40);

describe("isRealPaystackSecretKey", () => {
  it.each([[`sk_test_${HEX40}`], [`sk_live_${HEX40}`]])(
    "accepts a real-looking key (%s)",
    (key) => {
      expect(isRealPaystackSecretKey(key)).toBe(true);
    },
  );

  it.each([
    [undefined],
    [null],
    [""],
    ["sk_live_xxx"],
    ["sk_test_xxx"],
    ["sk_test_mock"],
    ["sk_live_your_secret_key"],
    ["sk_test_placeholder"],
    ["wh_sec_mock"],
    [`pk_live_${HEX40}`],
    ["not-a-paystack-key"],
  ])("rejects template, mock or malformed values (%s)", (key) => {
    expect(isRealPaystackSecretKey(key)).toBe(false);
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import crypto from "crypto";
import { config } from "../../config/env.js";
import { verifyPaystackWebhookSignature } from "./webhook.verifier.js";

// Fixture keys are assembled at runtime so secret scanners don't mistake them for real ones.
const HEX40 = "0123456789abcdef".repeat(3).slice(0, 40);
const REAL_LOOKING_KEY = `sk_live_${HEX40}`;
const body = Buffer.from(
  JSON.stringify({
    event: "charge.success",
    data: { reference: "DAIH-PAY-1" },
  }),
);
const sign = (key: string) =>
  crypto.createHmac("sha512", key).update(body).digest("hex");

function run(signature: string | undefined) {
  const req: any = {
    headers: signature ? { "x-paystack-signature": signature } : {},
    body,
  };
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  const next = vi.fn();
  verifyPaystackWebhookSignature(req, res, next);
  return { req, res, next };
}

describe("verifyPaystackWebhookSignature", () => {
  const originalEnv = config.env;
  const originalKey = config.paystack.secretKey;

  afterEach(() => {
    config.env = originalEnv;
    config.paystack.secretKey = originalKey;
  });

  it("accepts a payload signed with the secret key, as Paystack signs it", () => {
    const { req, next, res } = run(sign(config.paystack.secretKey));

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.paystackEvent.data.reference).toBe("DAIH-PAY-1");
  });

  it("rejects a payload signed with the old template webhook secret", () => {
    const { next, res } = run(sign("wh_sec_xxx"));

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a missing signature", () => {
    const { next, res } = run(undefined);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("refuses every webhook in production while the secret key is a placeholder", () => {
    config.env = "production";
    config.paystack.secretKey = "sk_live_xxx";

    // Signed with the public template key, exactly as an attacker could.
    const { next, res } = run(sign("sk_live_xxx"));

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it("accepts a correctly signed webhook in production with a real key", () => {
    config.env = "production";
    config.paystack.secretKey = REAL_LOOKING_KEY;

    const { next } = run(sign(REAL_LOOKING_KEY));

    expect(next).toHaveBeenCalledOnce();
  });
});

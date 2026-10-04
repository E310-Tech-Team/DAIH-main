import { describe, it, expect, afterEach, vi } from "vitest";
import { config } from "../../config/env.js";
import { PaystackClient } from "./paystack.client.js";

// Fixture keys are assembled at runtime so secret scanners don't mistake them for real ones.
const HEX40 = "0123456789abcdef".repeat(3).slice(0, 40);
const REAL_LOOKING_KEY = `sk_live_${HEX40}`;

describe("PaystackClient environment safety", () => {
  const originalEnv = config.env;

  afterEach(() => {
    config.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("uses mock responses in tests, echoing the expected amount", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await new PaystackClient("sk_test_mock").verifyTransaction(
      "DAIH-PAY-TEST",
      420000,
    );

    expect(result?.data.status).toBe("success");
    expect(result?.data.amount).toBe(420000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never mocks in production: a mock key fails closed without calling Paystack", async () => {
    config.env = "production";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const client = new PaystackClient("sk_test_mock");

    await expect(
      client.verifyTransaction("DAIH-PAY-PROD"),
    ).rejects.toMatchObject({
      code: "PAYMENTS_NOT_CONFIGURED",
      statusCode: 503,
    });
    await expect(
      client.initializeTransaction({
        email: "member@example.com",
        amount: 100000,
        reference: "DAIH-PAY-PROD",
      }),
    ).rejects.toMatchObject({ code: "PAYMENTS_NOT_CONFIGURED" });
    await expect(
      client.createRefund({ transaction: "DAIH-PAY-PROD" }),
    ).rejects.toMatchObject({ code: "PAYMENTS_NOT_CONFIGURED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed in production with the template key from .env.example", async () => {
    config.env = "production";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      new PaystackClient("sk_live_xxx").verifyTransaction("DAIH-PAY-PROD"),
    ).rejects.toMatchObject({ code: "PAYMENTS_NOT_CONFIGURED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks Paystack for the real result in production", async () => {
    config.env = "production";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        message: "Verification successful",
        data: { status: "success", reference: "DAIH-PAY-PROD", amount: 123400 },
      }),
    } as Response);

    const result = await new PaystackClient(REAL_LOOKING_KEY).verifyTransaction(
      "DAIH-PAY-PROD",
      999999,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result?.data.amount).toBe(123400);
  });
});

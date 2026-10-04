import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generateSignedQrToken,
  verifyAndParseQrToken,
  QrTokenPayload,
} from "../src/modules/access/qr-token.util.js";

describe("QR Pass Cryptographic Security & Key Rotation (DAIH-QA-04)", () => {
  const samplePayload: QrTokenPayload = {
    bookingId: "bk_sample_123",
    reference: "DAIH-PASS-001",
    userId: "usr_alice_456",
    startTime: new Date().toISOString(),
    endTime: new Date(Date.now() + 3600000).toISOString(),
    issuedAt: Date.now(),
  };

  it("should generate a 4-part token with key ID (daih_pass_v1.<kid>.<payload>.<sig>)", () => {
    const token = generateSignedQrToken(samplePayload);
    const parts = token.split(".");

    expect(parts.length).toBe(4);
    expect(parts[0]).toBe("daih_pass_v1");
    expect(parts[1]).toBe("v1"); // Default active key ID
    expect(parts[2].length).toBeGreaterThan(0);
    expect(parts[3].length).toBeGreaterThan(0);
  });

  it("should verify successfully with active key ID", () => {
    const token = generateSignedQrToken(samplePayload);
    const result = verifyAndParseQrToken(token);

    expect(result.valid).toBe(true);
    expect(result.payload?.bookingId).toBe("bk_sample_123");
    expect(result.payload?.reference).toBe("DAIH-PASS-001");
  });

  it("should support key rotation via keyring without invalidating valid passes", () => {
    const originalKeyring = process.env.QR_SIGNING_KEYRING;
    const originalActive = process.env.QR_ACTIVE_KEY_ID;

    try {
      // Simulate keyring with two valid keys: key-2026-q1 and key-2026-q2
      process.env.QR_SIGNING_KEYRING = JSON.stringify({
        "key-2026-q1": "secret-for-quarter-1-vintage",
        "key-2026-q2": "secret-for-quarter-2-rotated",
      });

      // Pass issued under old active key
      const passQuarter1 = generateSignedQrToken(samplePayload, "key-2026-q1");
      expect(passQuarter1.split(".")[1]).toBe("key-2026-q1");

      // Pass issued under new active key
      const passQuarter2 = generateSignedQrToken(samplePayload, "key-2026-q2");
      expect(passQuarter2.split(".")[1]).toBe("key-2026-q2");

      // Both passes verify successfully against the keyring
      const verifyQ1 = verifyAndParseQrToken(passQuarter1);
      const verifyQ2 = verifyAndParseQrToken(passQuarter2);

      expect(verifyQ1.valid).toBe(true);
      expect(verifyQ2.valid).toBe(true);
    } finally {
      process.env.QR_SIGNING_KEYRING = originalKeyring;
      process.env.QR_ACTIVE_KEY_ID = originalActive;
    }
  });

  it("should reject passes signed with an unknown or retired key ID", () => {
    const token = generateSignedQrToken(samplePayload, "retired-key-999");
    const result = verifyAndParseQrToken(token);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("INVALID_KEY_ID");
    expect(result.message).toContain("Unknown or retired key ID");
  });

  it("should maintain backward-compatibility with legacy 3-part tokens", () => {
    // Manually construct legacy 3-part format: daih_pass_v1.<payload_b64>.<sig_b64>
    const crypto = require("crypto");
    const base64Url = (str: string) =>
      Buffer.from(str)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    const payloadB64 = base64Url(JSON.stringify(samplePayload));
    const dataToSign = `daih_pass_v1.${payloadB64}`;
    const secret =
      process.env.QR_SIGNING_SECRET || "dev-qr-signing-key-1234567890";
    const sig = crypto
      .createHmac("sha256", secret)
      .update(dataToSign)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const legacyToken = `daih_pass_v1.${payloadB64}.${sig}`;
    expect(legacyToken.split(".").length).toBe(3);

    const result = verifyAndParseQrToken(legacyToken);
    expect(result.valid).toBe(true);
    expect(result.payload?.bookingId).toBe("bk_sample_123");
  });

  it("should safely reject signatures of unequal length without throwing timingSafeEqual errors", () => {
    const token = generateSignedQrToken(samplePayload);
    const parts = token.split(".");

    // Short signature
    const shortSigToken = `${parts[0]}.${parts[1]}.${parts[2]}.short`;
    const resShort = verifyAndParseQrToken(shortSigToken);
    expect(resShort.valid).toBe(false);
    expect(resShort.error).toBe("INVALID_SIGNATURE");

    // Overly long signature
    const longSigToken = `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]}extra_data_padding`;
    const resLong = verifyAndParseQrToken(longSigToken);
    expect(resLong.valid).toBe(false);
    expect(resLong.error).toBe("INVALID_SIGNATURE");

    // Completely empty signature
    const emptySigToken = `${parts[0]}.${parts[1]}.${parts[2]}.`;
    const resEmpty = verifyAndParseQrToken(emptySigToken);
    expect(resEmpty.valid).toBe(false);
  });
});

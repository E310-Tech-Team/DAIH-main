import crypto from "crypto";
import { config } from "../../config/env.js";

export interface QrTokenPayload {
  bookingId: string;
  reference: string;
  userId: string;
  startTime: string;
  endTime: string;
  issuedAt: number;
}

const QR_TOKEN_PREFIX = "daih_pass_v1";

export function getActiveKeyId(): string {
  return process.env.QR_ACTIVE_KEY_ID || "v1";
}

export function getKeyring(): Record<string, string> {
  const activeKid = getActiveKeyId();
  const activeSecret =
    config.qrSigningSecret || "dev-qr-signing-key-1234567890";
  const keyring: Record<string, string> = {
    [activeKid]: activeSecret,
    v1: activeSecret,
    primary: activeSecret,
  };

  if (process.env.QR_SIGNING_KEYRING) {
    try {
      const parsed = JSON.parse(process.env.QR_SIGNING_KEYRING);
      Object.assign(keyring, parsed);
    } catch {
      process.env.QR_SIGNING_KEYRING.split(",").forEach((pair) => {
        const [k, v] = pair.split(":");
        if (k && v) keyring[k.trim()] = v.trim();
      });
    }
  }

  return keyring;
}

export function getKeyForKid(kid: string): string | undefined {
  const keyring = getKeyring();
  return keyring[kid];
}

/**
 * Encodes string to URL-safe Base64 without padding
 */
function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decodes URL-safe Base64 string
 */
function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf8");
}

/**
 * Generates a cryptographically signed digital access pass token (HMAC-SHA256).
 * Output format: "daih_pass_v1.<kid>.<payload_b64>.<signature_b64>"
 */
export function generateSignedQrToken(
  payload: QrTokenPayload,
  kid: string = getActiveKeyId(),
): string {
  const secret =
    getKeyForKid(kid) ||
    config.qrSigningSecret ||
    "dev-qr-signing-key-1234567890";
  const serialized = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(serialized);
  const dataToSign = `${QR_TOKEN_PREFIX}.${kid}.${payloadB64}`;

  const signature = crypto
    .createHmac("sha256", secret)
    .update(dataToSign)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${dataToSign}.${signature}`;
}

export interface QrTokenParseResult {
  valid: boolean;
  payload?: QrTokenPayload;
  error?:
    | "MALFORMED_TOKEN"
    | "INVALID_SIGNATURE"
    | "UNSUPPORTED_VERSION"
    | "INVALID_KEY_ID";
  message?: string;
}

/**
 * Verifies cryptographic signature of a QR pass token and extracts payload.
 * Supports both 4-part rotated key format and backward-compatible 3-part format.
 * Validates buffer lengths before timingSafeEqual to avoid timing attack oracles.
 */
export function verifyAndParseQrToken(tokenString: string): QrTokenParseResult {
  if (!tokenString || typeof tokenString !== "string") {
    return {
      valid: false,
      error: "MALFORMED_TOKEN",
      message: "Access token is empty or invalid",
    };
  }

  const parts = tokenString.trim().split(".");
  if (parts.length !== 3 && parts.length !== 4) {
    return {
      valid: false,
      error: "MALFORMED_TOKEN",
      message: "Access token format is malformed",
    };
  }

  let prefix: string;
  let kid: string;
  let payloadB64: string;
  let signatureB64: string;
  let dataToSign: string;
  let secret: string | undefined;

  if (parts.length === 4) {
    // Rotated key format: daih_pass_v1.<kid>.<payload_b64>.<signature_b64>
    [prefix, kid, payloadB64, signatureB64] = parts;
    if (prefix !== QR_TOKEN_PREFIX) {
      return {
        valid: false,
        error: "UNSUPPORTED_VERSION",
        message: `Unsupported access token format '${prefix}'`,
      };
    }
    secret = getKeyForKid(kid);
    if (!secret) {
      return {
        valid: false,
        error: "INVALID_KEY_ID",
        message: `Unknown or retired key ID '${kid}'`,
      };
    }
    dataToSign = `${prefix}.${kid}.${payloadB64}`;
  } else {
    // Backward-compatible 3-part format: daih_pass_v1.<payload_b64>.<signature_b64>
    [prefix, payloadB64, signatureB64] = parts;
    if (prefix !== QR_TOKEN_PREFIX) {
      return {
        valid: false,
        error: "UNSUPPORTED_VERSION",
        message: `Unsupported access token format '${prefix}'`,
      };
    }
    kid = "v1";
    secret =
      getKeyForKid(kid) ||
      config.qrSigningSecret ||
      "dev-qr-signing-key-1234567890";
    dataToSign = `${prefix}.${payloadB64}`;
  }

  const expectedSignatureB64 = crypto
    .createHmac("sha256", secret)
    .update(dataToSign)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const sigBuffer = Buffer.from(signatureB64, "utf8");
  const expectedSigBuffer = Buffer.from(expectedSignatureB64, "utf8");

  // Constant-time length guard: check buffer length equality before calling timingSafeEqual
  if (
    sigBuffer.length !== expectedSigBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedSigBuffer)
  ) {
    return {
      valid: false,
      error: "INVALID_SIGNATURE",
      message: "Access pass signature verification failed (tampered token)",
    };
  }

  try {
    const jsonStr = base64UrlDecode(payloadB64);
    const payload = JSON.parse(jsonStr) as QrTokenPayload;
    if (!payload.bookingId) {
      return {
        valid: false,
        error: "MALFORMED_TOKEN",
        message: "Missing booking ID in pass payload",
      };
    }
    return {
      valid: true,
      payload,
    };
  } catch (err: any) {
    return {
      valid: false,
      error: "MALFORMED_TOKEN",
      message: `Failed to decode access token payload: ${err?.message}`,
    };
  }
}

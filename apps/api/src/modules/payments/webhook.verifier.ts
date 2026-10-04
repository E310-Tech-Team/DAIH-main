import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../../config/env.js";
import { isRealPaystackSecretKey } from "./paystack-key.js";

export interface PaystackWebhookRequest extends Request {
  paystackEvent?: any;
  rawBody?: Buffer | string;
}

/**
 * Middleware that verifies Paystack HMAC-SHA512 webhook signature.
 * Uses timing-safe equality to prevent timing attacks.
 */
export function verifyPaystackWebhookSignature(
  req: PaystackWebhookRequest,
  res: Response,
  next: NextFunction,
) {
  const signature = req.headers["x-paystack-signature"] as string | undefined;

  if (!signature) {
    console.warn(
      "⚠️ Paystack webhook rejected: Missing 'x-paystack-signature' header",
    );
    return res.status(401).json({ error: "Missing signature header" });
  }

  // Paystack signs webhooks with the account's secret key; there is no separate webhook secret.
  const secret = config.paystack.secretKey;

  // A template or mock key is public (it ships in the repo), so signatures made with it prove nothing.
  if (config.env === "production" && !isRealPaystackSecretKey(secret)) {
    console.error(
      "❌ Paystack webhook rejected: PAYSTACK_SECRET_KEY is missing or a placeholder",
    );
    return res.status(503).json({ error: "Payments are not configured" });
  }

  if (!secret) {
    console.error(
      "❌ Paystack webhook rejected: PAYSTACK_SECRET_KEY not configured",
    );
    return res
      .status(500)
      .json({ error: "Server payment configuration error" });
  }

  // Get raw body buffer
  let rawBody: Buffer;
  if (Buffer.isBuffer(req.body)) {
    rawBody = req.body;
  } else if (typeof req.body === "string") {
    rawBody = Buffer.from(req.body, "utf8");
  } else if ((req as any).rawBody && Buffer.isBuffer((req as any).rawBody)) {
    rawBody = (req as any).rawBody;
  } else {
    // If body was already parsed to JSON, serialize it back (fallback)
    rawBody = Buffer.from(JSON.stringify(req.body || {}), "utf8");
  }

  try {
    const computedHash = crypto
      .createHmac("sha512", secret)
      .update(rawBody)
      .digest("hex");

    const signatureBuffer = Buffer.from(signature, "utf8");
    const hashBuffer = Buffer.from(computedHash, "utf8");

    if (
      signatureBuffer.length !== hashBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, hashBuffer)
    ) {
      console.warn("⚠️ Paystack webhook rejected: Invalid signature match");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Parse payload into paystackEvent
    if (Buffer.isBuffer(req.body) || typeof req.body === "string") {
      req.paystackEvent = JSON.parse(rawBody.toString("utf8"));
    } else {
      req.paystackEvent = req.body;
    }

    next();
  } catch (err: any) {
    console.error(
      "❌ Paystack webhook signature verification error:",
      err.message,
    );
    return res.status(400).json({ error: "Malformed webhook payload" });
  }
}

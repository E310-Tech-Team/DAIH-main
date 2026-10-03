import crypto from "node:crypto";
import { redis, isRedisAvailable } from "../../config/redis.js";
import { safeLogger } from "../../utils/sanitizer.js";

export interface OAuthExchangeData {
  accessToken: string;
  rawRefreshToken?: string;
  user: any;
  isNewUser?: boolean;
  needsConsent?: boolean;
  destination: string;
  codeChallenge?: string | null;
}

interface InProcessExchangeEntry {
  data: OAuthExchangeData;
  expiresAt: number;
}

const inProcessExchangeStore = new Map<string, InProcessExchangeEntry>();

export class OAuthExchangeService {
  private getRedisKey(code: string): string {
    return `daih:oauth:exchange:${code}`;
  }

  /**
   * Stores OAuth exchange data associated with a single-use authorization code.
   * TTL defaults to 60 seconds.
   */
  async storeExchangeCode(
    code: string,
    data: OAuthExchangeData,
    ttlSeconds = 60,
  ): Promise<void> {
    const serialized = JSON.stringify(data);

    // Primary store: Redis
    if (isRedisAvailable()) {
      try {
        await redis.set(this.getRedisKey(code), serialized, "EX", ttlSeconds);
        return;
      } catch (err: any) {
        safeLogger.warn(
          `[OAuthExchange] Failed to store code in Redis, falling back to in-memory store: ${err?.message || err}`,
        );
      }
    }

    // In-memory fallback
    inProcessExchangeStore.set(code, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });

    // Housekeeping: clean expired entries
    if (inProcessExchangeStore.size > 1000) {
      const now = Date.now();
      for (const [k, v] of inProcessExchangeStore.entries()) {
        if (now > v.expiresAt) {
          inProcessExchangeStore.delete(k);
        }
      }
    }
  }

  /**
   * Atomically consumes a single-use authorization code (burn-on-read).
   * Validates PKCE codeVerifier against stored codeChallenge if PKCE was requested.
   */
  async exchangeCode(
    code: string,
    codeVerifier?: string,
  ): Promise<OAuthExchangeData> {
    let rawData: string | null = null;
    let foundInMemory = false;
    let inMemoryData: OAuthExchangeData | null = null;

    // 1. Try atomic get and delete from Redis
    if (isRedisAvailable()) {
      try {
        const key = this.getRedisKey(code);
        // Multi get and del to guarantee single-use consumption even on first attempt
        const results = await redis.multi().get(key).del(key).exec();
        if (results && results[0] && results[0][1]) {
          rawData = results[0][1] as string;
        }
      } catch (err: any) {
        safeLogger.warn(
          `[OAuthExchange] Failed to consume code from Redis: ${err?.message || err}`,
        );
      }
    }

    // 2. Fallback to in-process memory store (single-use delete)
    if (!rawData) {
      const entry = inProcessExchangeStore.get(code);
      if (entry) {
        inProcessExchangeStore.delete(code); // Burn immediately on first attempt
        if (Date.now() <= entry.expiresAt) {
          foundInMemory = true;
          inMemoryData = entry.data;
        }
      }
    }

    if (!rawData && !foundInMemory) {
      const error: any = new Error(
        "Invalid or expired authorization code. Please initiate sign-in again.",
      );
      error.code = "INVALID_AUTH_CODE";
      error.statusCode = 400;
      throw error;
    }

    const payload: OAuthExchangeData = rawData
      ? JSON.parse(rawData)
      : inMemoryData!;

    // 3. PKCE Verification (if codeChallenge was bound at initiation)
    if (payload.codeChallenge) {
      if (!codeVerifier) {
        const error: any = new Error(
          "PKCE code_verifier is required to exchange this authorization code.",
        );
        error.code = "PKCE_VERIFIER_REQUIRED";
        error.statusCode = 400;
        throw error;
      }

      const computedChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

      if (computedChallenge !== payload.codeChallenge) {
        const error: any = new Error(
          "PKCE verification failed: code_verifier does not match code_challenge.",
        );
        error.code = "PKCE_VERIFICATION_FAILED";
        error.statusCode = 400;
        throw error;
      }
    }

    return payload;
  }
}

export const oauthExchangeService = new OAuthExchangeService();

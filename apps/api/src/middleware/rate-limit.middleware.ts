import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis, isRedisAvailable } from "../config/redis.js";
import { config } from "../config/env.js";
import { getVerifiedClientIp } from "../utils/fingerprint.js";
import { safeLogger, sanitizeMessage } from "../utils/sanitizer.js";

let hasLoggedRateLimitStoreError = false;

function createRedisStore(prefix: string) {
  if (
    config.env === "test" ||
    !config.redisUrl ||
    config.redisUrl.includes("********")
  ) {
    return undefined;
  }
  try {
    return new RedisStore({
      sendCommand: async (...args: string[]) => {
        try {
          return await (redis.call as any)(...args);
        } catch (err: any) {
          if (!hasLoggedRateLimitStoreError && config.env !== "test") {
            hasLoggedRateLimitStoreError = true;
            safeLogger.warn(
              `[RateLimit:StoreNotice] Redis rate limit store unreachable (${sanitizeMessage(err?.message || err)}). Permitting request.`,
            );
            setTimeout(() => {
              hasLoggedRateLimitStoreError = false;
            }, 60000);
          }
          throw err;
        }
      },
      prefix: `daih:rl:${prefix}:`,
    });
  } catch (err: any) {
    return undefined;
  }
}

const standardHandler = (_req: Request, res: Response) => {
  res.status(429).json({
    code: "RATE_LIMIT_EXCEEDED",
    message: "Too many requests. Please slow down and try again later.",
  });
};

const skipInTest = () => config.env === "test" || Boolean(process.env.VITEST);

/**
 * 1. IP-based Login Rate Limiter (20 attempts per 15 mins per IP)
 * Protects against credential spraying from a single IP
 */
export const loginIpRateLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMinutes * 60 * 1000,
  max: Math.max(20, config.rateLimit.loginMax * 4),
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore("login-ip"),
  keyGenerator: (req: Request) => {
    return getVerifiedClientIp(req) || "unknown";
  },
  handler: standardHandler,
  skip: skipInTest,
});

/**
 * 2. Account-based Login Rate Limiter (5 attempts per 15 mins per email)
 * Protects against distributed botnet brute-forcing of a single victim account
 */
export const loginAccountRateLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMinutes * 60 * 1000,
  max: config.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore("login-acct"),
  keyGenerator: (req: Request) => {
    const email = req.body?.email
      ? String(req.body.email).toLowerCase().trim()
      : "";
    return email || getVerifiedClientIp(req) || "unknown";
  },
  handler: standardHandler,
  skip: skipInTest,
});

/**
 * Composite Dual-Layer Login Rate Limiter (runs IP check then Account check)
 */
export const loginRateLimiter = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  loginIpRateLimiter(req, res, (err) => {
    if (err) return next(err);
    loginAccountRateLimiter(req, res, next);
  });
};

/**
 * Rate Limiter for Registration Endpoint (10 per hour by default)
 */
export const registrationRateLimiter = rateLimit({
  windowMs: config.rateLimit.registerWindowMinutes * 60 * 1000,
  max: config.rateLimit.registerMax,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore("reg"),
  keyGenerator: (req: Request) => {
    return getVerifiedClientIp(req) || "unknown";
  },
  handler: standardHandler,
  skip: skipInTest,
});

/**
 * Rate Limiter for Verification Resend (3 per hour by default)
 */
export const verificationResendRateLimiter = rateLimit({
  windowMs: config.rateLimit.verifyResendWindowMinutes * 60 * 1000,
  max: config.rateLimit.verifyResendMax,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore("vresend"),
  keyGenerator: (req: Request) => {
    const email = req.body?.email
      ? String(req.body.email).toLowerCase().trim()
      : "";
    return email || getVerifiedClientIp(req) || "unknown";
  },
  handler: standardHandler,
  skip: skipInTest,
});

/**
 * Rate Limiter for Password Reset Request (3 per hour by default)
 */
export const passwordResetRateLimiter = rateLimit({
  windowMs: config.rateLimit.passwordResetWindowMinutes * 60 * 1000,
  max: config.rateLimit.passwordResetMax,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore("pwreset"),
  keyGenerator: (req: Request) => {
    const email = req.body?.email
      ? String(req.body.email).toLowerCase().trim()
      : "";
    return email || getVerifiedClientIp(req) || "unknown";
  },
  handler: standardHandler,
  skip: skipInTest,
});

/**
 * Rate Limiter for Token Refresh Endpoint (burst protection: 30 per 15 min)
 */
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore("refresh"),
  keyGenerator: (req: Request) => {
    return getVerifiedClientIp(req) || "unknown";
  },
  handler: standardHandler,
  skip: skipInTest,
});

/**
 * Rate Limiter for OAuth Code Exchange Endpoint (10 per minute per IP)
 */
export const oauthExchangeRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore("oauth-exchange"),
  keyGenerator: (req: Request) => {
    return getVerifiedClientIp(req) || "unknown";
  },
  handler: standardHandler,
  skip: skipInTest,
});

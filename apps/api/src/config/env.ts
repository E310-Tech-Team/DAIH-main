import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { isRealPaystackSecretKey } from "../modules/payments/paystack-key.js";

// Find and load root .env as the primary source of truth
const cwd = process.cwd();
const possibleRootEnv = path.resolve(cwd, "../../.env");
const directRootEnv = path.resolve(cwd, ".env");

if (fs.existsSync(possibleRootEnv)) {
  dotenv.config({ path: possibleRootEnv, override: true });
} else if (fs.existsSync(directRootEnv)) {
  dotenv.config({ path: directRootEnv, override: true });
}
dotenv.config({ override: false });

export const config = {
  env: process.env.VITEST ? "test" : process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "4000", 10),
  databaseUrl:
    process.env.INTEGRATION_TEST_DB_URL ||
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/daih_db?schema=public",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  jwt: {
    secret: process.env.JWT_SECRET || "dev-secret-key-12345678901234567890",
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ||
      "dev-refresh-secret-12345678901234567890",
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
    refreshExpiresInDays: parseInt(process.env.JWT_REFRESH_DAYS || "7", 10),
    refreshGraceWindowMs: parseInt(
      process.env.REFRESH_GRACE_WINDOW_MS || "15000",
      10,
    ),
    verificationExpiresInHours: parseInt(
      process.env.VERIFICATION_EXPIRES_HOURS || "24",
      10,
    ),
    passwordResetExpiresInHours: parseInt(
      process.env.PASSWORD_RESET_EXPIRES_HOURS || "1",
      10,
    ),
  },
  mfa: {
    encryptionSecret:
      process.env.MFA_ENCRYPTION_SECRET ||
      process.env.JWT_SECRET ||
      "dev-secret-key-12345678901234567890",
  },
  google: {
    clientId:
      process.env.GOOGLE_CLIENT_ID ||
      "mock-google-client-id.apps.googleusercontent.com",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ||
      "http://localhost:4000/api/v1/identity/oauth/google/callback",
  },
  cookies: {
    refreshCookieName:
      process.env.COOKIE_NAME ||
      process.env.REFRESH_COOKIE_NAME ||
      "daih_refresh_token",
    domain:
      process.env.COOKIE_DOMAIN ||
      process.env.REFRESH_COOKIE_DOMAIN ||
      undefined,
    secure:
      process.env.COOKIE_SECURE !== undefined
        ? process.env.COOKIE_SECURE === "true"
        : process.env.NODE_ENV === "production",
    sameSite:
      (process.env.COOKIE_SAME_SITE as "lax" | "strict" | "none") || "lax",
    path: process.env.COOKIE_PATH || "/api/v1/identity",
  },
  superAdmin: {
    email: process.env.SUPER_ADMIN_EMAIL || "admin@daih.ng",
    password: process.env.SUPER_ADMIN_PASSWORD || "SuperAdminPassword123!",
    firstName: process.env.SUPER_ADMIN_FIRST_NAME || "Super",
    lastName: process.env.SUPER_ADMIN_LAST_NAME || "Administrator",
    phoneNumber: process.env.SUPER_ADMIN_PHONE || "07042504389",
  },
  frontendUrls: {
    customer: process.env.FRONTEND_CUSTOMER_URL || "http://localhost:3001",
    admin: process.env.FRONTEND_ADMIN_URL || "http://localhost:3003",
    web: process.env.FRONTEND_WEB_URL || "http://localhost:3000",
    reception: process.env.FRONTEND_RECEPTION_URL || "http://localhost:3002",
  },
  cors: {
    allowedOrigins: Array.from(
      new Set(
        [
          ...(process.env.NODE_ENV === "production"
            ? [
                "https://daih.ng",
                "https://app.daih.ng",
                "https://admin.daih.ng",
                "https://reception.daih.ng",
              ]
            : []),
          ...(process.env.CORS_ALLOWED_ORIGINS
            ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim())
            : process.env.ALLOWED_ORIGINS
              ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
              : []),
          process.env.FRONTEND_CUSTOMER_URL || "http://localhost:3001",
          process.env.FRONTEND_ADMIN_URL || "http://localhost:3003",
          process.env.FRONTEND_WEB_URL || "http://localhost:3000",
          process.env.FRONTEND_RECEPTION_URL || "http://localhost:3002",
        ]
          .filter(Boolean)
          .map((o) => o.replace(/\/$/, "").toLowerCase()),
      ),
    ),
  },
  email: {
    provider: process.env.EMAIL_PROVIDER || "auto", // 'auto' | 'resend' | 'zeptomail' | 'mock'
    resendApiKey: process.env.RESEND_API_KEY || "",
    resendFromEmail:
      process.env.RESEND_FROM_EMAIL || "DAIH Hub <noreply@daih.ng>",
    zeptomailApiKey: process.env.ZEPTOMAIL_API_KEY || "",
    zeptomailFromEmail:
      process.env.ZEPTOMAIL_FROM_EMAIL || "DAIH Hub <noreply@daih.ng>",
    zeptomailApiUrl:
      process.env.ZEPTOMAIL_API_URL || "https://api.zeptomail.com/v1.1/email",
  },
  rateLimit: {
    loginMax: parseInt(process.env.RATE_LIMIT_LOGIN_MAX || "5", 10),
    loginWindowMinutes: parseInt(
      process.env.RATE_LIMIT_LOGIN_WINDOW || "15",
      10,
    ),
    registerMax: parseInt(process.env.RATE_LIMIT_REGISTER_MAX || "10", 10),
    registerWindowMinutes: parseInt(
      process.env.RATE_LIMIT_REGISTER_WINDOW || "60",
      10,
    ),
    verifyResendMax: parseInt(process.env.RATE_LIMIT_VERIFY_MAX || "3", 10),
    verifyResendWindowMinutes: parseInt(
      process.env.RATE_LIMIT_VERIFY_WINDOW || "60",
      10,
    ),
    passwordResetMax: parseInt(process.env.RATE_LIMIT_RESET_MAX || "3", 10),
    passwordResetWindowMinutes: parseInt(
      process.env.RATE_LIMIT_RESET_WINDOW || "60",
      10,
    ),
  },
  observability: {
    sentryDsn: process.env.SENTRY_DSN || "",
    ddService: process.env.DD_SERVICE || "daih-api",
    ddEnv: process.env.DD_ENV || process.env.NODE_ENV || "development",
    ddVersion: process.env.DD_VERSION || "1.0.0",
  },
  tokenEncryptionKey:
    process.env.TOKEN_ENCRYPTION_KEY ||
    "dev-token-encryption-key-12345678901234567890",
  qrSigningSecret:
    process.env.QR_SIGNING_SECRET || "dev-qr-signing-key-1234567890",
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY || "sk_test_mock",
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || "pk_test_mock",
  },
  security: {
    alertWebhookUrl: process.env.SECURITY_ALERT_WEBHOOK_URL || "",
    redisOpTimeoutMs: parseInt(process.env.REDIS_OP_TIMEOUT_MS || "250", 10),
    circuitBreakerResetTimeoutMs: parseInt(
      process.env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS || "12000",
      10,
    ),
    trustedProxies: process.env.TRUSTED_PROXIES
      ? process.env.TRUSTED_PROXIES.split(",").map((s) => s.trim())
      : ["loopback", "linklocal", "uniquelocal"],
    originVerifySecret: process.env.ORIGIN_VERIFY_SECRET || undefined,
    enableDiagnosticIpEndpoint:
      process.env.ENABLE_DIAGNOSTIC_IP_ENDPOINT === "true",
  },
  payments: {
    minChargeNgn: parseFloat(process.env.PAYSTACK_MIN_CHARGE_NGN || "100.00"),
  },
  billing: {
    vatRate: parseFloat(process.env.BILLING_VAT_RATE || "0.075"),
  },
  features: {
    enableCoinRedemption: process.env.ENABLE_COIN_REDEMPTION === "true",
  },
};

/**
 * Startup validation to ensure production deployments do not run with insecure default secrets.
 */
export function validateProductionConfig(): void {
  if (config.env === "production") {
    const defaultSecrets = [
      "dev-secret-key-12345678901234567890",
      "dev-refresh-secret-12345678901234567890",
      "dev-token-encryption-key-12345678901234567890",
      "dev-qr-signing-key-1234567890",
    ];

    if (
      !process.env.JWT_SECRET ||
      defaultSecrets.includes(config.jwt.secret) ||
      config.jwt.secret.length < 32
    ) {
      throw new Error(
        "FATAL SECURITY ERROR: JWT_SECRET must be explicitly set and at least 32 characters long in production.",
      );
    }

    if (
      !process.env.JWT_REFRESH_SECRET ||
      defaultSecrets.includes(config.jwt.refreshSecret) ||
      config.jwt.refreshSecret.length < 32
    ) {
      throw new Error(
        "FATAL SECURITY ERROR: JWT_REFRESH_SECRET must be explicitly set and at least 32 characters long in production.",
      );
    }

    if (
      !process.env.TOKEN_ENCRYPTION_KEY ||
      defaultSecrets.includes(config.tokenEncryptionKey) ||
      config.tokenEncryptionKey.length < 32 ||
      config.tokenEncryptionKey === config.jwt.secret
    ) {
      throw new Error(
        "FATAL SECURITY ERROR: TOKEN_ENCRYPTION_KEY must be explicitly set, independent from JWT_SECRET, and at least 32 characters long in production.",
      );
    }

    if (
      !process.env.QR_SIGNING_SECRET ||
      defaultSecrets.includes(config.qrSigningSecret) ||
      config.qrSigningSecret.length < 32 ||
      config.qrSigningSecret === config.jwt.secret
    ) {
      throw new Error(
        "FATAL SECURITY ERROR: QR_SIGNING_SECRET must be explicitly set, independent from JWT_SECRET, and at least 32 characters long in production.",
      );
    }

    // Not fatal: the rest of the platform keeps running, but the Paystack client and
    // webhook verifier refuse to take or confirm payments until a real key is set.
    if (!isRealPaystackSecretKey(config.paystack.secretKey)) {
      console.error(
        "⚠️ PAYSTACK_SECRET_KEY is missing or a placeholder: payments and Paystack webhooks are disabled until it is set.",
      );
    }
    if (process.env.PAYSTACK_WEBHOOK_SECRET) {
      console.warn(
        "PAYSTACK_WEBHOOK_SECRET is no longer used: webhooks are verified with PAYSTACK_SECRET_KEY.",
      );
    }
  }
}

export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return false;
  const cleanOrigin = origin.replace(/\/$/, "").toLowerCase();

  const isExplicitlyAllowed = config.cors.allowedOrigins.some(
    (allowed) => allowed.replace(/\/$/, "").toLowerCase() === cleanOrigin,
  );
  if (isExplicitlyAllowed) return true;

  if (config.env !== "production") {
    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
      cleanOrigin,
    );
    const configuredTunnel = process.env.CLOUDFLARE_TUNNEL_URL?.replace(
      /\/$/,
      "",
    ).toLowerCase();
    const isConfiguredTunnel = configuredTunnel
      ? cleanOrigin === configuredTunnel
      : false;
    if (isLocalhost || isConfiguredTunnel) {
      return true;
    }
  }

  return false;
}

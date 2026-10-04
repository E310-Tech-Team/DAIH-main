import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import sharp from "sharp";
import {
  UserRole,
  BookingState,
  CustomerReferralsResponse,
  ReferralItem,
  getSafeRedirectUrl,
} from "@daih/types";
import { prisma } from "../../db/client.js";
import { config } from "../../config/env.js";
import { identityRepository } from "./identity.repository.js";
import { passwordService } from "./password.service.js";
import { clientIdService } from "./client-id.service.js";
import { sessionService } from "./session.service.js";
import { mfaService } from "./mfa.service.js";
import { OAuth2Client } from "google-auth-library";
import { enqueueNotification } from "../notifications/notifications.queue.js";
import {
  RegisterDTO,
  LoginDTO,
  LoginResult,
  MfaChallengeResult,
  MfaSetupRequiredResult,
  LoginSuccessResult,
  UserSummaryDTO,
  SessionContext,
  SetupAccountResult,
  GoogleAuthServiceDTO,
  GoogleAuthServiceResult,
  GoogleOAuthInitResult,
  GoogleOAuthCallbackDTO,
  GoogleOAuthCallbackResult,
  OnboardingAttributionDTO,
  DeactivateAccountDTO,
  ReactivateAccountDTO,
} from "./identity.types.js";
import {
  HoldStatus,
  RefundStatus,
  PaymentStatus,
  CoinLedgerAction,
} from "@prisma/client";
import { outboxService } from "../events/outbox.service.js";
import { redis, isRedisAvailable } from "../../config/redis.js";

/** Roles that must complete MFA before accessing the system */
const MFA_REQUIRED_ROLES = new Set<UserRole>([
  UserRole.RECEPTION_OFFICER,
  UserRole.SECURITY_OFFICER,
  UserRole.OPERATIONS_ADMIN,
  UserRole.FINANCE_OFFICER,
  UserRole.MANAGEMENT_VIEWER,
  UserRole.SUPER_ADMIN,
]);

/** Masks an email for display in MFA OTP hints, e.g. "peter@daih.ng" → "pe***@daih.ng" */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}

/** Generates a random uppercase 6-character alphanumeric referral code, e.g. REF-8K9M2X */
export function generateReferralCode(): string {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "REF-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

const googleClient = new OAuth2Client(config.google.clientId);

export class IdentityService {
  formatUserSummary(user: any): UserSummaryDTO {
    const hasGoogle = Boolean(
      (user.identities &&
        user.identities.some((i: any) => i.provider === "GOOGLE")) ||
      user.googleId,
    );
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      avatarUrl: user.avatarUrl || null,
      birthday: user.birthday || null,
      clientId: user.clientId,
      role: user.role as UserRole,
      isVerified: user.isVerified,
      onboardingCompleted: user.onboardingCompleted ?? true,
      createdAt: user.createdAt,
      referralCode: user.referralCode || null,
      hasPassword: Boolean(user.passwordHash),
      hasReferrer: Boolean(user.referredById),
      acquisitionSource: user.acquisitionSource || null,
      googleId: user.googleId || null,
      hasGoogleLinked: hasGoogle,
      mfaEnabled: Boolean(user.mfaEnabled),
      mfaMethod: (user.mfaMethod as any) || null,
      deactivatedAt: user.deactivatedAt || null,
    };
  }

  /**
   * Authenticates a customer with a Google ID token.
   * Enforces email_verified, stable googleId lookup, verified email linking, portal checks, and race-safe user creation.
   */
  async authenticateGoogle(
    dto: GoogleAuthServiceDTO,
    context: SessionContext = {},
  ): Promise<GoogleAuthServiceResult> {
    // 1. Verify Google ID token
    let payload: any;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: dto.idToken,
        audience: config.google.clientId,
      });
      payload = ticket.getPayload();
    } catch (err: any) {
      const error: any = new Error("Invalid or expired Google token");
      error.code = "INVALID_GOOGLE_TOKEN";
      error.statusCode = 401;
      throw error;
    }

    if (!payload || !payload.sub || !payload.email) {
      const error: any = new Error(
        "Google token does not contain required profile claims",
      );
      error.code = "INVALID_GOOGLE_TOKEN";
      error.statusCode = 401;
      throw error;
    }

    // 2. Strict email_verified check
    if (!payload.email_verified) {
      const error: any = new Error(
        "Your Google email address must be verified to sign in",
      );
      error.code = "GOOGLE_EMAIL_NOT_VERIFIED";
      error.statusCode = 401;
      throw error;
    }

    const googleId = payload.sub;
    const email = payload.email.toLowerCase();

    // 3. Lookup by googleId first, fallback to verified email
    let user = await identityRepository.findByGoogleId(googleId);
    let isNewUser = false;

    if (!user) {
      const existingByEmail = await identityRepository.findByEmail(email);

      if (existingByEmail) {
        user = existingByEmail;

        if ((user as any).deactivatedAt) {
          const error: any = new Error(
            "This account has been deactivated. Please contact support to reactivate your account.",
          );
          error.code = "ACCOUNT_DEACTIVATED";
          error.statusCode = 403;
          throw error;
        }

        // 4. Portal boundary check BEFORE any linking or side-effects!
        const requestedPortal = (
          dto.portal ||
          context.portal ||
          ""
        ).toLowerCase();
        if (requestedPortal === "customer" && user.role !== UserRole.CUSTOMER) {
          const error: any = new Error(
            "Access Denied: Staff and Administrator accounts cannot sign in through the customer portal.",
          );
          error.code = "STAFF_NOT_ALLOWED_ON_CUSTOMER_PORTAL";
          error.statusCode = 403;
          throw error;
        }
        if (requestedPortal === "admin" && user.role === UserRole.CUSTOMER) {
          const error: any = new Error(
            "Access Denied: Customer accounts cannot access the Staff & Admin Console.",
          );
          error.code = "CUSTOMER_NOT_ALLOWED_ON_ADMIN_PORTAL";
          error.statusCode = 403;
          throw error;
        }

        // Pre-hijacking defense: if existing user was registered via unverified password,
        // clear passwordHash and revoke active sessions before linking
        if (!existingByEmail.isVerified) {
          user = await identityRepository.clearPasswordAndRevokeSessions(
            existingByEmail.id,
          );
        }

        // Link account only if not already linked
        const existingIdentity = await identityRepository.findIdentity(
          "GOOGLE",
          googleId,
        );
        if (!existingIdentity) {
          user = await identityRepository.linkGoogleAccount(
            user.id,
            googleId,
            email,
          );

          // Enqueue security notification email via BullMQ
          try {
            await enqueueNotification(
              "security.account_linked",
              user.email,
              user.firstName,
              { provider: "Google" },
            );
          } catch (err: any) {
            console.warn(
              "Deferred account-linked security notification error:",
              err?.message,
            );
          }
        }
      } else {
        // 5. User does not exist -> Create new customer (portal check: new Google accounts are always CUSTOMER)
        const requestedPortal = (
          dto.portal ||
          context.portal ||
          ""
        ).toLowerCase();
        if (requestedPortal === "admin") {
          const error: any = new Error(
            "Access Denied: Customer accounts cannot access the Staff & Admin Console.",
          );
          error.code = "CUSTOMER_NOT_ALLOWED_ON_ADMIN_PORTAL";
          error.statusCode = 403;
          throw error;
        }

        isNewUser = true;

        // Resolve optional referral code
        let referredById: string | undefined = undefined;
        if (dto.referralCode && dto.referralCode.trim()) {
          const cleanRef = dto.referralCode.trim().toUpperCase();
          const referrer =
            await identityRepository.findByReferralCode(cleanRef);
          if (referrer) {
            referredById = referrer.id;
          }
        }

        // Generate clientId and user referral code
        const clientId = await clientIdService.generateNextClientId();
        let referralCode = generateReferralCode();
        let collision =
          await identityRepository.findByReferralCode(referralCode);
        while (collision) {
          referralCode = generateReferralCode();
          collision = await identityRepository.findByReferralCode(referralCode);
        }

        const firstName = payload.given_name || payload.name || "Customer";
        const lastName = payload.family_name || "";
        const avatarUrl = payload.picture || null;
        // If code resolves to an existing referrer: onboardingCompleted = true
        // If absent or invalid (typo): onboardingCompleted = false (user gets chance on /onboarding)
        const onboardingCompleted = Boolean(referredById);

        try {
          user = await identityRepository.createGoogleCustomer({
            providerUserId: googleId,
            email,
            firstName,
            lastName,
            clientId,
            avatarUrl,
            referralCode,
            referredById,
            onboardingCompleted,
          });
        } catch (err: any) {
          // Race condition check: Prisma unique constraint violation (P2002)
          if (err.code === "P2002") {
            user = await identityRepository.findByGoogleId(googleId);
            if (!user) {
              user = await identityRepository.findByEmail(email);
            }
            if (!user) {
              throw err;
            }
            isNewUser = false;
          } else {
            throw err;
          }
        }
      }
    } else {
      // User found by googleId -> check portal boundary
      if ((user as any).deactivatedAt) {
        const error: any = new Error(
          "This account has been deactivated. Please contact support to reactivate your account.",
        );
        error.code = "ACCOUNT_DEACTIVATED";
        error.statusCode = 403;
        throw error;
      }
      const requestedPortal = (
        dto.portal ||
        context.portal ||
        ""
      ).toLowerCase();
      if (requestedPortal === "customer" && user.role !== UserRole.CUSTOMER) {
        const error: any = new Error(
          "Access Denied: Staff and Administrator accounts cannot sign in through the customer portal.",
        );
        error.code = "STAFF_NOT_ALLOWED_ON_CUSTOMER_PORTAL";
        error.statusCode = 403;
        throw error;
      }
      if (requestedPortal === "admin" && user.role === UserRole.CUSTOMER) {
        const error: any = new Error(
          "Access Denied: Customer accounts cannot access the Staff & Admin Console.",
        );
        error.code = "CUSTOMER_NOT_ALLOWED_ON_ADMIN_PORTAL";
        error.statusCode = 403;
        throw error;
      }
    }

    const userSummary = this.formatUserSummary(user);

    // Check NDPR policy consent
    const consent = await prisma.policyConsent.findFirst({
      where: { userId: user.id, policyVersion: "1.0" },
    });
    const needsConsent = !consent;

    // Issue session
    const { accessToken, rawRefreshToken } = await sessionService.createSession(
      userSummary,
      context,
    );

    return {
      accessToken,
      rawRefreshToken,
      user: userSummary,
      isNewUser,
      needsOnboarding: !user.onboardingCompleted,
      needsConsent,
    };
  }

  /**
   * Generates Google OAuth URL with PKCE (code_verifier and code_challenge S256)
   * and an HMAC-signed state cookie preserving referral code and destination.
   */
  generateGoogleOAuthUrl(options: {
    referralCode?: string;
    destination?: string;
    portal?: string;
    codeChallenge?: string;
  }): GoogleOAuthInitResult {
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    const nonce = crypto.randomBytes(16).toString("hex");
    const safeDestination = getSafeRedirectUrl(
      options.destination,
      "/dashboard",
    );
    const statePayload = {
      nonce,
      ref: options.referralCode
        ? options.referralCode.trim().toUpperCase()
        : undefined,
      destination: safeDestination,
      portal: options.portal || "customer",
      clientCodeChallenge: options.codeChallenge || null,
      iat: Date.now(),
    };

    const encodedPayload = Buffer.from(JSON.stringify(statePayload)).toString(
      "base64url",
    );
    const signature = crypto
      .createHmac("sha256", config.jwt.secret)
      .update(encodedPayload)
      .digest("base64url");
    const state = `${encodedPayload}.${signature}`;

    const cookieData = Buffer.from(
      JSON.stringify({
        state,
        codeVerifier,
        destination: statePayload.destination,
        portal: statePayload.portal,
        ref: statePayload.ref,
      }),
    ).toString("base64url");
    const cookieSig = crypto
      .createHmac("sha256", config.jwt.secret)
      .update(cookieData)
      .digest("base64url");
    const cookieValue = `${cookieData}.${cookieSig}`;

    const params = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: config.google.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      access_type: "offline",
      prompt: "select_account",
    });

    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      stateCookie: {
        name: "daih_oauth_state",
        value: cookieValue,
        maxAge: 10 * 60 * 1000,
      },
    };
  }

  /**
   * Validates Google OAuth callback with PKCE, exchanges code for tokens,
   * performs anti-pre-hijacking account linking, checks NDPR consent, and issues session.
   */
  async handleGoogleOAuthCallback(
    dto: GoogleOAuthCallbackDTO,
    context: SessionContext = {},
  ): Promise<GoogleOAuthCallbackResult> {
    if (!dto.state || !dto.code) {
      const error: any = new Error("Missing OAuth state or authorization code");
      error.code = "INVALID_OAUTH_PARAMS";
      error.statusCode = 400;
      throw error;
    }

    if (!dto.stateCookie) {
      const error: any = new Error(
        "OAuth session cookie is missing or expired",
      );
      error.code = "OAUTH_SESSION_EXPIRED";
      error.statusCode = 400;
      throw error;
    }

    const [cookieData, cookieSig] = dto.stateCookie.split(".");
    if (!cookieData || !cookieSig) {
      const error: any = new Error("Invalid OAuth cookie format");
      error.code = "INVALID_OAUTH_COOKIE";
      error.statusCode = 400;
      throw error;
    }

    const expectedCookieSig = crypto
      .createHmac("sha256", config.jwt.secret)
      .update(cookieData)
      .digest("base64url");
    if (cookieSig !== expectedCookieSig) {
      const error: any = new Error("OAuth cookie tampering detected");
      error.code = "INVALID_OAUTH_COOKIE";
      error.statusCode = 400;
      throw error;
    }

    let parsedCookie: any;
    try {
      parsedCookie = JSON.parse(
        Buffer.from(cookieData, "base64url").toString("utf-8"),
      );
    } catch {
      const error: any = new Error("Invalid OAuth cookie payload");
      error.code = "INVALID_OAUTH_COOKIE";
      error.statusCode = 400;
      throw error;
    }

    if (parsedCookie.state !== dto.state) {
      const error: any = new Error("OAuth state mismatch");
      error.code = "OAUTH_STATE_MISMATCH";
      error.statusCode = 400;
      throw error;
    }

    const [payloadB64, sig] = dto.state.split(".");
    if (!payloadB64 || !sig) {
      const error: any = new Error("Invalid state format");
      error.code = "INVALID_OAUTH_STATE";
      error.statusCode = 400;
      throw error;
    }

    const expectedSig = crypto
      .createHmac("sha256", config.jwt.secret)
      .update(payloadB64)
      .digest("base64url");
    if (sig !== expectedSig) {
      const error: any = new Error("OAuth state tampering detected");
      error.code = "INVALID_OAUTH_STATE";
      error.statusCode = 400;
      throw error;
    }

    let statePayload: any;
    try {
      statePayload = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf-8"),
      );
    } catch {
      const error: any = new Error("Invalid state payload");
      error.code = "INVALID_OAUTH_STATE";
      error.statusCode = 400;
      throw error;
    }

    if (Date.now() - statePayload.iat > 10 * 60 * 1000) {
      const error: any = new Error(
        "OAuth state has expired. Please try signing in again.",
      );
      error.code = "OAUTH_STATE_EXPIRED";
      error.statusCode = 400;
      throw error;
    }

    // Exchange authorization code for tokens
    const oauth2Client = new OAuth2Client(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri,
    );

    let idToken: string;
    try {
      const { tokens } = await oauth2Client.getToken({
        code: dto.code,
        codeVerifier: parsedCookie.codeVerifier,
      });
      if (!tokens.id_token) {
        throw new Error("Missing id_token in Google token response");
      }
      idToken = tokens.id_token;
    } catch (err: any) {
      const error: any = new Error(
        "Failed to exchange authorization code with Google: " +
          (err.message || err),
      );
      error.code = "OAUTH_EXCHANGE_FAILED";
      error.statusCode = 400;
      throw error;
    }

    const authResult = await this.authenticateGoogle(
      {
        idToken,
        referralCode: statePayload.ref,
        portal: statePayload.portal,
      },
      context,
    );

    return {
      accessToken: authResult.accessToken,
      rawRefreshToken: authResult.rawRefreshToken,
      user: authResult.user,
      isNewUser: authResult.isNewUser,
      needsConsent: Boolean(authResult.needsConsent),
      destination: getSafeRedirectUrl(statePayload.destination, "/dashboard"),
      clientCodeChallenge: statePayload.clientCodeChallenge || null,
    };
  }

  /**
   * Captures NDPR Policy Consent for an authenticated user and logs outbox event.
   */
  async capturePolicyConsent(
    userId: string,
    dto: { policyVersion: string; consented: boolean },
  ): Promise<UserSummaryDTO> {
    if (!dto.consented) {
      const error: any = new Error(
        "You must accept the terms and privacy policy to continue.",
      );
      error.code = "CONSENT_REQUIRED";
      error.statusCode = 400;
      throw error;
    }

    const user = await identityRepository.findById(userId);
    if (!user) {
      const error: any = new Error("User not found");
      error.code = "USER_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    await prisma.$transaction(async (tx) => {
      await tx.policyConsent.create({
        data: {
          userId,
          policyVersion: dto.policyVersion || "1.0",
          purpose: "NDPR_TERMS_AND_PRIVACY",
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: "identity.policy_consent_captured",
          aggregateType: "PolicyConsent",
          aggregateId: userId,
          payload: {
            userId,
            policyVersion: dto.policyVersion || "1.0",
            consentedAt: new Date().toISOString(),
          },
        },
      });
    });

    return this.formatUserSummary(user);
  }

  /**
   * Submits post-signup onboarding attribution and optional referral code.
   * Strictly locks once onboarding is completed (or skipped).
   */
  async submitOnboardingAttribution(
    userId: string,
    dto: OnboardingAttributionDTO,
  ): Promise<UserSummaryDTO> {
    const user = await identityRepository.findById(userId);
    if (!user) {
      const error: any = new Error("User not found");
      error.code = "USER_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    // 1. AIRTIGHT LOCK: If onboarding is already completed or skipped, silently return profile
    if (user.onboardingCompleted) {
      return this.formatUserSummary(user);
    }

    let referredById = user.referredById;

    // 2. Resolve optional referral code
    if (dto.referralCode && dto.referralCode.trim() && !referredById) {
      const cleanCode = dto.referralCode.trim().toUpperCase();
      const referrer = await identityRepository.findByReferralCode(cleanCode);

      // Anti-self and anti-cyclic referral check ($A -> B -> A)
      if (
        referrer &&
        referrer.id !== userId &&
        referrer.referredById !== userId
      ) {
        referredById = referrer.id;
      }
    }

    // 3. Mark onboardingCompleted: true permanently and store acquisitionSource if provided
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        referredById,
        onboardingCompleted: true,
        ...(dto.source && dto.source.trim()
          ? { acquisitionSource: dto.source.trim() }
          : {}),
      },
    });

    return this.formatUserSummary(updated);
  }

  /**
   * Registers a new customer account
   */
  async register(
    dto: RegisterDTO,
  ): Promise<{ user: UserSummaryDTO; verificationSent: boolean }> {
    const existing = await identityRepository.findByEmail(dto.email);
    if (existing) {
      if ((existing as any).deactivatedAt) {
        const error: any = new Error(
          "An account with this email has been deactivated. Please contact support to reactivate your account.",
        );
        error.code = "ACCOUNT_DEACTIVATED";
        error.statusCode = 403;
        throw error;
      }
      const error: any = new Error("An account with this email already exists");
      error.code = "EMAIL_ALREADY_EXISTS";
      error.statusCode = 409;
      throw error;
    }

    const passwordHash = await passwordService.hashPassword(dto.password);
    const clientId = await clientIdService.generateNextClientId();

    const rawVerificationToken = passwordService.generateSecureToken(32);
    const verificationTokenHash =
      passwordService.hashToken(rawVerificationToken);

    // Resolve optional referrer
    let referredById: string | undefined = undefined;
    if (dto.referralCode && dto.referralCode.trim()) {
      const referrer = await identityRepository.findByReferralCode(
        dto.referralCode.trim(),
      );
      if (referrer) {
        referredById = referrer.id;
      }
    }

    // Generate unique referral code for the new user
    let referralCode = generateReferralCode();
    let collision = await identityRepository.findByReferralCode(referralCode);
    while (collision) {
      referralCode = generateReferralCode();
      collision = await identityRepository.findByReferralCode(referralCode);
    }

    const user = await identityRepository.createCustomer({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      phoneNumber: dto.phoneNumber,
      passwordHash,
      clientId,
      policyVersion: dto.policyVersion || "1.0",
      rawVerificationToken,
      verificationTokenHash,
      referralCode,
      referredById,
    });

    const userSummary: UserSummaryDTO = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      avatarUrl: (user as any).avatarUrl || null,
      birthday: (user as any).birthday || null,
      clientId: user.clientId,
      role: user.role as UserRole,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
      referralCode: user.referralCode || null,
    };

    return {
      user: userSummary,
      verificationSent: true,
    };
  }

  /**
   * Verifies customer email using verification token
   */
  async verifyEmail(rawToken: string): Promise<UserSummaryDTO> {
    const tokenHash = passwordService.hashToken(rawToken);

    try {
      const user = await identityRepository.verifyUserByTokenHash(tokenHash);
      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        avatarUrl: (user as any).avatarUrl || null,
        birthday: (user as any).birthday || null,
        clientId: user.clientId,
        role: user.role as UserRole,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
        referralCode: user.referralCode || null,
      };
    } catch (err: any) {
      const error: any = new Error(
        err.message === "TOKEN_ALREADY_USED"
          ? "This verification token has already been used"
          : err.message === "TOKEN_EXPIRED"
            ? "This verification token has expired"
            : "Invalid or expired verification token",
      );
      error.code = err.message || "INVALID_VERIFICATION_TOKEN";
      error.statusCode = 400;
      throw error;
    }
  }

  /**
   * Resends verification email for unverified user
   */
  async resendVerification(
    email: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = await identityRepository.findByEmail(email);
    if (user && !user.isVerified) {
      const rawToken = passwordService.generateSecureToken(32);
      const tokenHash = passwordService.hashToken(rawToken);
      await identityRepository.createVerificationToken(
        user.id,
        tokenHash,
        rawToken,
        user.email,
        user.firstName,
      );
    }

    return {
      success: true,
      message:
        "If an unverified account exists with that email, a verification link has been sent.",
    };
  }

  /**
   * Logs in a user.
   *
   * For CUSTOMER accounts: returns full session immediately.
   * For all staff/admin roles: enforces MFA.
   *   - If MFA not yet configured → returns { requiresMfaSetup, setupToken }
   *   - If MFA configured → returns { requiresMfa, mfaChallengeToken, method }
   *     (for EMAIL_OTP, also fires the OTP email)
   */
  async login(
    dto: LoginDTO,
    context: SessionContext = {},
  ): Promise<LoginResult> {
    const user = await identityRepository.findByEmail(dto.email);

    // Timing attack mitigation: always execute Argon2 password verification
    const hashToVerify = user?.passwordHash || passwordService.getDummyHash();
    const isValidPassword = await passwordService.verifyPassword(
      hashToVerify,
      dto.password,
    );

    if (!user || !user.passwordHash || !isValidPassword) {
      const error: any = new Error("Invalid email or password");
      error.code = "INVALID_CREDENTIALS";
      error.statusCode = 401;
      throw error;
    }

    if (!user.isVerified) {
      const error: any = new Error(
        "Please verify your email address before logging in",
      );
      error.code = "EMAIL_NOT_VERIFIED";
      error.statusCode = 403;
      throw error;
    }

    if ((user as any).deactivatedAt) {
      const error: any = new Error(
        "This account has been deactivated. Please contact support to reactivate your account.",
      );
      error.code = "ACCOUNT_DEACTIVATED";
      error.statusCode = 403;
      throw error;
    }

    // Portal / Audience Role Boundary Enforcement
    const requestedPortal = (
      dto.portal ||
      dto.audience ||
      context.portal ||
      ""
    ).toLowerCase();

    if (requestedPortal === "customer" && user.role !== UserRole.CUSTOMER) {
      const error: any = new Error(
        "Access Denied: Staff and Administrator accounts cannot sign in through the customer portal.",
      );
      error.code = "STAFF_NOT_ALLOWED_ON_CUSTOMER_PORTAL";
      error.statusCode = 403;
      throw error;
    }

    if (requestedPortal === "admin" && user.role === UserRole.CUSTOMER) {
      const error: any = new Error(
        "Access Denied: Customer accounts cannot access the Staff & Admin Console.",
      );
      error.code = "CUSTOMER_NOT_ALLOWED_ON_ADMIN_PORTAL";
      error.statusCode = 403;
      throw error;
    }

    const userSummary: UserSummaryDTO = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      avatarUrl: (user as any).avatarUrl || null,
      birthday: (user as any).birthday || null,
      clientId: user.clientId,
      role: user.role as UserRole,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
      referralCode: user.referralCode || null,
    };

    // ── MFA gate for all staff / admin roles ─────────────────────────────────
    if (MFA_REQUIRED_ROLES.has(user.role as UserRole)) {
      if (!user.mfaEnabled) {
        // First-time login after account setup — must configure MFA before proceeding
        const setupToken = jwt.sign(
          { id: user.id, purpose: "mfa_setup" },
          config.jwt.secret,
          { expiresIn: "15m" },
        );

        const result: MfaSetupRequiredResult = {
          requiresMfaSetup: true,
          setupToken,
          user: {
            id: userSummary.id,
            firstName: userSummary.firstName,
            email: userSummary.email,
            role: userSummary.role,
          },
        };
        return result;
      }

      // MFA already configured — issue challenge token, do NOT create session yet
      const mfaChallengeToken = jwt.sign(
        { id: user.id, purpose: "mfa_challenge" },
        config.jwt.secret,
        { expiresIn: "5m" },
      );

      if (user.mfaMethod === "EMAIL_OTP") {
        // Enqueue OTP delivery to background worker queue
        const rawCode = await mfaService.generateEmailOtp(user.id);
        await enqueueNotification("auth.mfa_otp", user.email, user.firstName, {
          rawCode,
        });

        const result: MfaChallengeResult = {
          requiresMfa: true,
          mfaChallengeToken,
          method: "EMAIL_OTP",
          emailHint: maskEmail(user.email),
        };
        return result;
      }

      // TOTP — no email needed, user opens their app
      const result: MfaChallengeResult = {
        requiresMfa: true,
        mfaChallengeToken,
        method: "TOTP",
      };
      return result;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // CUSTOMER role — direct session, no MFA
    const { accessToken, rawRefreshToken } = await sessionService.createSession(
      userSummary,
      context,
    );

    const successResult: LoginSuccessResult = {
      accessToken,
      rawRefreshToken,
      user: userSummary,
    };
    return successResult;
  }

  /**
   * Verifies a 6-digit MFA code (OTP or TOTP) after login challenge.
   * On success: creates a full session and returns tokens.
   */
  async verifyMfaChallenge(
    mfaChallengeToken: string,
    code: string,
    context: SessionContext = {},
  ): Promise<LoginSuccessResult> {
    let payload: { id: string; purpose: string };
    try {
      payload = jwt.verify(mfaChallengeToken, config.jwt.secret) as any;
    } catch {
      const error: any = new Error("MFA challenge token is invalid or expired");
      error.code = "MFA_CHALLENGE_INVALID";
      error.statusCode = 401;
      throw error;
    }

    if (payload.purpose !== "mfa_challenge") {
      const error: any = new Error("Invalid token purpose");
      error.code = "MFA_CHALLENGE_INVALID";
      error.statusCode = 401;
      throw error;
    }

    const user = await identityRepository.findById(payload.id);
    if (!user || !user.mfaEnabled) {
      const error: any = new Error("MFA not configured for this account");
      error.code = "MFA_NOT_CONFIGURED";
      error.statusCode = 400;
      throw error;
    }

    let isValid = false;
    if (user.mfaMethod === "EMAIL_OTP") {
      isValid = await mfaService.verifyEmailOtp(user.id, code);
    } else if (user.mfaMethod === "TOTP" && user.mfaSecret) {
      isValid = mfaService.verifyTotpCodeFromStorage(user.mfaSecret, code);
    }

    if (!isValid) {
      const error: any = new Error("Invalid or expired verification code");
      error.code = "MFA_CODE_INVALID";
      error.statusCode = 401;
      throw error;
    }

    const userSummary: UserSummaryDTO = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      avatarUrl: (user as any).avatarUrl || null,
      birthday: (user as any).birthday || null,
      clientId: user.clientId,
      role: user.role as UserRole,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
      referralCode: user.referralCode || null,
    };

    const { accessToken, rawRefreshToken } = await sessionService.createSession(
      userSummary,
      context,
    );

    return { accessToken, rawRefreshToken, user: userSummary };
  }

  /**
   * Initiates MFA setup for a staff user (after first login).
   * Requires a valid setupToken from the login response.
   *
   * - EMAIL_OTP: saves method immediately, returns nothing extra
   * - TOTP: generates and returns QR code URI + manual key (NOT saved yet)
   */
  async setupMfa(
    setupToken: string,
    method: "EMAIL_OTP" | "TOTP",
  ): Promise<{
    method: "EMAIL_OTP" | "TOTP";
    qrCodeDataUri?: string;
    manualEntryKey?: string;
    /** Ephemeral secret — must be passed back to confirmMfaSetup; never persisted here */
    ephemeralSecret?: string;
  }> {
    let payload: { id: string; purpose: string };
    try {
      payload = jwt.verify(setupToken, config.jwt.secret) as any;
    } catch {
      const error: any = new Error(
        "Setup token is invalid or expired. Please log in again.",
      );
      error.code = "MFA_SETUP_TOKEN_INVALID";
      error.statusCode = 401;
      throw error;
    }

    if (payload.purpose !== "mfa_setup") {
      const error: any = new Error("Invalid token purpose");
      error.code = "MFA_SETUP_TOKEN_INVALID";
      error.statusCode = 401;
      throw error;
    }

    const user = await identityRepository.findById(payload.id);
    if (!user) {
      const error: any = new Error("User not found");
      error.code = "USER_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    if (method === "EMAIL_OTP") {
      const rawCode = await mfaService.generateEmailOtp(user.id);
      await enqueueNotification("auth.mfa_otp", user.email, user.firstName, {
        rawCode,
      });
      return { method: "EMAIL_OTP" };
    }

    // TOTP — generate secret + QR code but do NOT save yet
    const { secret, qrCodeDataUri, manualEntryKey } =
      await mfaService.generateTotpSetup(user.email);

    return {
      method: "TOTP",
      qrCodeDataUri,
      manualEntryKey,
      ephemeralSecret: secret, // returned to frontend; sent back in verify-setup
    };
  }

  /**
   * Confirms MFA setup by verifying the first valid code,
   * then persists the method and issues a full session.
   */
  async confirmMfaSetup(
    setupToken: string,
    method: "EMAIL_OTP" | "TOTP",
    code: string,
    ephemeralSecret: string | undefined, // required for TOTP, undefined for EMAIL_OTP
    context: SessionContext = {},
  ): Promise<LoginSuccessResult> {
    let payload: { id: string; purpose: string };
    try {
      payload = jwt.verify(setupToken, config.jwt.secret) as any;
    } catch {
      const error: any = new Error(
        "Setup token is invalid or expired. Please log in again.",
      );
      error.code = "MFA_SETUP_TOKEN_INVALID";
      error.statusCode = 401;
      throw error;
    }

    if (payload.purpose !== "mfa_setup") {
      const error: any = new Error("Invalid token purpose");
      error.code = "MFA_SETUP_TOKEN_INVALID";
      error.statusCode = 401;
      throw error;
    }

    const user = await identityRepository.findById(payload.id);
    if (!user) {
      const error: any = new Error("User not found");
      error.code = "USER_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    if (method === "TOTP") {
      if (!ephemeralSecret) {
        const error: any = new Error(
          "TOTP secret is required for TOTP setup confirmation",
        );
        error.code = "MFA_SETUP_MISSING_SECRET";
        error.statusCode = 400;
        throw error;
      }
      const isValid = mfaService.verifyTotpCode(ephemeralSecret, code);
      if (!isValid) {
        const error: any = new Error(
          "The code from your authenticator app is incorrect. Please try again.",
        );
        error.code = "MFA_CODE_INVALID";
        error.statusCode = 400;
        throw error;
      }
      await mfaService.enableTotpMfa(user.id, ephemeralSecret);
    } else {
      // EMAIL_OTP — generate and send a test OTP, user confirms it
      const isValid = await mfaService.verifyEmailOtp(user.id, code);
      if (!isValid) {
        const error: any = new Error(
          "The code sent to your email is incorrect or has expired.",
        );
        error.code = "MFA_CODE_INVALID";
        error.statusCode = 400;
        throw error;
      }
      await mfaService.enableEmailOtpMfa(user.id);
    }

    // MFA now active — create full session
    const userSummary: UserSummaryDTO = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      avatarUrl: (user as any).avatarUrl || null,
      birthday: (user as any).birthday || null,
      clientId: user.clientId,
      role: user.role as UserRole,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
      referralCode: user.referralCode || null,
    };

    await prisma.auditLog
      .create({
        data: {
          userId: user.id,
          action: "MFA_ENABLED",
          entityType: "User",
          entityId: user.id,
          metadata: { method },
        },
      })
      .catch(() => {});

    const { accessToken, rawRefreshToken } = await sessionService.createSession(
      userSummary,
      context,
    );

    return { accessToken, rawRefreshToken, user: userSummary };
  }

  /**
   * Re-sends an Email OTP during the MFA challenge phase.
   * Rate-limited at the route level (max 1 resend per 60s).
   */
  async resendMfaOtp(mfaChallengeToken: string): Promise<void> {
    let payload: { id: string; purpose: string };
    try {
      payload = jwt.verify(mfaChallengeToken, config.jwt.secret) as any;
    } catch {
      const error: any = new Error("MFA challenge token is invalid or expired");
      error.code = "MFA_CHALLENGE_INVALID";
      error.statusCode = 401;
      throw error;
    }

    if (payload.purpose !== "mfa_challenge") {
      const error: any = new Error("Invalid token purpose");
      error.code = "MFA_CHALLENGE_INVALID";
      error.statusCode = 401;
      throw error;
    }

    const user = await identityRepository.findById(payload.id);
    if (!user || user.mfaMethod !== "EMAIL_OTP") {
      const error: any = new Error("This account does not use Email OTP");
      error.code = "MFA_METHOD_MISMATCH";
      error.statusCode = 400;
      throw error;
    }

    const rawCode = await mfaService.generateEmailOtp(user.id);
    await enqueueNotification("auth.mfa_otp", user.email, user.firstName, {
      rawCode,
    });
  }

  /**
   * Initiates changing or setting up MFA for an authenticated user.
   */
  async initiateProfileMfa(
    userId: string,
    method: "EMAIL_OTP" | "TOTP",
  ): Promise<{
    method: "EMAIL_OTP" | "TOTP";
    qrCodeDataUri?: string;
    manualEntryKey?: string;
    ephemeralSecret?: string;
    message?: string;
  }> {
    const user = await identityRepository.findById(userId);
    if (!user) {
      const error: any = new Error("User not found");
      error.code = "USER_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    if (method === "EMAIL_OTP") {
      const rawCode = await mfaService.generateEmailOtp(user.id);
      await enqueueNotification("auth.mfa_otp", user.email, user.firstName, {
        rawCode,
      });
      return {
        method: "EMAIL_OTP",
        message: `Verification code dispatched to ${user.email}`,
      };
    }

    // TOTP setup
    const { secret, qrCodeDataUri, manualEntryKey } =
      await mfaService.generateTotpSetup(user.email);

    return {
      method: "TOTP",
      qrCodeDataUri,
      manualEntryKey,
      ephemeralSecret: secret,
    };
  }

  /**
   * Confirms and persists the new preferred MFA method for an authenticated user.
   */
  async confirmProfileMfa(
    userId: string,
    method: "EMAIL_OTP" | "TOTP",
    code: string,
    ephemeralSecret?: string,
  ): Promise<{
    user: UserSummaryDTO;
    method: "EMAIL_OTP" | "TOTP";
  }> {
    const user = await identityRepository.findById(userId);
    if (!user) {
      const error: any = new Error("User not found");
      error.code = "USER_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    if (method === "EMAIL_OTP") {
      const isValid = await mfaService.verifyEmailOtp(userId, code);
      if (!isValid) {
        const error: any = new Error(
          "Invalid or expired verification code. Please request a new one.",
        );
        error.code = "MFA_CODE_INVALID";
        error.statusCode = 400;
        throw error;
      }
      await mfaService.enableEmailOtpMfa(userId);
    } else if (method === "TOTP") {
      if (!ephemeralSecret) {
        const error: any = new Error(
          "MFA secret is required for TOTP verification.",
        );
        error.code = "MFA_SECRET_REQUIRED";
        error.statusCode = 400;
        throw error;
      }
      const isValid = mfaService.verifyTotpCode(ephemeralSecret, code);
      if (!isValid) {
        const error: any = new Error(
          "Invalid authenticator code. Check that your device time is synchronized.",
        );
        error.code = "MFA_CODE_INVALID";
        error.statusCode = 400;
        throw error;
      }
      await mfaService.enableTotpMfa(userId, ephemeralSecret);
    }

    await prisma.auditLog.create({
      data: {
        userId,
        action: "USER_MFA_METHOD_UPDATED",
        entityType: "User",
        entityId: userId,
        metadata: { method },
      },
    });

    const updatedUser = await this.getProfile(userId);
    return {
      user: updatedUser,
      method,
    };
  }

  /**
   * Disables MFA for a staff user — Super Admin emergency action.
   */
  async disableUserMfa(
    targetUserId: string,
    adminUserId: string,
    ipAddress?: string,
  ): Promise<void> {
    const target = await identityRepository.findById(targetUserId);
    if (!target) {
      const error: any = new Error("User not found");
      error.code = "USER_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    await mfaService.disableMfa(targetUserId);

    await prisma.auditLog
      .create({
        data: {
          userId: adminUserId,
          action: "MFA_DISABLED_BY_ADMIN",
          entityType: "User",
          entityId: targetUserId,
          metadata: { targetEmail: target.email },
          ipAddress,
        },
      })
      .catch(() => {});
  }

  /**
   * Rotates refresh token session
   */
  async refresh(
    rawRefreshToken: string,
    context: SessionContext = {},
  ): Promise<{
    accessToken: string;
    rawRefreshToken: string;
    user: UserSummaryDTO;
  }> {
    try {
      return await sessionService.rotateRefreshToken(rawRefreshToken, context);
    } catch (err: any) {
      // Auth domain errors: explicitly map to 401 Unauthorized
      const authErrors = [
        "INVALID_REFRESH_TOKEN",
        "REFRESH_TOKEN_REUSE_DETECTED",
        "SESSION_EXPIRED",
      ];
      if (authErrors.includes(err.message)) {
        const error: any = new Error(
          err.message === "REFRESH_TOKEN_REUSE_DETECTED"
            ? "Suspicious session activity detected. Please log in again."
            : "Invalid or expired session token",
        );
        error.code = err.message;
        error.statusCode = 401;
        throw error;
      }

      // Infrastructure / Database errors (connection timeout, network drop, etc.):
      // Rethrow so they are treated as 500/503 and do NOT invalidate client credentials
      throw err;
    }
  }

  /**
   * Logs out user and revokes active session
   */
  async logout(rawRefreshToken?: string, sessionId?: string): Promise<void> {
    if (rawRefreshToken) {
      await sessionService.revokeSessionByRefreshToken(rawRefreshToken);
    }
    if (sessionId) {
      await sessionService.revokeSessionById(sessionId);
    }
  }

  /**
   * Requests a password reset token
   */
  async requestPasswordReset(
    email: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = await identityRepository.findByEmail(email);
    if (user) {
      const rawToken = passwordService.generateSecureToken(32);
      const tokenHash = passwordService.hashToken(rawToken);
      await identityRepository.createPasswordResetToken(
        user.id,
        tokenHash,
        rawToken,
        user.email,
        user.firstName,
      );
    }

    return {
      success: true,
      message:
        "If an account exists with that email, password reset instructions have been sent.",
    };
  }

  /**
   * Confirms password reset with new password
   */
  async confirmPasswordReset(
    token: string,
    newPassword: string,
  ): Promise<{ success: boolean; message: string }> {
    const tokenHash = passwordService.hashToken(token);
    const newPasswordHash = await passwordService.hashPassword(newPassword);

    try {
      const { user, revokedSessionIds } =
        await identityRepository.resetPasswordByTokenHash(
          tokenHash,
          newPasswordHash,
        );

      // Purge and revoke all active sessions in Redis cache immediately
      await sessionService.revokeAllUserSessions(user.id, revokedSessionIds);

      return {
        success: true,
        message:
          "Your password has been successfully reset. You can now log in with your new password.",
      };
    } catch (err: any) {
      const error: any = new Error(
        err.message === "TOKEN_ALREADY_USED"
          ? "This reset link has already been used"
          : err.message === "TOKEN_EXPIRED"
            ? "This reset link has expired"
            : "Invalid or expired password reset link",
      );
      error.code = err.message || "INVALID_RESET_TOKEN";
      error.statusCode = 400;
      throw error;
    }
  }

  /**
   * Sets up new staff/admin account password from 1-hour one-time link
   */
  async setupAccount(
    token: string,
    newPassword: string,
  ): Promise<SetupAccountResult> {
    const tokenHash = passwordService.hashToken(token);
    const newPasswordHash = await passwordService.hashPassword(newPassword);

    try {
      const { user, revokedSessionIds } =
        await identityRepository.resetPasswordByTokenHash(
          tokenHash,
          newPasswordHash,
        );

      // Purge sessions if any
      await sessionService.revokeAllUserSessions(user.id, revokedSessionIds);

      // Check if user requires MFA setup (Staff/Admin roles)
      if (MFA_REQUIRED_ROLES.has(user.role as UserRole) && !user.mfaEnabled) {
        const setupToken = jwt.sign(
          { id: user.id, purpose: "mfa_setup" },
          config.jwt.secret,
          { expiresIn: "15m" },
        );

        return {
          success: true,
          requiresMfaSetup: true,
          setupToken,
          user: {
            id: user.id,
            firstName: user.firstName,
            email: user.email,
            role: user.role as UserRole,
          },
          message:
            "Your password has been successfully configured. Please proceed with Two-Factor Authentication setup.",
        };
      }

      return {
        success: true,
        message:
          "Your account has been successfully set up. You can now sign in to the Admin Console.",
      };
    } catch (err: any) {
      if (err.message === "TOKEN_ALREADY_USED") {
        const error: any = new Error(
          "This setup link has already been used. Please sign in or contact your Super Administrator.",
        );
        error.code = "TOKEN_ALREADY_USED";
        error.statusCode = 410;
        throw error;
      }
      if (err.message === "TOKEN_EXPIRED") {
        const error: any = new Error(
          "This setup link has expired (1-hour validity limit). Please request a new invite.",
        );
        error.code = "TOKEN_EXPIRED";
        error.statusCode = 410;
        throw error;
      }
      const error: any = new Error(
        "Invalid or expired setup link. Please contact your Super Administrator.",
      );
      error.code = "INVALID_SETUP_TOKEN";
      error.statusCode = 400;
      throw error;
    }
  }

  /**
   * Fetches user profile by ID
   */
  async getProfile(userId: string): Promise<UserSummaryDTO> {
    const user = await identityRepository.findById(userId);
    if (!user) {
      const error: any = new Error("User not found");
      error.code = "USER_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    return this.formatUserSummary(user);
  }

  /**
   * Updates authenticated user profile details
   */
  async updateProfile(
    userId: string,
    data: {
      firstName?: string;
      lastName?: string;
      phoneNumber?: string;
      birthday?: string | null;
    },
    ipAddress?: string,
  ): Promise<UserSummaryDTO> {
    const existing = await identityRepository.findById(userId);
    if (!existing) {
      const error: any = new Error("User not found");
      error.code = "USER_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    const updated = await identityRepository.updateUser(userId, {
      ...(data.firstName !== undefined && { firstName: data.firstName }),
      ...(data.lastName !== undefined && { lastName: data.lastName }),
      ...(data.phoneNumber !== undefined && { phoneNumber: data.phoneNumber }),
      ...(data.birthday !== undefined && { birthday: data.birthday }),
    });

    await prisma.auditLog
      .create({
        data: {
          userId,
          action: "USER_PROFILE_UPDATED",
          entityType: "User",
          entityId: userId,
          metadata: {
            previous: {
              firstName: existing.firstName,
              lastName: existing.lastName,
              phoneNumber: existing.phoneNumber,
              birthday: (existing as any).birthday,
            },
            updated: {
              firstName: updated.firstName,
              lastName: updated.lastName,
              phoneNumber: updated.phoneNumber,
              birthday: (updated as any).birthday,
            },
          },
          ipAddress,
        },
      })
      .catch(() => {});

    return {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      phoneNumber: updated.phoneNumber,
      avatarUrl: (updated as any).avatarUrl || null,
      birthday: (updated as any).birthday || null,
      clientId: updated.clientId,
      role: updated.role as UserRole,
      isVerified: updated.isVerified,
      createdAt: updated.createdAt,
      referralCode: updated.referralCode || null,
    };
  }

  /**
   * Uploads, square-crops, and WebP compresses user avatar,
   * automatically deleting any previously uploaded avatar.
   */
  async uploadAvatar(
    userId: string,
    input: {
      imageBuffer: Buffer;
      fileName?: string;
      mimeType?: string;
    },
    reqProtocol?: string,
    reqHost?: string,
    ipAddress?: string,
  ): Promise<{ avatarUrl: string; user: UserSummaryDTO }> {
    const existing = await identityRepository.findById(userId);
    if (!existing) {
      const error: any = new Error("User not found");
      error.code = "USER_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    const uploadLocations = [
      path.join(process.cwd(), "uploads", "avatars"),
      path.join(process.cwd(), "apps", "api", "uploads", "avatars"),
      path.resolve(__dirname, "../../../uploads/avatars"),
      path.resolve(__dirname, "../../uploads/avatars"),
    ];

    for (const dir of uploadLocations) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch {}
    }

    // 1. Delete previous avatar file if exists
    const previousAvatarUrl = (existing as any).avatarUrl;
    if (previousAvatarUrl && typeof previousAvatarUrl === "string") {
      const prevFilename = path.basename(previousAvatarUrl);
      if (prevFilename && prevFilename.includes(".")) {
        for (const dir of uploadLocations) {
          const filePath = path.join(dir, prevFilename);
          try {
            await fs.unlink(filePath);
          } catch {}
        }
      }
    }

    // 2. Compress and crop to square WebP (512x512)
    let finalBuffer: Buffer;
    const ext = "webp";

    if (input.mimeType?.toLowerCase() === "image/svg+xml") {
      finalBuffer = input.imageBuffer;
    } else {
      finalBuffer = await sharp(input.imageBuffer)
        .rotate()
        .resize({
          width: 512,
          height: 512,
          fit: "cover",
          position: "centre",
        })
        .webp({
          quality: 85,
          effort: 4,
        })
        .toBuffer();
    }

    // 3. Save new file
    const uniqueId = crypto.randomUUID().slice(0, 8);
    const timestamp = Date.now();
    const filename = `avatar-${userId}-${timestamp}-${uniqueId}.${ext}`;

    for (const dir of uploadLocations) {
      try {
        await fs.writeFile(path.join(dir, filename), finalBuffer);
      } catch {}
    }

    const relativeUrl = `/uploads/avatars/${filename}`;

    // 4. Update user in database
    const updated = await identityRepository.updateUser(userId, {
      avatarUrl: relativeUrl,
    } as any);

    await prisma.auditLog
      .create({
        data: {
          userId,
          action: "USER_AVATAR_UPDATED",
          entityType: "User",
          entityId: userId,
          metadata: {
            previousAvatarUrl,
            newAvatarUrl: relativeUrl,
          },
          ipAddress,
        },
      })
      .catch(() => {});

    const userSummary: UserSummaryDTO = {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      phoneNumber: updated.phoneNumber,
      avatarUrl: (updated as any).avatarUrl || relativeUrl,
      birthday: (updated as any).birthday || null,
      clientId: updated.clientId,
      role: updated.role as UserRole,
      isVerified: updated.isVerified,
      createdAt: updated.createdAt,
      referralCode: updated.referralCode || null,
    };

    return {
      avatarUrl: relativeUrl,
      user: userSummary,
    };
  }

  /**
   * Deletes existing user avatar file and clears avatarUrl
   */
  async deleteAvatar(
    userId: string,
    ipAddress?: string,
  ): Promise<{ success: boolean; user: UserSummaryDTO }> {
    const existing = await identityRepository.findById(userId);
    if (!existing) {
      const error: any = new Error("User not found");
      error.code = "USER_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    const previousAvatarUrl = (existing as any).avatarUrl;
    if (previousAvatarUrl && typeof previousAvatarUrl === "string") {
      const prevFilename = path.basename(previousAvatarUrl);
      const uploadLocations = [
        path.join(process.cwd(), "uploads", "avatars"),
        path.join(process.cwd(), "apps", "api", "uploads", "avatars"),
        path.resolve(__dirname, "../../../uploads/avatars"),
        path.resolve(__dirname, "../../uploads/avatars"),
      ];

      for (const dir of uploadLocations) {
        const filePath = path.join(dir, prevFilename);
        try {
          await fs.unlink(filePath);
        } catch {}
      }
    }

    const updated = await identityRepository.updateUser(userId, {
      avatarUrl: null,
    } as any);

    await prisma.auditLog
      .create({
        data: {
          userId,
          action: "USER_AVATAR_DELETED",
          entityType: "User",
          entityId: userId,
          metadata: { previousAvatarUrl },
          ipAddress,
        },
      })
      .catch(() => {});

    const userSummary: UserSummaryDTO = {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      phoneNumber: updated.phoneNumber,
      avatarUrl: null,
      birthday: (updated as any).birthday || null,
      clientId: updated.clientId,
      role: updated.role as UserRole,
      isVerified: updated.isVerified,
      createdAt: updated.createdAt,
      referralCode: updated.referralCode || null,
    };

    return {
      success: true,
      user: userSummary,
    };
  }

  /**
   * Changes user password with current password verification
   */
  async changePassword(
    userId: string,
    data: { currentPassword: string; newPassword: string },
    ipAddress?: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = await identityRepository.findById(userId);
    if (!user || !user.passwordHash) {
      const error: any = new Error("User not found or password not set");
      error.code = "USER_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    const isCurrentValid = await passwordService.verifyPassword(
      user.passwordHash,
      data.currentPassword,
    );

    if (!isCurrentValid) {
      const error: any = new Error("Current password is incorrect");
      error.code = "INVALID_CURRENT_PASSWORD";
      error.statusCode = 400;
      throw error;
    }

    const newPasswordHash = await passwordService.hashPassword(
      data.newPassword,
    );
    await identityRepository.updateUser(userId, {
      passwordHash: newPasswordHash,
    });

    await prisma.auditLog
      .create({
        data: {
          userId,
          action: "PASSWORD_CHANGED",
          entityType: "User",
          entityId: userId,
          metadata: { timestamp: new Date().toISOString() },
          ipAddress,
        },
      })
      .catch(() => {});

    return {
      success: true,
      message: "Password changed successfully",
    };
  }
  /**
   * Fetches the customer's own referral summary and list of referred members.
   * Utilizes single-round-trip database aggregation to compute paid booking status.
   */
  async getMyReferrals(userId: string): Promise<CustomerReferralsResponse> {
    const user = await identityRepository.findById(userId);
    if (!user) {
      const error: any = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    // If user doesn't have a referral code yet, assign one lazily
    let referralCode = user.referralCode;
    if (!referralCode) {
      referralCode = generateReferralCode();
      await prisma.user.update({
        where: { id: user.id },
        data: { referralCode },
      });
    }

    const PAID_BOOKING_STATES: BookingState[] = [
      BookingState.CONFIRMED,
      BookingState.ACTIVE,
      BookingState.CHECKED_IN,
      BookingState.CHECKED_OUT,
      BookingState.COMPLETED,
    ];

    // Single aggregated query to fetch all referred users with count of their paid bookings
    const referredUsers = await prisma.user.findMany({
      where: { referredById: userId },
      select: {
        id: true,
        clientId: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        createdAt: true,
        _count: {
          select: {
            bookings: {
              where: {
                state: { in: PAID_BOOKING_STATES },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const items: ReferralItem[] = referredUsers.map((u) => {
      const paidBookingsCount = u._count.bookings;
      const isActive = paidBookingsCount > 0;
      return {
        id: u.id,
        clientId: u.clientId,
        name: `${u.firstName} ${u.lastName}`.trim(),
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phoneNumber: u.phoneNumber,
        joinedAt: u.createdAt.toISOString(),
        isActive,
        status: isActive ? "Active" : "Inactive",
        paidBookingsCount,
      };
    });

    const totalReferred = items.length;
    const activeReferred = items.filter((i) => i.isActive).length;
    const inactiveReferred = totalReferred - activeReferred;

    const frontendBase = config.frontendUrls?.customer || "https://app.daih.ng";
    const referralLink = `${frontendBase}/register?ref=${referralCode}`;

    return {
      referralCode,
      referralLink,
      totalReferred,
      activeReferred,
      inactiveReferred,
      referredUsers: items,
    };
  }

  /**
   * Request Email OTP for passwordless / Google-only account deactivation
   */
  async requestDeactivationOtp(userId: string) {
    const user = await identityRepository.findById(userId);
    if (!user) {
      const err: any = new Error("User not found");
      err.statusCode = 404;
      err.code = "USER_NOT_FOUND";
      throw err;
    }
    if ((user as any).deactivatedAt) {
      const err: any = new Error("Account is already deactivated");
      err.statusCode = 400;
      err.code = "ACCOUNT_ALREADY_DEACTIVATED";
      throw err;
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const hmacSecret = (config.security as any)?.otpSecret || config.jwt.secret;
    const hashedOtp = crypto
      .createHmac("sha256", hmacSecret)
      .update(otp)
      .digest("hex");

    if (redis && isRedisAvailable()) {
      try {
        await redis.set(`deact_otp:${userId}`, hashedOtp, "EX", 600);
        await redis.set(`deact_attempts:${userId}`, "0", "EX", 600);
      } catch (err: any) {
        console.warn(
          "[IdentityService] Redis write warning during OTP set:",
          err?.message,
        );
      }
    }

    try {
      await enqueueNotification(
        "auth.deactivation_otp",
        user.email,
        user.firstName,
        {
          otp,
          supportEmail: "support@daih.ng",
        },
      );
    } catch (err: any) {
      console.warn(
        "[IdentityService] Failed to send deactivation OTP notification:",
        err?.message,
      );
    }

    return {
      success: true,
      message:
        "A 6-digit confirmation code has been sent to your email address.",
    };
  }

  /**
   * Customer Self-Service Account Closure
   */
  async deactivateAccount(userId: string, dto: DeactivateAccountDTO) {
    const user = await identityRepository.findById(userId);
    if (!user) {
      const err: any = new Error("User not found");
      err.statusCode = 404;
      err.code = "USER_NOT_FOUND";
      throw err;
    }
    if ((user as any).deactivatedAt) {
      const err: any = new Error("Account is already deactivated");
      err.statusCode = 400;
      err.code = "ACCOUNT_ALREADY_DEACTIVATED";
      throw err;
    }

    // Authentication Guard
    if (user.passwordHash) {
      if (!dto.password) {
        const err: any = new Error(
          "Password confirmation is required to close your account.",
        );
        err.statusCode = 400;
        err.code = "PASSWORD_REQUIRED";
        throw err;
      }
      const isValid = await passwordService.verifyPassword(
        user.passwordHash,
        dto.password,
      );
      if (!isValid) {
        const err: any = new Error("Incorrect password.");
        err.statusCode = 400;
        err.code = "INVALID_PASSWORD";
        throw err;
      }
    } else {
      if (!dto.otp) {
        const err: any = new Error(
          "A 6-digit verification code is required to close your account.",
        );
        err.statusCode = 400;
        err.code = "OTP_REQUIRED";
        throw err;
      }
      if (redis && isRedisAvailable()) {
        const attempts = parseInt(
          (await redis.get(`deact_attempts:${userId}`)) || "0",
          10,
        );
        if (attempts >= 3) {
          const err: any = new Error(
            "Maximum verification attempts exceeded. Please request a new code.",
          );
          err.statusCode = 429;
          err.code = "OTP_ATTEMPTS_EXCEEDED";
          throw err;
        }
        await redis.incr(`deact_attempts:${userId}`);

        const storedHash = await redis.get(`deact_otp:${userId}`);
        const hmacSecret =
          (config.security as any)?.otpSecret || config.jwt.secret;
        const inputHash = crypto
          .createHmac("sha256", hmacSecret)
          .update(dto.otp.trim())
          .digest("hex");
        if (!storedHash || storedHash !== inputHash) {
          const err: any = new Error("Invalid or expired verification code.");
          err.statusCode = 400;
          err.code = "INVALID_OTP";
          throw err;
        }
        await redis.del(`deact_otp:${userId}`);
        await redis.del(`deact_attempts:${userId}`);
      }
    }

    // Active/Upcoming Confirmed Bookings Guard
    const activeBooking = await prisma.booking.findFirst({
      where: {
        userId,
        state: {
          in: [
            BookingState.CONFIRMED,
            BookingState.ACTIVE,
            BookingState.CHECKED_IN,
          ],
        },
        endTime: { gte: new Date() },
      },
    });
    if (activeBooking) {
      const err: any = new Error(
        "Cannot deactivate account with upcoming or active confirmed bookings. Please complete or reschedule your bookings first.",
      );
      err.statusCode = 400;
      err.code = "ACTIVE_BOOKING_PREVENTS_CLOSURE";
      throw err;
    }

    // Open Refund Requests Guard
    const openRefund = await prisma.refundRequest.findFirst({
      where: {
        booking: { userId },
        status: {
          in: [
            RefundStatus.PENDING,
            RefundStatus.PROCESSING,
            RefundStatus.INFO_REQUESTED,
            RefundStatus.REQUIRES_RECONCILIATION,
          ],
        },
      },
    });
    if (openRefund) {
      const err: any = new Error(
        "Cannot deactivate account while a refund request is pending review or processing.",
      );
      err.statusCode = 400;
      err.code = "OPEN_REFUND_PREVENTS_CLOSURE";
      throw err;
    }

    // Cancel unconfirmed holds (HELD, PENDING_PAYMENT)
    const heldBookings = await prisma.booking.findMany({
      where: {
        userId,
        state: { in: [BookingState.HELD, BookingState.PENDING_PAYMENT] },
      },
      select: { id: true },
    });
    for (const hb of heldBookings) {
      await prisma.booking.update({
        where: { id: hb.id },
        data: { state: BookingState.CANCELLED },
      });
      await prisma.transaction.updateMany({
        where: { bookingId: hb.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.ABANDONED },
      });
      await prisma.coinHold.updateMany({
        where: { bookingId: hb.id, status: HoldStatus.ACTIVE },
        data: { status: HoldStatus.RELEASED },
      });
    }

    // Forfeit remaining PeeDee coins
    const coinBalance = await prisma.coinBalance.findUnique({
      where: { userId },
    });
    if (coinBalance && Number(coinBalance.balance) > 0) {
      const forfeitAmount = Number(coinBalance.balance);
      await prisma.coinLedgerEntry.create({
        data: {
          userId,
          action: CoinLedgerAction.EXPIRY,
          amount: -forfeitAmount,
          balanceAfter: 0,
          referenceType: "ACCOUNT_CLOSURE",
          referenceId: userId,
          idempotencyKey: `deact_coin_forfeit_${userId}_${Date.now()}`,
          metadata: {
            reason: "Forfeited on customer account closure",
          },
        },
      });
      await prisma.coinBalance.update({
        where: { userId },
        data: {
          balance: 0,
          lifetimeBurned: { increment: forfeitAmount },
        },
      });
    }

    // Mark user deactivatedAt = NOW()
    const now = new Date();
    await prisma.user.update({
      where: { id: userId },
      data: { deactivatedAt: now },
    });

    // Revoke all sessions in Postgres & cache
    await sessionService.revokeAllUserSessions(userId);

    // Set Redis fast-kill key
    if (redis && isRedisAvailable()) {
      try {
        await redis.set(`deactivated_user:${userId}`, "1", "EX", 86400 * 30);
      } catch (err: any) {
        console.warn(
          "[IdentityService] Redis write warning during deactivation:",
          err?.message,
        );
      }
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: "ACCOUNT_DEACTIVATED",
        entityType: "User",
        entityId: userId,
        metadata: {
          reason: dto.reason || "Customer self-service deactivation",
          deactivatedAt: now.toISOString(),
        },
      },
    });

    // Outbox event
    await outboxService.recordEvent({
      eventType: "identity.account_deactivated",
      aggregateType: "User",
      aggregateId: userId,
      payload: {
        userId,
        email: user.email,
        deactivatedAt: now.toISOString(),
      },
    });

    return {
      success: true,
      message: "Account has been successfully deactivated.",
    };
  }

  /**
   * Super Admin Support-Led Account Reactivation
   */
  async reactivateAccount(superAdminUserId: string, dto: ReactivateAccountDTO) {
    const user = await identityRepository.findById(dto.userId);
    if (!user) {
      const err: any = new Error("User not found");
      err.statusCode = 404;
      err.code = "USER_NOT_FOUND";
      throw err;
    }
    if (!(user as any).deactivatedAt) {
      const err: any = new Error("Account is not deactivated");
      err.statusCode = 400;
      err.code = "ACCOUNT_NOT_DEACTIVATED";
      throw err;
    }

    await prisma.user.update({
      where: { id: dto.userId },
      data: { deactivatedAt: null },
    });

    if (redis && isRedisAvailable()) {
      try {
        await redis.del(`deactivated_user:${dto.userId}`);
      } catch (err: any) {
        console.warn(
          "[IdentityService] Redis del warning during reactivation:",
          err?.message,
        );
      }
    }

    await prisma.auditLog.create({
      data: {
        userId: superAdminUserId,
        action: "ACCOUNT_REACTIVATED",
        entityType: "User",
        entityId: dto.userId,
        metadata: {
          targetEmail: user.email,
          reason: dto.reason,
          reactivatedBy: superAdminUserId,
        },
      },
    });

    await outboxService.recordEvent({
      eventType: "identity.account_reactivated",
      aggregateType: "User",
      aggregateId: dto.userId,
      payload: {
        userId: dto.userId,
        email: user.email,
        reactivatedBy: superAdminUserId,
        reason: dto.reason,
      },
    });

    return {
      success: true,
      message: "Account reactivated successfully.",
    };
  }
}

export const identityService = new IdentityService();

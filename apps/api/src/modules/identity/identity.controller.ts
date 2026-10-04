import { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { getSafeRedirectUrl } from "@daih/types";
import { config, isAllowedOrigin } from "../../config/env.js";
import { identityService } from "./identity.service.js";
import { oauthExchangeService } from "./oauth-exchange.service.js";
import { staffUserService } from "./staff-user.service.js";
import { customerService } from "./customer.service.js";
import { AuthRequest } from "../../middleware/auth.middleware.js";
import { uploadAvatarSchema } from "./identity.schema.js";
import {
  computeFingerprint,
  getVerifiedClientIp,
} from "../../utils/fingerprint.js";

export class IdentityController {
  private setRefreshCookie(
    res: Response,
    rawRefreshToken: string,
    req?: Request,
  ): void {
    const maxAge = config.jwt.refreshExpiresInDays * 24 * 60 * 60 * 1000;
    const isSecure =
      req !== undefined
        ? Boolean(
            req.secure ||
            req.headers["x-forwarded-proto"] === "https" ||
            config.cookies.secure,
          )
        : config.cookies.secure;
    const cookieBase = {
      httpOnly: true,
      secure: isSecure,
      sameSite: config.cookies.sameSite,
      domain: config.cookies.domain,
    };

    // Exactly one Set-Cookie header scoped strictly to config.cookies.path
    res.cookie(config.cookies.refreshCookieName, rawRefreshToken, {
      ...cookieBase,
      path: config.cookies.path,
      maxAge,
    });
  }

  private clearRefreshCookie(res: Response, req?: Request): void {
    const isSecure =
      req !== undefined
        ? Boolean(
            req.secure ||
            req.headers["x-forwarded-proto"] === "https" ||
            config.cookies.secure,
          )
        : config.cookies.secure;

    const cookieBase = {
      httpOnly: true,
      secure: isSecure,
      sameSite: config.cookies.sameSite,
      domain: config.cookies.domain,
    };

    // Exactly one Set-Cookie clear header scoped strictly to config.cookies.path
    res.clearCookie(config.cookies.refreshCookieName, {
      ...cookieBase,
      path: config.cookies.path,
    });
  }

  register = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await identityService.register(req.body);
      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  login = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const portalHeader = (req.headers["x-portal"] ||
        req.headers["x-client-portal"]) as string | undefined;
      const result = await identityService.login(req.body, {
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        deviceFingerprint: computeFingerprint(req),
        portal: req.body?.portal || req.body?.audience || portalHeader,
      });

      // Handle MFA setup requirement
      if ("requiresMfaSetup" in result) {
        res.json({
          success: true,
          data: result,
        });
        return;
      }

      // Handle MFA challenge requirement
      if ("requiresMfa" in result) {
        res.json({
          success: true,
          data: result,
        });
        return;
      }

      // Full login success for customers or non-MFA flow
      this.setRefreshCookie(res, result.rawRefreshToken, req);

      res.json({
        success: true,
        data: {
          token: result.accessToken,
          user: result.user,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  googleAuth = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const portalHeader = (req.headers["x-portal"] ||
        req.headers["x-client-portal"]) as string | undefined;

      const result = await identityService.authenticateGoogle(
        {
          idToken: req.body.idToken,
          referralCode: req.body.referralCode,
          portal: req.body.portal || portalHeader,
        },
        {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          deviceFingerprint: computeFingerprint(req),
          portal: req.body.portal || portalHeader,
        },
      );

      // Store refresh token strictly in httpOnly cookie
      this.setRefreshCookie(res, result.rawRefreshToken, req);

      // Return public DTO - strictly NO rawRefreshToken in response body
      res.json({
        success: true,
        data: {
          token: result.accessToken,
          accessToken: result.accessToken,
          user: result.user,
          isNewUser: result.isNewUser,
          needsOnboarding: result.needsOnboarding,
          needsConsent: result.needsConsent,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  initiateGoogleOAuth = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const portal = (req.query.portal ||
        req.headers["x-portal"] ||
        "customer") as string;
      const ref = (req.query.ref || req.query.referralCode) as
        string | undefined;
      const destination = req.query.destination as string | undefined;
      const codeChallenge = (req.query.code_challenge ||
        req.query.codeChallenge) as string | undefined;

      const result = identityService.generateGoogleOAuthUrl({
        referralCode: ref,
        destination,
        portal,
        codeChallenge,
      });

      const isSecure = Boolean(
        req.secure ||
        req.headers["x-forwarded-proto"] === "https" ||
        config.cookies.secure,
      );

      res.cookie(result.stateCookie.name, result.stateCookie.value, {
        httpOnly: true,
        secure: isSecure,
        sameSite: "lax",
        maxAge: result.stateCookie.maxAge,
        path: "/",
      });

      if (
        req.headers.accept?.includes("application/json") ||
        req.query.json === "true"
      ) {
        res.json({
          success: true,
          data: {
            url: result.url,
          },
        });
        return;
      }

      res.redirect(result.url);
    } catch (error) {
      next(error);
    }
  };

  handleGoogleOAuthCallback = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const portal = (req.query.portal as string) || "customer";
    const baseRedirectUrl =
      portal === "admin"
        ? config.frontendUrls.admin
        : config.frontendUrls.customer;

    try {
      if (req.query.error) {
        const errorDesc = (req.query.error_description ||
          req.query.error) as string;
        res.redirect(
          `${baseRedirectUrl}/login?error=${encodeURIComponent(errorDesc)}`,
        );
        return;
      }

      const code = req.query.code as string;
      const state = req.query.state as string;
      const stateCookie = req.cookies?.daih_oauth_state;

      const result = await identityService.handleGoogleOAuthCallback(
        {
          code,
          state,
          stateCookie,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          deviceFingerprint: computeFingerprint(req),
        },
        {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          deviceFingerprint: computeFingerprint(req),
          portal,
        },
      );

      res.clearCookie("daih_oauth_state", { path: "/" });

      // Generate single-use authorization exchange code (burn-on-read, 60s TTL)
      const exchangeCode =
        "daih_auth_" + crypto.randomBytes(32).toString("hex");

      await oauthExchangeService.storeExchangeCode(
        exchangeCode,
        {
          accessToken: result.accessToken || "",
          rawRefreshToken: result.rawRefreshToken,
          user: result.user,
          isNewUser: result.isNewUser,
          needsConsent: result.needsConsent,
          destination: getSafeRedirectUrl(result.destination, "/dashboard"),
          codeChallenge: result.clientCodeChallenge || null,
        },
        60,
      );

      const redirectPath = result.needsConsent ? "/consent" : "/auth/callback";
      const targetUrl = new URL(redirectPath, baseRedirectUrl);
      targetUrl.searchParams.set("code", exchangeCode);
      targetUrl.searchParams.set(
        "destination",
        getSafeRedirectUrl(result.destination, "/dashboard"),
      );

      res.redirect(targetUrl.toString());
    } catch (error: any) {
      const errorMsg = error.message || "Google authentication failed";
      res.redirect(
        `${baseRedirectUrl}/login?error=${encodeURIComponent(errorMsg)}`,
      );
    }
  };

  exchangeOAuthCode = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { code, codeVerifier, code_verifier } = req.body;
      const verifier = codeVerifier || code_verifier;

      const data = await oauthExchangeService.exchangeCode(code, verifier);

      if (data.rawRefreshToken) {
        this.setRefreshCookie(res, data.rawRefreshToken, req);
      }

      res.json({
        success: true,
        data: {
          token: data.accessToken,
          accessToken: data.accessToken,
          user: data.user,
          isNewUser: data.isNewUser,
          needsConsent: data.needsConsent,
          destination: data.destination,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  capturePolicyConsent = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        res
          .status(401)
          .json({ code: "UNAUTHORIZED", message: "Authentication required" });
        return;
      }

      const user = await identityService.capturePolicyConsent(
        req.user.id,
        req.body,
      );

      res.json({
        success: true,
        data: {
          user,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  refresh = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const origin = req.headers.origin as string | undefined;
      if (origin && !isAllowedOrigin(origin)) {
        res.status(403).json({
          code: "FORBIDDEN",
          message: "Origin not allowed to refresh credentials",
        });
        return;
      }

      // Extract all candidate tokens if the browser sent multiple duplicate cookie paths
      const candidateTokens: string[] = [];
      const cookieHeader = req.headers.cookie || "";
      if (cookieHeader) {
        for (const cookieItem of cookieHeader.split(";")) {
          const [name, ...rest] = cookieItem.trim().split("=");
          if (
            name === config.cookies.refreshCookieName ||
            name === "daih_refresh_token" ||
            name === "daih_refresh"
          ) {
            const val = decodeURIComponent(rest.join("="));
            if (val && !candidateTokens.includes(val)) {
              candidateTokens.push(val);
            }
          }
        }
      }

      if (
        candidateTokens.length === 0 &&
        req.cookies?.[config.cookies.refreshCookieName]
      ) {
        candidateTokens.push(req.cookies[config.cookies.refreshCookieName]);
      }
      if (
        candidateTokens.length === 0 &&
        config.env === "test" &&
        req.body?.refreshToken
      ) {
        candidateTokens.push(req.body.refreshToken);
      }

      if (candidateTokens.length === 0) {
        res.status(401).json({
          code: "UNAUTHORIZED",
          message: "Authentication refresh cookie is missing",
        });
        return;
      }

      let refreshResult: any = null;
      let lastError: any = null;

      // When multiple paths exist in browser storage (e.g. legacy /refresh vs current /identity),
      // try candidates starting with the most recent (reverse order, as RFC 6265 orders more specific first)
      const tokensToTry =
        candidateTokens.length > 1
          ? [...candidateTokens].reverse()
          : candidateTokens;

      for (const token of tokensToTry) {
        try {
          refreshResult = await identityService.refresh(token, {
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
            deviceFingerprint: computeFingerprint(req),
          });
          break;
        } catch (err: any) {
          lastError = err;
        }
      }

      if (!refreshResult) {
        throw lastError;
      }

      const {
        accessToken,
        rawRefreshToken: nextRefreshToken,
        user,
      } = refreshResult;

      this.setRefreshCookie(res, nextRefreshToken, req);

      res.json({
        success: true,
        data: {
          token: accessToken,
          user,
        },
      });
    } catch (error: any) {
      if (error?.statusCode === 401 || error?.statusCode === 403) {
        this.clearRefreshCookie(res, req);
      }
      next(error);
    }
  };

  logout = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const rawRefreshToken =
        req.cookies?.[config.cookies.refreshCookieName] ||
        req.body?.refreshToken ||
        (req.headers["x-refresh-token"] as string);

      let sessionId: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        try {
          // Cryptographically verify token signature before trusting sessionId to prevent unauthenticated DoS
          const payload = jwt.verify(token, config.jwt.secret, {
            algorithms: ["HS256"],
          }) as any;
          if (payload && payload.sessionId) {
            sessionId = payload.sessionId;
          }
        } catch {
          // Ignore invalid/expired token signatures on logout; proceed with refresh token revocation if present
        }
      }

      if (rawRefreshToken || sessionId) {
        await identityService.logout(rawRefreshToken, sessionId);
      }
      this.clearRefreshCookie(res, req);

      res.json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      next(error);
    }
  };

  verifyEmail = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const token = (req.body?.token as string) || (req.query.token as string);
      const user = await identityService.verifyEmail(token);

      res.json({
        success: true,
        message: "Email verified successfully. You can now log in.",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  };

  verifyEmailStatus = async (
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> => {
    // Non-mutating status check for GET /verify-email to prevent scanner pre-fetching from burning tokens
    const token = (req.query.token as string) || "";
    res.json({
      success: true,
      message: "Please confirm email verification using the client interface.",
      ready: Boolean(token && token.length > 0),
    });
  };

  resendVerification = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await identityService.resendVerification(req.body.email);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  requestPasswordReset = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await identityService.requestPasswordReset(req.body.email);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  confirmPasswordReset = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await identityService.confirmPasswordReset(
        req.body.token,
        req.body.newPassword,
      );
      this.clearRefreshCookie(res);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  setupAccount = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await identityService.setupAccount(
        req.body.token,
        req.body.password,
      );
      this.clearRefreshCookie(res);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  getProfile = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        res
          .status(401)
          .json({ code: "UNAUTHORIZED", message: "Authentication required" });
        return;
      }
      const user = await identityService.getProfile(req.user.id);
      res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  };

  updateProfile = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        res
          .status(401)
          .json({ code: "UNAUTHORIZED", message: "Authentication required" });
        return;
      }
      const user = await identityService.updateProfile(
        req.user.id,
        req.body,
        req.ip,
      );
      res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  };

  submitOnboardingAttribution = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        res
          .status(401)
          .json({ code: "UNAUTHORIZED", message: "Authentication required" });
        return;
      }

      const updated = await identityService.submitOnboardingAttribution(
        req.user.id,
        req.body,
      );

      res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  };

  changePassword = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        res
          .status(401)
          .json({ code: "UNAUTHORIZED", message: "Authentication required" });
        return;
      }
      const result = await identityService.changePassword(
        req.user.id,
        req.body,
        req.ip,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  uploadAvatar = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        res
          .status(401)
          .json({ code: "UNAUTHORIZED", message: "Authentication required" });
        return;
      }

      const validated = uploadAvatarSchema.parse(req.body);
      let inputBuffer: Buffer;
      let mimeType = validated.contentType || "image/jpeg";

      if (validated.data.startsWith("data:")) {
        const matches = validated.data.match(
          /^data:([A-Za-z-+\/]+);base64,(.+)$/,
        );
        if (matches && matches.length === 3) {
          mimeType = matches[1];
          inputBuffer = Buffer.from(matches[2], "base64");
        } else {
          inputBuffer = Buffer.from(validated.data, "base64");
        }
      } else {
        inputBuffer = Buffer.from(validated.data, "base64");
      }

      const result = await identityService.uploadAvatar(
        req.user.id,
        {
          imageBuffer: inputBuffer,
          fileName: validated.fileName,
          mimeType,
        },
        req.protocol,
        req.get("host"),
        req.ip,
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  deleteAvatar = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        res
          .status(401)
          .json({ code: "UNAUTHORIZED", message: "Authentication required" });
        return;
      }

      const result = await identityService.deleteAvatar(req.user.id, req.ip);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  createStaffUser = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = await staffUserService.createStaffUser(req.body, req.user);
      res.status(201).json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  };

  getStaffUsers = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const users = await staffUserService.getStaffUsers();
      res.json({
        success: true,
        data: users,
      });
    } catch (error) {
      next(error);
    }
  };

  updateStaffUser = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = String(req.params.userId);
      const { role, firstName, lastName, phoneNumber, isVerified } = req.body;
      const updater = req.user
        ? { id: req.user.id, role: req.user.role as any }
        : undefined;

      const user = await staffUserService.updateStaffUser(
        userId,
        { role, firstName, lastName, phoneNumber, isVerified },
        updater,
      );

      res.json({
        success: true,
        message: "Staff user updated successfully",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  };

  resendStaffSetupLink = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await staffUserService.resendStaffSetupLink(
        String(req.params.userId),
        req.user,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  getCustomers = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await customerService.getCustomers(req.query as any);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  createCustomer = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const customer = await customerService.createCustomer(req.body);
      res.status(201).json({
        success: true,
        data: customer,
      });
    } catch (error) {
      next(error);
    }
  };

  // ─── MFA Handlers ────────────────────────────────────────────────────────────

  setupMfa = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await identityService.setupMfa(
        req.body.setupToken,
        req.body.method,
      );
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  confirmMfaSetup = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await identityService.confirmMfaSetup(
        req.body.setupToken,
        req.body.method,
        req.body.code,
        req.body.ephemeralSecret,
        {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          deviceFingerprint: computeFingerprint(req),
        },
      );

      this.setRefreshCookie(res, result.rawRefreshToken, req);

      res.json({
        success: true,
        data: {
          token: result.accessToken,
          user: result.user,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  verifyMfaChallenge = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await identityService.verifyMfaChallenge(
        req.body.mfaChallengeToken,
        req.body.code,
        {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          deviceFingerprint: computeFingerprint(req),
        },
      );

      this.setRefreshCookie(res, result.rawRefreshToken, req);

      res.json({
        success: true,
        data: {
          token: result.accessToken,
          user: result.user,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  resendMfaOtp = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await identityService.resendMfaOtp(req.body.mfaChallengeToken);
      res.json({
        success: true,
        message: "A new verification code has been sent to your email",
      });
    } catch (error) {
      next(error);
    }
  };

  initiateProfileMfa = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        res
          .status(401)
          .json({ code: "UNAUTHORIZED", message: "Authentication required" });
        return;
      }

      const result = await identityService.initiateProfileMfa(
        req.user.id,
        req.body.method,
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  confirmProfileMfa = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        res
          .status(401)
          .json({ code: "UNAUTHORIZED", message: "Authentication required" });
        return;
      }

      const result = await identityService.confirmProfileMfa(
        req.user.id,
        req.body.method,
        req.body.code,
        req.body.ephemeralSecret,
      );

      res.json({
        success: true,
        message: `MFA method successfully updated to ${req.body.method === "TOTP" ? "Authenticator App" : "Email OTP"}.`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  disableUserMfa = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await identityService.disableUserMfa(
        String(req.params.userId),
        req.user!.id,
        req.ip,
      );
      res.json({
        success: true,
        message: "MFA has been successfully disabled for this user",
      });
    } catch (error) {
      next(error);
    }
  };

  getMyReferrals = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await identityService.getMyReferrals(req.user!.id);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  getCustomerReferrals = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await customerService.getCustomerReferrals(
        String(req.params.id),
      );
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  debugClientIp = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!config.security.enableDiagnosticIpEndpoint) {
        res.status(404).json({
          code: "NOT_FOUND",
          message: "Not found",
        });
        return;
      }

      res.json({
        success: true,
        data: {
          clientIp: getVerifiedClientIp(req),
          expressIp: req.ip,
          socketRemoteAddress: req.socket?.remoteAddress,
          headers: {
            xForwardedFor: req.headers["x-forwarded-for"],
            xRealIp: req.headers["x-real-ip"],
            cfConnectingIp: req.headers["cf-connecting-ip"],
            xVerifiedClientIp: req.headers["x-verified-client-ip"],
          },
        },
      });
    } catch (error) {
      next(error);
    }
  };

  requestDeactivationOtp = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await identityService.requestDeactivationOtp(req.user!.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  deactivateAccount = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await identityService.deactivateAccount(
        req.user!.id,
        req.body,
      );
      this.clearRefreshCookie(res);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  reactivateAccount = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await identityService.reactivateAccount(
        req.user!.id,
        req.body,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const identityController = new IdentityController();

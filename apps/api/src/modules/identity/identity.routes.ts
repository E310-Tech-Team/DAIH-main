import { Router } from "express";
import { Permission, UserRole } from "@daih/types";
import { identityController } from "./identity.controller.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import {
  requirePermission,
  requireRoles,
  requireStaff,
} from "../../middleware/rbac.middleware.js";
import {
  validateBody,
  validateQuery,
} from "../../middleware/validate.middleware.js";
import {
  loginRateLimiter,
  registrationRateLimiter,
  verificationResendRateLimiter,
  passwordResetRateLimiter,
  refreshRateLimiter,
  oauthExchangeRateLimiter,
} from "../../middleware/rate-limit.middleware.js";
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  requestPasswordResetSchema,
  confirmPasswordResetSchema,
  setupAccountSchema,
  createStaffUserSchema,
  customerFilterSchema,
  createCustomerAdminSchema,
  updateProfileSchema,
  changePasswordSchema,
  mfaSetupSchema,
  mfaVerifySetupSchema,
  mfaVerifyChallengeSchema,
  mfaResendOtpSchema,
  googleAuthSchema,
  onboardingAttributionSchema,
  policyConsentSchema,
  profileMfaInitiateSchema,
  profileMfaConfirmSchema,
  oauthExchangeSchema,
  deactivateAccountSchema,
  reactivateAccountSchema,
} from "./identity.schema.js";

export const identityRouter = Router();

// Public Authentication & Verification Endpoints
identityRouter.post(
  "/register",
  registrationRateLimiter,
  validateBody(registerSchema),
  identityController.register,
);

identityRouter.post(
  "/login",
  loginRateLimiter,
  validateBody(loginSchema),
  identityController.login,
);

identityRouter.post(
  "/auth/google",
  loginRateLimiter,
  validateBody(googleAuthSchema),
  identityController.googleAuth,
);

identityRouter.post(
  "/google",
  loginRateLimiter,
  validateBody(googleAuthSchema),
  identityController.googleAuth,
);

// Google OAuth PKCE Flow
identityRouter.get(
  "/oauth/google",
  loginRateLimiter,
  identityController.initiateGoogleOAuth,
);

identityRouter.get(
  "/oauth/google/callback",
  loginRateLimiter,
  identityController.handleGoogleOAuthCallback,
);

identityRouter.post(
  "/oauth/exchange",
  oauthExchangeRateLimiter,
  validateBody(oauthExchangeSchema),
  identityController.exchangeOAuthCode,
);

// NDPR Policy Consent
identityRouter.post(
  "/consent",
  authenticate,
  validateBody(policyConsentSchema),
  identityController.capturePolicyConsent,
);

// ─── MFA Endpoints ───────────────────────────────────────────────────────────
identityRouter.post(
  "/mfa/setup",
  validateBody(mfaSetupSchema),
  identityController.setupMfa,
);

identityRouter.post(
  "/mfa/verify-setup",
  validateBody(mfaVerifySetupSchema),
  identityController.confirmMfaSetup,
);

identityRouter.post(
  "/mfa/verify",
  loginRateLimiter,
  validateBody(mfaVerifyChallengeSchema),
  identityController.verifyMfaChallenge,
);

identityRouter.post(
  "/mfa/send-otp",
  verificationResendRateLimiter,
  validateBody(mfaResendOtpSchema),
  identityController.resendMfaOtp,
);

identityRouter.post("/refresh", refreshRateLimiter, identityController.refresh);

identityRouter.post("/logout", identityController.logout);

identityRouter.get(
  "/verify-email",
  validateQuery(verifyEmailSchema),
  identityController.verifyEmailStatus,
);

identityRouter.post(
  "/verify-email",
  validateBody(verifyEmailSchema),
  identityController.verifyEmail,
);

identityRouter.post(
  "/resend-verification",
  verificationResendRateLimiter,
  validateBody(resendVerificationSchema),
  identityController.resendVerification,
);

identityRouter.post(
  "/password-reset/request",
  passwordResetRateLimiter,
  validateBody(requestPasswordResetSchema),
  identityController.requestPasswordReset,
);

identityRouter.post(
  "/password-reset/confirm",
  validateBody(confirmPasswordResetSchema),
  identityController.confirmPasswordReset,
);

identityRouter.post(
  "/setup-account",
  passwordResetRateLimiter,
  validateBody(setupAccountSchema),
  identityController.setupAccount,
);

// Protected Profile Endpoints
identityRouter.get("/me", authenticate, identityController.getProfile);
identityRouter.put(
  "/me",
  authenticate,
  validateBody(updateProfileSchema),
  identityController.updateProfile,
);
identityRouter.patch(
  "/me",
  authenticate,
  validateBody(updateProfileSchema),
  identityController.updateProfile,
);
identityRouter.post(
  "/me/change-password",
  authenticate,
  validateBody(changePasswordSchema),
  identityController.changePassword,
);
identityRouter.post(
  "/me/avatar",
  authenticate,
  identityController.uploadAvatar,
);
identityRouter.delete(
  "/me/avatar",
  authenticate,
  identityController.deleteAvatar,
);
identityRouter.get(
  "/me/referrals",
  authenticate,
  identityController.getMyReferrals,
);
identityRouter.post(
  "/me/onboarding-attribution",
  authenticate,
  registrationRateLimiter,
  validateBody(onboardingAttributionSchema),
  identityController.submitOnboardingAttribution,
);

// Authenticated MFA Selection & Change
identityRouter.post(
  "/me/mfa/initiate",
  authenticate,
  validateBody(profileMfaInitiateSchema),
  identityController.initiateProfileMfa,
);

identityRouter.post(
  "/me/mfa/confirm",
  authenticate,
  validateBody(profileMfaConfirmSchema),
  identityController.confirmProfileMfa,
);

// Staff Users Management Endpoints (Strictly Super Admin Protected)
identityRouter.get(
  "/admin/users",
  authenticate,
  requireRoles([UserRole.SUPER_ADMIN]),
  identityController.getStaffUsers,
);

identityRouter.post(
  "/admin/users",
  authenticate,
  requireRoles([UserRole.SUPER_ADMIN]),
  validateBody(createStaffUserSchema),
  identityController.createStaffUser,
);

identityRouter.patch(
  "/admin/users/:userId",
  authenticate,
  requireRoles([UserRole.SUPER_ADMIN]),
  identityController.updateStaffUser,
);

identityRouter.put(
  "/admin/users/:userId/role",
  authenticate,
  requireRoles([UserRole.SUPER_ADMIN]),
  identityController.updateStaffUser,
);

identityRouter.post(
  "/admin/users/:userId/resend-setup",
  authenticate,
  requireRoles([UserRole.SUPER_ADMIN]),
  identityController.resendStaffSetupLink,
);

identityRouter.delete(
  "/admin/users/:userId/mfa",
  authenticate,
  requireRoles([UserRole.SUPER_ADMIN]),
  identityController.disableUserMfa,
);

// Customer / Member Directory Management Endpoints (Accessible to all authenticated staff)
identityRouter.get(
  "/admin/customers",
  authenticate,
  requireStaff(),
  validateQuery(customerFilterSchema),
  identityController.getCustomers,
);

identityRouter.post(
  "/admin/customers",
  authenticate,
  requireStaff(),
  validateBody(createCustomerAdminSchema),
  identityController.createCustomer,
);

identityRouter.get(
  "/admin/customers/:id/referrals",
  authenticate,
  requireStaff(),
  identityController.getCustomerReferrals,
);

// Diagnostic Client IP Verification Endpoint (Strictly Super Admin Protected & Gated)
identityRouter.get(
  "/admin/debug-client-ip",
  authenticate,
  requireRoles([UserRole.SUPER_ADMIN]),
  identityController.debugClientIp,
);

// Customer Account Closure (Self-Service)
identityRouter.post(
  "/account/request-deactivation-otp",
  authenticate,
  identityController.requestDeactivationOtp,
);

identityRouter.post(
  "/account/deactivate",
  authenticate,
  validateBody(deactivateAccountSchema),
  identityController.deactivateAccount,
);

// Support-Led Account Reactivation (Strictly Super Admin)
identityRouter.post(
  "/account/reactivate",
  authenticate,
  requireRoles([UserRole.SUPER_ADMIN]),
  validateBody(reactivateAccountSchema),
  identityController.reactivateAccount,
);

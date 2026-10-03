import { z } from "zod";
import { UserRole } from "@daih/types";
import { sanitizeString } from "../../middleware/validate.middleware.js";

export const strongPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters long")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(
    /[^A-Za-z0-9]/,
    "Password must contain at least one special character (!@#$%^&* etc.)",
  );

export const registerSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required")
    .transform(sanitizeString),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required")
    .transform(sanitizeString),
  email: z.string().trim().email("Invalid email address").toLowerCase(),
  phoneNumber: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val ? sanitizeString(val) : val)),
  password: strongPasswordSchema,
  policyVersion: z.string().trim().default("1.0"),
  consented: z.boolean().refine((val) => val === true, {
    message: "You must accept the terms of service and privacy policy",
  }),
  referralCode: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val ? sanitizeString(val) : val)),
});

export const loginSchema = z.object({
  email: z.string().trim().email("Invalid email address").toLowerCase(),
  password: z.string().min(1, "Password is required"),
  portal: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val ? sanitizeString(val) : val)),
  audience: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val ? sanitizeString(val) : val)),
});

export const verifyEmailSchema = z.object({
  token: z
    .string()
    .min(1, "Verification token is required")
    .transform(sanitizeString),
});

export const resendVerificationSchema = z.object({
  email: z.string().trim().email("Invalid email address").toLowerCase(),
});

export const requestPasswordResetSchema = z.object({
  email: z.string().trim().email("Invalid email address").toLowerCase(),
});

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(1, "Reset token is required").transform(sanitizeString),
  newPassword: strongPasswordSchema,
});

export const createStaffUserSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required")
    .transform(sanitizeString),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required")
    .transform(sanitizeString),
  email: z.string().trim().email("Invalid email address").toLowerCase(),
  phoneNumber: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val ? sanitizeString(val) : val)),
  role: z.nativeEnum(UserRole).refine((role) => role !== UserRole.CUSTOMER, {
    message: "Staff user role must be an administrative or staff role",
  }),
});

export const setupAccountSchema = z.object({
  token: z.string().min(1, "Setup token is required").transform(sanitizeString),
  password: strongPasswordSchema,
});

export const customerFilterSchema = z.object({
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
  tier: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(1000).default(20),
});

export const createCustomerAdminSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required")
    .transform(sanitizeString),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required")
    .transform(sanitizeString),
  email: z.string().trim().email("Invalid email address").toLowerCase(),
  phoneNumber: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val ? sanitizeString(val) : val)),
  tier: z.string().trim().optional(),
  dateOfBirth: z.string().trim().optional(),
  birthday: z.string().trim().optional(),
});

export const updateProfileSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name cannot be empty")
    .transform(sanitizeString)
    .optional(),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name cannot be empty")
    .transform(sanitizeString)
    .optional(),
  phoneNumber: z
    .string()
    .trim()
    .transform((val) => (val ? sanitizeString(val) : val))
    .optional(),
  birthday: z
    .string()
    .trim()
    .regex(
      /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/,
      "Birthday must be in MM-DD format (e.g. 05-24 for May 24th)",
    )
    .nullable()
    .optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: strongPasswordSchema,
});

export const uploadAvatarSchema = z.object({
  data: z.string().min(1, "Image data is required"),
  fileName: z
    .string()
    .optional()
    .transform((val) => (val ? sanitizeString(val) : undefined)),
  contentType: z.string().optional(),
});

// ─── MFA Schemas ─────────────────────────────────────────────────────────────

export const mfaSetupSchema = z.object({
  setupToken: z.string().min(1, "Setup token is required"),
  method: z.enum(["EMAIL_OTP", "TOTP"], {
    errorMap: () => ({ message: "Method must be either EMAIL_OTP or TOTP" }),
  }),
});

export const mfaVerifySetupSchema = z.object({
  setupToken: z.string().min(1, "Setup token is required"),
  method: z.enum(["EMAIL_OTP", "TOTP"], {
    errorMap: () => ({ message: "Method must be either EMAIL_OTP or TOTP" }),
  }),
  code: z
    .string()
    .min(6, "Verification code must be at least 6 characters")
    .max(8)
    .transform(sanitizeString),
  ephemeralSecret: z.string().optional(),
});

export const mfaVerifyChallengeSchema = z.object({
  mfaChallengeToken: z.string().min(1, "MFA challenge token is required"),
  code: z
    .string()
    .min(6, "Verification code must be at least 6 characters")
    .max(8)
    .transform(sanitizeString),
});

export const mfaResendOtpSchema = z.object({
  mfaChallengeToken: z.string().min(1, "MFA challenge token is required"),
});

export const profileMfaInitiateSchema = z.object({
  method: z.enum(["EMAIL_OTP", "TOTP"], {
    errorMap: () => ({ message: "Method must be either EMAIL_OTP or TOTP" }),
  }),
});

export const profileMfaConfirmSchema = z.object({
  method: z.enum(["EMAIL_OTP", "TOTP"], {
    errorMap: () => ({ message: "Method must be either EMAIL_OTP or TOTP" }),
  }),
  code: z
    .string()
    .min(6, "Verification code must be at least 6 characters")
    .max(8)
    .transform(sanitizeString),
  ephemeralSecret: z.string().optional(),
});

// ─── Google Auth & Onboarding Schemas ──────────────────────────────────────────

export const googleAuthSchema = z.object({
  idToken: z.string().trim().min(1, "Google ID token is required"),
  referralCode: z.string().trim().max(50).optional().or(z.literal("")),
  portal: z.enum(["customer", "admin"]).optional(),
});

export const onboardingAttributionSchema = z.object({
  source: z.string().trim().max(50).optional(),
  referralCode: z.string().trim().max(50).optional().or(z.literal("")),
});

export const policyConsentSchema = z.object({
  policyVersion: z.string().trim().default("1.0"),
  consented: z.boolean().refine((val) => val === true, {
    message: "You must accept the terms of service and privacy policy",
  }),
});

export const oauthExchangeSchema = z.object({
  code: z.string().trim().min(1, "Authorization code is required"),
  codeVerifier: z.string().trim().optional(),
  code_verifier: z.string().trim().optional(),
});

export const deactivateAccountSchema = z.object({
  password: z.string().optional(),
  otp: z.string().optional(),
  forfeitCoinsConsent: z.boolean().default(true),
  reason: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val ? sanitizeString(val) : val)),
});

export const reactivateAccountSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
  reason: z
    .string()
    .trim()
    .min(10, "Reason must be at least 10 characters long")
    .transform(sanitizeString),
});

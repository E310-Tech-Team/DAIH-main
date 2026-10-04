/**
 * Public Web Application Configuration
 */

export const CUSTOMER_PORTAL_URL =
  process.env.NEXT_PUBLIC_CUSTOMER_PORTAL_URL ||
  process.env.NEXT_PUBLIC_CUSTOMER_PWA_URL ||
  "http://localhost:3001";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * Legal pages live in the customer portal, which renders the policy documents
 * managed in the admin portal. next.config.mjs redirects /privacy and /terms here.
 */
export const PRIVACY_POLICY_URL = `${CUSTOMER_PORTAL_URL}/privacy`;
export const TERMS_OF_SERVICE_URL = `${CUSTOMER_PORTAL_URL}/terms`;

/**
 * Returns the customer portal login URL with optional post-auth return destination.
 */
export function getPortalLoginUrl(redirectTo?: string): string {
  if (redirectTo) {
    return `${CUSTOMER_PORTAL_URL}/login?redirectTo=${encodeURIComponent(redirectTo)}`;
  }
  return `${CUSTOMER_PORTAL_URL}/login`;
}

/**
 * Returns the customer portal sign up URL with optional post-auth return destination.
 */
export function getPortalRegisterUrl(redirectTo?: string): string {
  if (redirectTo) {
    return `${CUSTOMER_PORTAL_URL}/register?redirectTo=${encodeURIComponent(redirectTo)}`;
  }
  return `${CUSTOMER_PORTAL_URL}/register`;
}

/**
 * Returns the customer portal booking URL for a specific resource slug or ID.
 */
export function getPortalBookingUrl(slugOrId?: string): string {
  if (slugOrId) {
    return `${CUSTOMER_PORTAL_URL}/book/${slugOrId}`;
  }
  return `${CUSTOMER_PORTAL_URL}/book`;
}

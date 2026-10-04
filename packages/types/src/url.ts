/**
 * Allowed host patterns for absolute redirect destinations.
 */
const ALLOWED_REDIRECT_HOSTS = [
  "daih.ng",
  "app.daih.ng",
  "admin.daih.ng",
  "reception.daih.ng",
  "localhost",
  "127.0.0.1",
];

/**
 * Validates and sanitizes a redirect destination URL to prevent Open Redirect vulnerabilities (DAIH-QA-12).
 *
 * @param destination The untrusted destination string provided by query/state
 * @param fallback The fallback path if the destination is invalid or dangerous (defaults to '/dashboard')
 * @returns A safe relative path or validated absolute URL on an allowed DAIH domain
 */
export function getSafeRedirectUrl(
  destination?: string | null,
  fallback: string = "/dashboard",
): string {
  if (!destination || typeof destination !== "string") {
    return fallback;
  }

  const trimmed = destination.trim();
  if (!trimmed) {
    return fallback;
  }

  // Reject newlines, CR, control characters (CRLF injection prevention)
  if (/[\r\n\t\0]/.test(trimmed)) {
    return fallback;
  }

  // Reject backslashes anywhere in the candidate to prevent browser path-confusion bypasses
  // e.g. /\evil.com, \evil.com, https:\\evil.com
  if (trimmed.includes("\\")) {
    return fallback;
  }

  // Reject protocol-relative URLs (e.g. //evil.com or ///evil.com)
  if (/^\/{2,}/.test(trimmed)) {
    return fallback;
  }

  // Safe relative paths: starts with single '/' and followed by an alphanumeric character or standard path character
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  // Check if it's an allowed absolute URL
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fallback;
    }

    const hostname = parsed.hostname.toLowerCase();
    const isAllowedHost = ALLOWED_REDIRECT_HOSTS.some(
      (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
    );

    if (isAllowedHost) {
      return trimmed;
    }
  } catch {
    // Not a valid URL
  }

  return fallback;
}

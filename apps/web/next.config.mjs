import { withSentryConfig } from "@sentry/nextjs";

const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  img-src 'self' data: blob: https:;
  font-src 'self' data: https://fonts.gstatic.com;
  connect-src 'self' https: http://localhost:* ws: wss:;
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
`
  .replace(/\s{2,}/g, " ")
  .trim();

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value: cspHeader,
  },
];

// Mirrors CUSTOMER_PORTAL_URL in lib/config.ts (this file can't import TS).
const customerPortalUrl =
  process.env.NEXT_PUBLIC_CUSTOMER_PORTAL_URL ||
  process.env.NEXT_PUBLIC_CUSTOMER_PWA_URL ||
  "http://localhost:3001";

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@daih/ui", "@daih/types", "@daih/api-client"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    // The customer portal renders the legal documents; this site's old
    // /privacy and /terms pages showed raw Markdown. Temporary (307) so the
    // pages can move back here later without browsers caching the redirect.
    return [
      {
        source: "/privacy",
        destination: `${customerPortalUrl}/privacy`,
        permanent: false,
      },
      {
        source: "/terms",
        destination: `${customerPortalUrl}/terms`,
        permanent: false,
      },
    ];
  },
  async rewrites() {
    const rawApi =
      process.env.INTERNAL_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:4000";
    const apiHost = rawApi
      .replace(/\/api\/v1\/?$/, "")
      .replace(/\/api\/?$/, "")
      .replace(/\/$/, "");
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiHost}/api/v1/:path*`,
      },
      {
        source: "/uploads/:path*",
        destination: `${apiHost}/uploads/:path*`,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT || "daih-web",
  widenClientFileUpload: true,
  hideSourceMaps: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});

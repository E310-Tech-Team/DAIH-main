import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const searchParams = request.nextUrl.searchParams;
  const ref = searchParams.get("ref") || searchParams.get("referralCode");

  if (ref) {
    const cleanRef = ref.trim().toUpperCase();
    if (/^REF-[2-9A-HJ-NP-Z]{6}$/i.test(cleanRef)) {
      response.cookies.set({
        name: "daih_referral_code",
        value: cleanRef,
        maxAge: 30 * 24 * 60 * 60, // 30 days
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
  }

  // Edge HTTP Security Headers
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload",
  );
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  );
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com/gsi/client https://js.paystack.co; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://api.daih.ng https://checkout.paystack.com https://api.paystack.co https: http://localhost:* ws: wss:; frame-src 'self' https://accounts.google.com/ https://checkout.paystack.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self';",
  );

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};

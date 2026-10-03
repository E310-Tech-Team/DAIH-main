import { describe, it, expect } from "vitest";
import { getSafeRedirectUrl } from "@daih/types";

describe("Open Redirect Mitigation (DAIH-QA-12)", () => {
  it("should allow safe relative paths", () => {
    expect(getSafeRedirectUrl("/dashboard")).toBe("/dashboard");
    expect(getSafeRedirectUrl("/bookings/confirmation/123")).toBe(
      "/bookings/confirmation/123",
    );
    expect(getSafeRedirectUrl("/checkout?plan=hot-desk")).toBe(
      "/checkout?plan=hot-desk",
    );
  });

  it("should reject protocol-relative URLs", () => {
    expect(getSafeRedirectUrl("//evil.com")).toBe("/dashboard");
    expect(getSafeRedirectUrl("///evil.com/path")).toBe("/dashboard");
    expect(getSafeRedirectUrl("//attacker.com/login")).toBe("/dashboard");
  });

  it("should reject backslash evasion vectors", () => {
    expect(getSafeRedirectUrl("/\\evil.com")).toBe("/dashboard");
    expect(getSafeRedirectUrl("\\\\evil.com")).toBe("/dashboard");
    expect(getSafeRedirectUrl("/evil\\path")).toBe("/dashboard");
    expect(getSafeRedirectUrl("https:\\evil.com")).toBe("/dashboard");
  });

  it("should reject CRLF injection attempts", () => {
    expect(getSafeRedirectUrl("/dashboard\r\nSet-Cookie: evil=1")).toBe(
      "/dashboard",
    );
    expect(getSafeRedirectUrl("/dashboard\nLocation: https://evil.com")).toBe(
      "/dashboard",
    );
  });

  it("should reject arbitrary external URLs", () => {
    expect(getSafeRedirectUrl("https://evil.com/steal")).toBe("/dashboard");
    expect(getSafeRedirectUrl("http://phishing.site/login")).toBe("/dashboard");
    expect(getSafeRedirectUrl("https://attacker-daih.ng")).toBe("/dashboard");
  });

  it("should reject non-http schemes", () => {
    expect(getSafeRedirectUrl("javascript:alert(1)")).toBe("/dashboard");
    expect(getSafeRedirectUrl("data:text/html,<script>alert(1)</script>")).toBe(
      "/dashboard",
    );
    expect(getSafeRedirectUrl("vbscript:msgbox(1)")).toBe("/dashboard");
  });

  it("should allow approved absolute DAIH URLs", () => {
    expect(getSafeRedirectUrl("https://daih.ng/dashboard")).toBe(
      "https://daih.ng/dashboard",
    );
    expect(getSafeRedirectUrl("https://app.daih.ng/profile")).toBe(
      "https://app.daih.ng/profile",
    );
    expect(getSafeRedirectUrl("http://localhost:3001/checkout")).toBe(
      "http://localhost:3001/checkout",
    );
  });

  it("should fallback to custom fallback if provided", () => {
    expect(getSafeRedirectUrl("//evil.com", "/home")).toBe("/home");
    expect(getSafeRedirectUrl(null, "/login")).toBe("/login");
    expect(getSafeRedirectUrl(undefined, "/custom")).toBe("/custom");
  });
});

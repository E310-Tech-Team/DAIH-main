import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { isAllowedOrigin, config } from "../src/config/env.js";

describe("CORS Policy & Origin Security (DAIH-QA-02)", () => {
  describe("isAllowedOrigin helper", () => {
    it("should allow configured origins like frontend customer portal", () => {
      expect(isAllowedOrigin(config.frontendUrls.customer)).toBe(true);
      expect(isAllowedOrigin("http://localhost:3001")).toBe(true);
    });

    it("should reject malicious or unlisted subdomains", () => {
      expect(isAllowedOrigin("https://attacker.daih.ng")).toBe(false);
      expect(isAllowedOrigin("https://evil-daih.ng")).toBe(false);
      expect(isAllowedOrigin("https://subdomain.attacker.daih.ng")).toBe(false);
    });

    it("should reject arbitrary external origins", () => {
      expect(isAllowedOrigin("https://evil.com")).toBe(false);
      expect(isAllowedOrigin("http://phishing.site")).toBe(false);
    });

    it("should return false for missing or undefined origin", () => {
      expect(isAllowedOrigin(undefined)).toBe(false);
      expect(isAllowedOrigin("")).toBe(false);
    });
  });

  describe("HTTP CORS Headers", () => {
    it("should return Access-Control-Allow-Origin and Vary: Origin for allowed origins", async () => {
      const allowedOrigin = "http://localhost:3001";
      const res = await request(app)
        .get("/health")
        .set("Origin", allowedOrigin);

      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(allowedOrigin);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
      expect(res.headers["vary"]).toContain("Origin");
    });

    it("should NOT return Access-Control-Allow-Origin for arbitrary external origins", async () => {
      const res = await request(app)
        .get("/health")
        .set("Origin", "https://evil.com");

      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      expect(res.headers["vary"]).toContain("Origin");
    });

    it("should NOT return Access-Control-Allow-Origin for unlisted daih.ng subdomains", async () => {
      const res = await request(app)
        .get("/health")
        .set("Origin", "https://unauthorized-subdomain.daih.ng");

      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("Identity Refresh Origin Guard", () => {
    it("should reject refresh requests with unauthorized origin header (403)", async () => {
      const res = await request(app)
        .post("/api/v1/identity/refresh")
        .set("Origin", "https://evil.com")
        .send();

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
      expect(res.body.message).toContain("Origin not allowed");
    });

    it("should reject refresh requests with unauthorized daih subdomain (403)", async () => {
      const res = await request(app)
        .post("/api/v1/identity/refresh")
        .set("Origin", "https://malicious.daih.ng")
        .send();

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    });
  });
});

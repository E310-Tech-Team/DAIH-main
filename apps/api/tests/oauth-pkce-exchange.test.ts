import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { app } from "../src/app.js";
import { oauthExchangeService } from "../src/modules/identity/oauth-exchange.service.js";

describe("OAuth PKCE Code Exchange & Replay Defense (DAIH-QA-03, DAIH-QA-12)", () => {
  const dummyUser = {
    id: "usr_test123",
    email: "customer@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    role: "CUSTOMER",
  };

  it("should successfully exchange code for tokens with valid PKCE verifier", async () => {
    const verifier = "my-secure-pkce-verifier-123456789012345";
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");

    const code = "daih_auth_test_success_1";
    await oauthExchangeService.storeExchangeCode(code, {
      accessToken: "mock_access_jwt_123",
      rawRefreshToken: "mock_refresh_token_456",
      user: dummyUser,
      destination: "/bookings/confirmation",
      codeChallenge: challenge,
    });

    const res = await request(app)
      .post("/api/v1/identity/oauth/exchange")
      .send({
        code,
        code_verifier: verifier,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBe("mock_access_jwt_123");
    expect(res.body.data.user.email).toBe("customer@example.com");
    expect(res.body.data.destination).toBe("/bookings/confirmation");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("should enforce single-use code consumption and reject replay attacks", async () => {
    const verifier = "my-secure-pkce-verifier-replay-test";
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");

    const code = "daih_auth_test_replay_2";
    await oauthExchangeService.storeExchangeCode(code, {
      accessToken: "mock_access_jwt_single_use",
      user: dummyUser,
      destination: "/dashboard",
      codeChallenge: challenge,
    });

    // First attempt: succeeds
    const firstRes = await request(app)
      .post("/api/v1/identity/oauth/exchange")
      .send({ code, code_verifier: verifier });

    expect(firstRes.status).toBe(200);

    // Second attempt: replay attack must fail
    const secondRes = await request(app)
      .post("/api/v1/identity/oauth/exchange")
      .send({ code, code_verifier: verifier });

    expect(secondRes.status).toBe(400);
    expect(secondRes.body.code).toBe("INVALID_AUTH_CODE");
  });

  it("should burn code immediately on PKCE mismatch (no retry with brute force)", async () => {
    const validVerifier = "correct-verifier-secret-987654321";
    const challenge = crypto
      .createHash("sha256")
      .update(validVerifier)
      .digest("base64url");

    const code = "daih_auth_test_mismatch_3";
    await oauthExchangeService.storeExchangeCode(code, {
      accessToken: "mock_jwt_secret",
      user: dummyUser,
      destination: "/dashboard",
      codeChallenge: challenge,
    });

    // Mismatched verifier
    const failRes = await request(app)
      .post("/api/v1/identity/oauth/exchange")
      .send({ code, code_verifier: "wrong-verifier-attempt" });

    expect(failRes.status).toBe(400);
    expect(failRes.body.code).toBe("PKCE_VERIFICATION_FAILED");

    // Code is burned: subsequent attempt with CORRECT verifier must now fail as expired/invalid
    const retryRes = await request(app)
      .post("/api/v1/identity/oauth/exchange")
      .send({ code, code_verifier: validVerifier });

    expect(retryRes.status).toBe(400);
    expect(retryRes.body.code).toBe("INVALID_AUTH_CODE");
  });

  it("should reject when PKCE verifier is missing for PKCE-bound flow", async () => {
    const code = "daih_auth_test_missing_verifier";
    await oauthExchangeService.storeExchangeCode(code, {
      accessToken: "mock_jwt",
      user: dummyUser,
      destination: "/dashboard",
      codeChallenge: "some_challenge_value",
    });

    const res = await request(app)
      .post("/api/v1/identity/oauth/exchange")
      .send({ code });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PKCE_VERIFIER_REQUIRED");
  });

  it("should allow exchange without PKCE for flows without codeChallenge", async () => {
    const code = "daih_auth_test_no_challenge";
    await oauthExchangeService.storeExchangeCode(code, {
      accessToken: "mock_jwt_non_pkce",
      user: dummyUser,
      destination: "/dashboard",
      codeChallenge: null,
    });

    const res = await request(app)
      .post("/api/v1/identity/oauth/exchange")
      .send({ code });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe("mock_jwt_non_pkce");
  });
});

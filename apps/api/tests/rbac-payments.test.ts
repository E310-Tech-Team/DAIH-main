import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { config } from "../src/config/env.js";
import { UserRole, Permission, ROLE_PERMISSIONS } from "@daih/types";

describe("RBAC Payment Permissions Separation (DAIH-QA-09)", () => {
  describe("Role Permission Matrix", () => {
    it("grants OPERATIONS_ADMIN summary payment reading, but denies full details and refund", () => {
      const opsPerms = ROLE_PERMISSIONS[UserRole.OPERATIONS_ADMIN];
      expect(opsPerms).toContain(Permission.PAYMENTS_READ_SUMMARY);
      expect(opsPerms).not.toContain(Permission.PAYMENTS_READ_FULL);
      expect(opsPerms).not.toContain(Permission.PAYMENTS_REFUND);
    });

    it("grants FINANCE_OFFICER summary reading, full details, and refund permissions", () => {
      const finPerms = ROLE_PERMISSIONS[UserRole.FINANCE_OFFICER];
      expect(finPerms).toContain(Permission.PAYMENTS_READ_SUMMARY);
      expect(finPerms).toContain(Permission.PAYMENTS_READ_FULL);
      expect(finPerms).toContain(Permission.PAYMENTS_REFUND);
    });

    it("grants MANAGEMENT_VIEWER summary reading, but denies full details and refund", () => {
      const mgmtPerms = ROLE_PERMISSIONS[UserRole.MANAGEMENT_VIEWER];
      expect(mgmtPerms).toContain(Permission.PAYMENTS_READ_SUMMARY);
      expect(mgmtPerms).not.toContain(Permission.PAYMENTS_READ_FULL);
      expect(mgmtPerms).not.toContain(Permission.PAYMENTS_REFUND);
    });

    it("denies CUSTOMER any payment administrative permissions", () => {
      const custPerms = ROLE_PERMISSIONS[UserRole.CUSTOMER];
      expect(custPerms).not.toContain(Permission.PAYMENTS_READ_SUMMARY);
      expect(custPerms).not.toContain(Permission.PAYMENTS_READ_FULL);
      expect(custPerms).not.toContain(Permission.PAYMENTS_REFUND);
    });
  });

  describe("HTTP Endpoint Enforcement", () => {
    const opsAdminToken = jwt.sign(
      {
        sub: "usr_ops_001",
        email: "ops@daih.ng",
        role: UserRole.OPERATIONS_ADMIN,
      },
      config.jwt.secret,
      { expiresIn: "1h" },
    );

    const managementToken = jwt.sign(
      {
        sub: "usr_mgmt_001",
        email: "mgmt@daih.ng",
        role: UserRole.MANAGEMENT_VIEWER,
      },
      config.jwt.secret,
      { expiresIn: "1h" },
    );

    const financeToken = jwt.sign(
      {
        sub: "usr_fin_001",
        email: "finance@daih.ng",
        role: UserRole.FINANCE_OFFICER,
      },
      config.jwt.secret,
      { expiresIn: "1h" },
    );

    describe("Full Transaction Details (/admin/transactions)", () => {
      it("blocks Operations Admin from reading full transaction details (403)", async () => {
        const res = await request(app)
          .get("/api/v1/payments/admin/transactions")
          .set("Authorization", `Bearer ${opsAdminToken}`);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe("FORBIDDEN");
        expect(res.body.message).toContain("payments:read_full");
      });

      it("blocks Management Viewer from reading full transaction details (403)", async () => {
        const res = await request(app)
          .get("/api/v1/payments/admin/transactions")
          .set("Authorization", `Bearer ${managementToken}`);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe("FORBIDDEN");
        expect(res.body.message).toContain("payments:read_full");
      });

      it("allows Finance Officer to access full transaction details", async () => {
        const res = await request(app)
          .get("/api/v1/payments/admin/transactions")
          .set("Authorization", `Bearer ${financeToken}`);

        // Must not be blocked by RBAC 403 Forbidden
        expect(res.status).not.toBe(403);
      });
    });

    describe("Refund Actions (/admin/refunds/:id/approve)", () => {
      it("blocks Operations Admin from approving refunds (403)", async () => {
        const res = await request(app)
          .post("/api/v1/payments/admin/refunds/ref_test_001/approve")
          .set("Authorization", `Bearer ${opsAdminToken}`);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe("FORBIDDEN");
        expect(res.body.message).toContain("payments:refund");
      });

      it("blocks Operations Admin from rejecting refunds (403)", async () => {
        const res = await request(app)
          .post("/api/v1/payments/admin/refunds/ref_test_001/reject")
          .set("Authorization", `Bearer ${opsAdminToken}`)
          .send({ reason: "Not allowed" });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe("FORBIDDEN");
        expect(res.body.message).toContain("payments:refund");
      });

      it("allows Finance Officer through RBAC guard on refund endpoints", async () => {
        const res = await request(app)
          .post("/api/v1/payments/admin/refunds/ref_test_001/approve")
          .set("Authorization", `Bearer ${financeToken}`);

        // Must pass RBAC permission check (may return 404/400 for mock ID, but never 403)
        expect(res.status).not.toBe(403);
      });
    });

    describe("Summary Endpoints (/admin/daily-summary & /admin/reconciliation)", () => {
      it("allows Operations Admin to access daily payment summary", async () => {
        const res = await request(app)
          .get("/api/v1/payments/admin/daily-summary")
          .set("Authorization", `Bearer ${opsAdminToken}`);

        expect(res.status).not.toBe(403);
      });

      it("allows Operations Admin to access reconciliation overview", async () => {
        const res = await request(app)
          .get("/api/v1/payments/admin/reconciliation")
          .set("Authorization", `Bearer ${opsAdminToken}`);

        expect(res.status).not.toBe(403);
      });

      it("allows Management Viewer to access daily summary and reconciliation", async () => {
        const summaryRes = await request(app)
          .get("/api/v1/payments/admin/daily-summary")
          .set("Authorization", `Bearer ${managementToken}`);

        expect(summaryRes.status).not.toBe(403);

        const reconRes = await request(app)
          .get("/api/v1/payments/admin/reconciliation")
          .set("Authorization", `Bearer ${managementToken}`);

        expect(reconRes.status).not.toBe(403);
      });
    });
  });
});

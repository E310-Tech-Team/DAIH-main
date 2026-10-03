import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db/client.js";
import { UserRole } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

describe("Coin Balance Non-Negative CHECK Constraints (Phase 3A)", () => {
  let testUserId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `chk_constraint_${Date.now()}@daih.ng`,
        clientId: `DAIH-CHK-${Date.now()}`,
        passwordHash: "test_hash",
        firstName: "Check",
        lastName: "Constraint",
        role: UserRole.CUSTOMER,
        isVerified: true,
      },
    });
    testUserId = user.id;

    // Create initial valid coin balance
    await prisma.coinBalance.create({
      data: {
        userId: testUserId,
        balance: new Decimal("10.00"),
        lifetimeEarned: new Decimal("20.00"),
        lifetimeBurned: new Decimal("10.00"),
      },
    });
  });

  afterAll(async () => {
    if (testUserId) {
      await prisma.coinBalance.deleteMany({ where: { userId: testUserId } });
      await prisma.user.delete({ where: { id: testUserId } });
    }
  });

  it("rejects negative balance via chk_coin_balance_non_negative", async () => {
    let errorCaught: any = null;
    try {
      await prisma.$executeRaw`
        UPDATE "coin_balances"
        SET "balance" = -5.00
        WHERE "userId" = ${testUserId}
      `;
    } catch (err: any) {
      errorCaught = err;
    }

    expect(errorCaught).not.toBeNull();
    expect(errorCaught.message).toMatch(/chk_coin_balance_non_negative/i);
  });

  it("rejects negative lifetimeEarned via chk_coin_lifetime_earned_non_negative", async () => {
    let errorCaught: any = null;
    try {
      await prisma.$executeRaw`
        UPDATE "coin_balances"
        SET "lifetimeEarned" = -1.00
        WHERE "userId" = ${testUserId}
      `;
    } catch (err: any) {
      errorCaught = err;
    }

    expect(errorCaught).not.toBeNull();
    expect(errorCaught.message).toMatch(
      /chk_coin_lifetime_earned_non_negative/i,
    );
  });

  it("rejects negative lifetimeBurned via chk_coin_lifetime_burned_non_negative", async () => {
    let errorCaught: any = null;
    try {
      await prisma.$executeRaw`
        UPDATE "coin_balances"
        SET "lifetimeBurned" = -0.50
        WHERE "userId" = ${testUserId}
      `;
    } catch (err: any) {
      errorCaught = err;
    }

    expect(errorCaught).not.toBeNull();
    expect(errorCaught.message).toMatch(
      /chk_coin_lifetime_burned_non_negative/i,
    );
  });

  it("allows non-negative updates (0.00 and positive values)", async () => {
    await prisma.$executeRaw`
      UPDATE "coin_balances"
      SET "balance" = 0.00, "lifetimeEarned" = 25.00, "lifetimeBurned" = 25.00
      WHERE "userId" = ${testUserId}
    `;

    const fresh = await prisma.coinBalance.findUnique({
      where: { userId: testUserId },
    });
    expect(Number(fresh?.balance)).toBe(0);
    expect(Number(fresh?.lifetimeEarned)).toBe(25);
    expect(Number(fresh?.lifetimeBurned)).toBe(25);
  });
});

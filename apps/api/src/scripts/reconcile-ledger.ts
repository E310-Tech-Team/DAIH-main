import { prisma } from "../db/client.js";
import { Decimal } from "@prisma/client/runtime/library";
import {
  TotalsState,
  applyEntryToTotals,
} from "../modules/loyalty/loyalty.utils.js";

interface ReconcileResult {
  userId: string;
  clientId?: string;
  email?: string;
  isClean: boolean;
  storedBalance: string;
  entrySum: string;
  foldedBalance: string;
  storedEarned: string;
  foldedEarned: string;
  storedBurned: string;
  foldedBurned: string;
  entryCount: number;
  errors: string[];
}

export async function reconcileAllUserBalances(): Promise<{
  totalUsers: number;
  cleanUsers: number;
  discrepantUsers: number;
  results: ReconcileResult[];
}> {
  // Find all users in coin_balances or coin_ledger_entries
  const balances = await prisma.coinBalance.findMany({
    include: {
      user: {
        select: { id: true, clientId: true, email: true },
      },
    },
  });

  const entryUserIds = (
    await prisma.coinLedgerEntry.findMany({
      select: { userId: true },
      distinct: ["userId"],
    })
  ).map((e) => e.userId);

  const allUserIds = Array.from(
    new Set([...balances.map((b) => b.userId), ...entryUserIds]),
  );

  const results: ReconcileResult[] = [];
  let cleanCount = 0;
  let discrepantCount = 0;

  for (const userId of allUserIds) {
    const balanceRecord =
      balances.find((b) => b.userId === userId) ||
      (await prisma.coinBalance.findUnique({
        where: { userId },
        include: {
          user: { select: { id: true, clientId: true, email: true } },
        },
      }));

    const user =
      balanceRecord?.user ||
      (await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, clientId: true, email: true },
      }));

    const entries = await prisma.coinLedgerEntry.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    const storedBalance = balanceRecord
      ? new Decimal(balanceRecord.balance)
      : new Decimal(0);
    const storedEarned = balanceRecord
      ? new Decimal(balanceRecord.lifetimeEarned)
      : new Decimal(0);
    const storedBurned = balanceRecord
      ? new Decimal(balanceRecord.lifetimeBurned)
      : new Decimal(0);

    const entrySum = entries.reduce(
      (sum, e) => sum.plus(new Decimal(e.amount)),
      new Decimal(0),
    );

    let foldTotals: TotalsState = {
      balance: new Decimal(0),
      lifetimeEarned: new Decimal(0),
      lifetimeBurned: new Decimal(0),
    };

    const errors: string[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      foldTotals = applyEntryToTotals(foldTotals, {
        action: entry.action,
        amount: new Decimal(entry.amount),
        metadata: entry.metadata,
      });

      const entryBalAfter = new Decimal(entry.balanceAfter);
      if (!entryBalAfter.equals(foldTotals.balance)) {
        errors.push(
          `Entry #${i + 1} (${entry.id}) balanceAfter (${entryBalAfter.toFixed(2)}) != running fold (${foldTotals.balance.toFixed(2)})`,
        );
      }
    }

    if (!storedBalance.equals(entrySum)) {
      errors.push(
        `Stored balance (${storedBalance.toFixed(2)}) != entry sum (${entrySum.toFixed(2)})`,
      );
    }

    if (!storedBalance.equals(foldTotals.balance)) {
      errors.push(
        `Stored balance (${storedBalance.toFixed(2)}) != folded balance (${foldTotals.balance.toFixed(2)})`,
      );
    }

    if (!storedEarned.equals(foldTotals.lifetimeEarned)) {
      errors.push(
        `Stored earned (${storedEarned.toFixed(2)}) != folded earned (${foldTotals.lifetimeEarned.toFixed(2)})`,
      );
    }

    if (!storedBurned.equals(foldTotals.lifetimeBurned)) {
      errors.push(
        `Stored burned (${storedBurned.toFixed(2)}) != folded burned (${foldTotals.lifetimeBurned.toFixed(2)})`,
      );
    }

    const isClean = errors.length === 0;
    if (isClean) {
      cleanCount++;
    } else {
      discrepantCount++;
    }

    results.push({
      userId,
      clientId: user?.clientId,
      email: user?.email,
      isClean,
      storedBalance: storedBalance.toFixed(2),
      entrySum: entrySum.toFixed(2),
      foldedBalance: foldTotals.balance.toFixed(2),
      storedEarned: storedEarned.toFixed(2),
      foldedEarned: foldTotals.lifetimeEarned.toFixed(2),
      storedBurned: storedBurned.toFixed(2),
      foldedBurned: foldTotals.lifetimeBurned.toFixed(2),
      entryCount: entries.length,
      errors,
    });
  }

  return {
    totalUsers: allUserIds.length,
    cleanUsers: cleanCount,
    discrepantUsers: discrepantCount,
    results,
  };
}

async function main() {
  console.log(`\n======================================================`);
  console.log(`🔍 Running PeeDee Coin Ledger Reconciliation Audit`);
  console.log(`======================================================\n`);

  const audit = await reconcileAllUserBalances();

  for (const r of audit.results) {
    const label = `${r.clientId || r.userId} (${r.email || "no email"})`;
    if (r.isClean) {
      console.log(
        `✅ [${label}] Clean: Balance=${r.storedBalance}, Earned=${r.storedEarned}, Burned=${r.storedBurned}, Entries=${r.entryCount}`,
      );
    } else {
      console.error(
        `❌ [${label}] DISCREPANCY DETECTED (${r.errors.length} errors):`,
      );
      for (const err of r.errors) {
        console.error(`     - ${err}`);
      }
    }
  }

  console.log(`\n======================================================`);
  console.log(`Reconciliation Summary:`);
  console.log(`  Total Users Checked: ${audit.totalUsers}`);
  console.log(`  Clean Accounts:      ${audit.cleanUsers}`);
  console.log(`  Discrepant Accounts: ${audit.discrepantUsers}`);
  console.log(`======================================================\n`);

  try {
    const fs = await import("fs");
    const path = await import("path");
    const reportsDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    const reportPath = path.join(reportsDir, "reconcile-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(audit, null, 2));
    console.log(`📁 Report archived to: ${reportPath}\n`);
  } catch (err) {
    console.warn("Could not archive report file:", err);
  }

  if (audit.discrepantUsers > 0) {
    process.exit(1);
  }
}

// Execute when run as script
if (process.argv[1]?.includes("reconcile-ledger")) {
  main()
    .catch((err) => {
      console.error("Reconciliation audit failed:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

import { prisma } from "../db/client.js";
import { sanitizePolicyContent } from "../modules/legal/legal.service.js";

async function main() {
  console.log(
    "[Sanitize] Scanning legal_policies table for unescaped or malicious HTML...",
  );

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "type", "title", "content" FROM "legal_policies";
    `);

    if (rows.length === 0) {
      console.log("[Sanitize] No policies found in database. Exiting.");
      return;
    }

    let sanitizedCount = 0;
    for (const row of rows) {
      const clean = sanitizePolicyContent(row.content);
      if (clean !== row.content) {
        await prisma.$executeRawUnsafe(
          `UPDATE "legal_policies" SET "content" = $1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $2;`,
          clean,
          row.id,
        );
        console.log(
          `[Sanitize] Successfully sanitized policy: ${row.type} (ID: ${row.id})`,
        );
        sanitizedCount++;
      } else {
        console.log(`[Sanitize] Policy ${row.type} is already clean.`);
      }
    }

    console.log(
      `[Sanitize] Completed! Total policies sanitized: ${sanitizedCount}`,
    );
  } catch (err: any) {
    console.error(
      "[Sanitize] Error running policy sanitization:",
      err?.message,
    );
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

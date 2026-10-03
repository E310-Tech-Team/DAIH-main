import { prisma } from "../../db/client.js";
import {
  DEFAULT_POLICIES,
  DEFAULT_TERMS_OF_SERVICE,
  DEFAULT_PRIVACY_POLICY,
} from "./default-policies.js";
import {
  LegalPolicyRecord,
  PolicyType,
  UpdatePolicyDTO,
} from "./legal.types.js";
import { redis } from "../../config/redis.js";
import sanitizeHtml from "sanitize-html";

export const LEGAL_ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "strong",
  "em",
  "u",
  "del",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "br",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

export function sanitizePolicyContent(raw: string): string {
  if (!raw || !raw.trim()) return "";
  return sanitizeHtml(raw.trim(), {
    allowedTags: LEGAL_ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      th: ["colspan", "rowspan", "align"],
      td: ["colspan", "rowspan", "align"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard",
    transformTags: {
      a: (tagName, attribs) => {
        return {
          tagName: "a",
          attribs: {
            ...attribs,
            rel: "noopener noreferrer",
            target: "_blank",
          },
        };
      },
    },
  });
}

export class LegalService {
  private isInitialized = false;
  private memoryCache = new Map<
    string,
    { data: LegalPolicyRecord; expires: number }
  >();

  /**
   * Automatically provisions the legal_policies table if it doesn't already exist.
   * Runs raw SQL to ensure zero downtime without requiring manual migration during hot dev.
   */
  async ensureTableInitialized(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "legal_policies" (
          "id" VARCHAR(64) PRIMARY KEY,
          "type" VARCHAR(64) UNIQUE NOT NULL,
          "title" TEXT NOT NULL,
          "content" TEXT NOT NULL,
          "version" VARCHAR(32) NOT NULL DEFAULT '1.0',
          "effective_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_by" VARCHAR(64)
        );
      `);

      // Check existing policies and seed defaults if empty
      for (const def of DEFAULT_POLICIES) {
        const rows: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "legal_policies" WHERE "type" = $1 LIMIT 1;`,
          def.type,
        );

        if (rows.length === 0) {
          const id = `policy_${def.type.toLowerCase()}`;
          await prisma.$executeRawUnsafe(
            `
            INSERT INTO "legal_policies" ("id", "type", "title", "content", "version", "effective_date", "updated_at")
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT ("type") DO NOTHING;
            `,
            id,
            def.type,
            def.title,
            def.content,
            def.version,
          );
        }
      }

      this.isInitialized = true;
    } catch (err: any) {
      console.error(
        "[LegalService] Table initialization warning/fallback:",
        err?.message,
      );
    }
  }

  private mapRow(row: any): LegalPolicyRecord {
    return {
      id: row.id,
      type: row.type as PolicyType,
      title: row.title,
      content: row.content,
      version: row.version || "1.0",
      effectiveDate: row.effective_date
        ? new Date(row.effective_date)
        : new Date(),
      updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
      updatedBy: row.updated_by || null,
    };
  }

  /**
   * Retrieves all active legal policy documents
   */
  async getAllPolicies(): Promise<LegalPolicyRecord[]> {
    await this.ensureTableInitialized();

    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT * FROM "legal_policies" ORDER BY "type" ASC;`,
      );

      if (rows.length > 0) {
        return rows.map((r) => this.mapRow(r));
      }
    } catch (err: any) {
      console.warn(
        "[LegalService] DB query failed, using in-code defaults:",
        err?.message,
      );
    }

    // Fallback to in-code default policies if table is unavailable
    return DEFAULT_POLICIES.map((def) => ({
      id: `policy_${def.type.toLowerCase()}`,
      type: def.type,
      title: def.title,
      content: def.content,
      version: def.version,
      effectiveDate: new Date(),
      updatedAt: new Date(),
      updatedBy: null,
    }));
  }

  /**
   * Retrieves a specific legal policy by type
   */
  async getPolicyByType(type: PolicyType): Promise<LegalPolicyRecord> {
    const cacheKey = `policy:${type}`;

    // 1. Memory cache check (fastest)
    const cached = this.memoryCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    // 2. Redis cache check
    try {
      if (redis.status === "ready") {
        const raw = await redis.get(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          this.memoryCache.set(cacheKey, {
            data: parsed,
            expires: Date.now() + 60000,
          });
          return parsed;
        }
      }
    } catch {}

    await this.ensureTableInitialized();

    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT * FROM "legal_policies" WHERE "type" = $1 LIMIT 1;`,
        type,
      );

      if (rows.length > 0) {
        const policy = this.mapRow(rows[0]);
        this.cachePolicy(cacheKey, policy);
        return policy;
      }
    } catch (err: any) {
      console.warn(`[LegalService] DB fetch failed for ${type}:`, err?.message);
    }

    // Fallback to default policy
    const def =
      type === "TERMS_OF_SERVICE"
        ? DEFAULT_TERMS_OF_SERVICE
        : DEFAULT_PRIVACY_POLICY;

    const fallback: LegalPolicyRecord = {
      id: `policy_${def.type.toLowerCase()}`,
      type: def.type,
      title: def.title,
      content: def.content,
      version: def.version,
      effectiveDate: new Date(),
      updatedAt: new Date(),
      updatedBy: null,
    };

    return fallback;
  }

  /**
   * Updates an existing policy. Guarded by Operations Admin & Super Admin.
   */
  async updatePolicy(
    type: PolicyType,
    dto: UpdatePolicyDTO,
    adminUserId?: string,
  ): Promise<LegalPolicyRecord> {
    await this.ensureTableInitialized();

    if (!dto.content || dto.content.trim().length === 0) {
      const error: any = new Error("Policy content cannot be empty.");
      error.code = "VALIDATION_ERROR";
      error.statusCode = 400;
      throw error;
    }

    const current = await this.getPolicyByType(type);
    const newVersion =
      dto.version?.trim() || this.incrementMinorVersion(current.version);
    const newTitle = dto.title?.trim() || current.title;
    const sanitizedContent = sanitizePolicyContent(dto.content);

    try {
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "legal_policies" ("id", "type", "title", "content", "version", "effective_date", "updated_at", "updated_by")
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $6)
        ON CONFLICT ("type") DO UPDATE
        SET "title" = EXCLUDED."title",
            "content" = EXCLUDED."content",
            "version" = EXCLUDED."version",
            "updated_at" = CURRENT_TIMESTAMP,
            "updated_by" = EXCLUDED."updated_by";
        `,
        current.id || `policy_${type.toLowerCase()}`,
        type,
        newTitle,
        sanitizedContent,
        newVersion,
        adminUserId || null,
      );
    } catch (err: any) {
      console.error(
        `[LegalService] Error updating policy ${type}:`,
        err?.message,
      );
      throw err;
    }

    // Clear caches
    const cacheKey = `policy:${type}`;
    this.memoryCache.delete(cacheKey);
    try {
      if (redis.status === "ready") {
        await redis.del(cacheKey);
      }
    } catch {}

    return this.getPolicyByType(type);
  }

  private incrementMinorVersion(version: string): string {
    const parts = version.split(".");
    if (parts.length >= 2) {
      const minor = parseInt(parts[1], 10);
      if (!isNaN(minor)) {
        return `${parts[0]}.${minor + 1}`;
      }
    }
    return `${version}.1`;
  }

  private cachePolicy(key: string, data: LegalPolicyRecord): void {
    this.memoryCache.set(key, { data, expires: Date.now() + 60000 });
    try {
      if (redis.status === "ready") {
        redis.setex(key, 300, JSON.stringify(data)).catch(() => {});
      }
    } catch {}
  }
}

export const legalService = new LegalService();

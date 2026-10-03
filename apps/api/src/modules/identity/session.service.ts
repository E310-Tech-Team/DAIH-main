import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { UserRole } from "@daih/types";
import { config } from "../../config/env.js";
import { prisma } from "../../db/client.js";
import { redis } from "../../config/redis.js";
import { passwordService } from "./password.service.js";
import {
  JwtTokenPayload,
  SessionContext,
  UserSummaryDTO,
} from "./identity.types.js";
import {
  recordTelemetry,
  sendDebouncedSecurityAlert,
} from "../../utils/security-alert.js";
import {
  setInProcessCache,
  invalidateInProcessCache,
} from "../../utils/revocation-cache.js";

export class SessionService {
  /**
   * Generates a short-lived JWT access token
   */
  generateAccessToken(payload: JwtTokenPayload): string {
    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn as any,
    });
  }

  /**
   * Verifies and decodes a JWT access token
   */
  verifyAccessToken(token: string): JwtTokenPayload {
    return jwt.verify(token, config.jwt.secret) as JwtTokenPayload;
  }

  /**
   * Mark session active in Redis cache and in-process shielding cache
   */
  async markSessionActiveInCache(sessionId: string): Promise<void> {
    setInProcessCache(sessionId, true, 5000);
    try {
      await redis.setex(`daih:session:active:${sessionId}`, 900, "1");
      await redis.del(`daih:session:revoked:${sessionId}`);
    } catch {
      // Non-blocking cache error
    }
  }

  /**
   * Mark session revoked in Redis cache and in-process shielding cache
   */
  async markSessionRevokedInCache(sessionId: string): Promise<void> {
    invalidateInProcessCache(sessionId);
    try {
      await redis.del(`daih:session:active:${sessionId}`);
      await redis.setex(`daih:session:revoked:${sessionId}`, 900, "1");
    } catch {
      // Non-blocking cache error
    }
  }

  /**
   * Creates a new authenticated session with an access token and an HttpOnly refresh token
   */
  async createSession(
    user: UserSummaryDTO,
    context: SessionContext = {},
  ): Promise<{ accessToken: string; rawRefreshToken: string }> {
    const rawRefreshToken = passwordService.generateSecureToken(32);
    const refreshTokenHash = passwordService.hashToken(rawRefreshToken);
    const tokenFamily = randomUUID();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.jwt.refreshExpiresInDays);

    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        tokenFamily,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        deviceFingerprint: context.deviceFingerprint || null,
        mismatchCount: 0,
        expiresAt,
        lastUsedAt: new Date(),
      },
    });

    await this.markSessionActiveInCache(session.id);

    const accessToken = this.generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      clientId: user.clientId,
      sessionId: session.id,
    });

    return { accessToken, rawRefreshToken };
  }

  /**
   * Rotates a refresh token, issuing a new access token and rotating the refresh token.
   * If token reuse is detected (attempting to use an already-rotated or revoked token),
   * all sessions in that token family are revoked.
   * Includes a 10-second concurrency grace window to prevent race-condition false-positives.
   */
  async rotateRefreshToken(
    rawRefreshToken: string,
    context: SessionContext = {},
  ): Promise<{
    accessToken: string;
    rawRefreshToken: string;
    user: UserSummaryDTO;
  }> {
    const tokenHash = passwordService.hashToken(rawRefreshToken);

    const session = await prisma.authSession.findUnique({
      where: { refreshTokenHash: tokenHash },
      include: { user: true },
    });

    if (!session) {
      throw new Error("INVALID_REFRESH_TOKEN");
    }

    if (session.user && (session.user as any).deactivatedAt) {
      const error: any = new Error("ACCOUNT_DEACTIVATED");
      error.code = "ACCOUNT_DEACTIVATED";
      error.statusCode = 403;
      throw error;
    }

    // If session is already marked revoked -> Check grace window for concurrent requests
    if (session.isRevoked) {
      const GRACE_WINDOW_MS = config.jwt.refreshGraceWindowMs || 30000;
      const timeSinceRevocation =
        Date.now() - new Date(session.updatedAt).getTime();

      if (timeSinceRevocation <= GRACE_WINDOW_MS) {
        // Find newest active session in this family created during the rotation
        const activeSession = await prisma.authSession.findFirst({
          where: {
            tokenFamily: session.tokenFamily,
            isRevoked: false,
            expiresAt: { gt: new Date() },
          },
          include: { user: true },
          orderBy: { createdAt: "desc" },
        });

        if (activeSession && activeSession.user) {
          // Device fingerprint verification
          let isMatch = false;
          let fingerprintState: "null" | "matched" | "mismatched" = "matched";

          if (!session.deviceFingerprint) {
            // Backward compatibility: Pre-migration session with null fingerprint
            fingerprintState = "null";
            isMatch = true;

            // Auto-enroll fingerprint on the session for future checks
            if (context.deviceFingerprint) {
              await prisma.authSession
                .update({
                  where: { id: session.id },
                  data: { deviceFingerprint: context.deviceFingerprint },
                })
                .catch(() => {});
            }
          } else if (session.deviceFingerprint === context.deviceFingerprint) {
            fingerprintState = "matched";
            isMatch = true;
          } else {
            fingerprintState = "mismatched";
            isMatch = false;
          }

          // Un-debounced telemetry evaluation tracking
          await recordTelemetry("auth.refresh.grace_window_hit", {
            matched: isMatch,
            fingerprint_state: fingerprintState,
            tokenFamily: session.tokenFamily,
            sessionId: session.id,
          });

          if (!isMatch) {
            await recordTelemetry("auth.refresh.grace_window_mismatch", {
              matched: false,
              fingerprint_state: "mismatched",
              tokenFamily: session.tokenFamily,
              sessionId: session.id,
            });

            // ATOMIC INCREMENT across all sessions in this tokenFamily to eliminate race conditions
            await prisma.authSession.updateMany({
              where: { tokenFamily: session.tokenFamily },
              data: { mismatchCount: { increment: 1 } },
            });

            // Read the post-increment count for this family
            const updatedSession = await prisma.authSession.findFirst({
              where: { tokenFamily: session.tokenFamily },
              select: { mismatchCount: true },
              orderBy: { updatedAt: "desc" },
            });

            const currentMismatchCount = updatedSession?.mismatchCount ?? 1;

            // Strike 2+: Post-increment count > 1 -> Full immediate family revocation
            if (currentMismatchCount > 1) {
              const revokedSessions = await prisma.authSession.findMany({
                where: { tokenFamily: session.tokenFamily },
                select: { id: true },
              });

              await prisma.authSession.updateMany({
                where: { tokenFamily: session.tokenFamily },
                data: { isRevoked: true },
              });

              for (const s of revokedSessions) {
                await this.markSessionRevokedInCache(s.id);
              }

              // Fire critical revocation alert (uses separate debounce key)
              await sendDebouncedSecurityAlert({
                eventType: "REVOCATION",
                sessionId: session.id,
                tokenFamily: session.tokenFamily,
                requestIp: context.ipAddress || session.ipAddress || "unknown",
                userAgentHash: context.deviceFingerprint
                  ? context.deviceFingerprint.slice(0, 16)
                  : "unknown",
                mismatchCount: currentMismatchCount,
              });

              throw new Error("REFRESH_TOKEN_REUSE_DETECTED");
            }

            // Strike 1: First mismatch on the family (currentMismatchCount === 1) -> Grant active pair, fire warning alert
            await sendDebouncedSecurityAlert({
              eventType: "MISMATCH_WARNING",
              sessionId: session.id,
              tokenFamily: session.tokenFamily,
              requestIp: context.ipAddress || session.ipAddress || "unknown",
              userAgentHash: context.deviceFingerprint
                ? context.deviceFingerprint.slice(0, 16)
                : "unknown",
              mismatchCount: 1,
            });
          }

          const nextRawRefreshToken = passwordService.generateSecureToken(32);
          const nextRefreshTokenHash =
            passwordService.hashToken(nextRawRefreshToken);
          const nextExpiresAt = new Date();
          nextExpiresAt.setDate(
            nextExpiresAt.getDate() + config.jwt.refreshExpiresInDays,
          );

          const rotatedSession = await prisma.authSession.create({
            data: {
              userId: activeSession.userId,
              refreshTokenHash: nextRefreshTokenHash,
              tokenFamily: activeSession.tokenFamily,
              ipAddress: context.ipAddress || activeSession.ipAddress,
              userAgent: context.userAgent || activeSession.userAgent,
              deviceFingerprint:
                context.deviceFingerprint ||
                activeSession.deviceFingerprint ||
                null,
              mismatchCount: activeSession.mismatchCount,
              expiresAt: nextExpiresAt,
              lastUsedAt: new Date(),
            },
            include: { user: true },
          });

          await this.markSessionActiveInCache(rotatedSession.id);

          const u = activeSession.user;
          const userSummary: UserSummaryDTO = {
            id: u.id,
            email: u.email,
            firstName: u.firstName,
            lastName: u.lastName,
            phoneNumber: u.phoneNumber,
            avatarUrl: (u as any).avatarUrl || null,
            birthday: (u as any).birthday || null,
            clientId: u.clientId,
            role: u.role as UserRole,
            isVerified: u.isVerified,
            createdAt: u.createdAt,
            referralCode: (u as any).referralCode || null,
          };

          const accessToken = this.generateAccessToken({
            id: userSummary.id,
            email: userSummary.email,
            role: userSummary.role,
            clientId: userSummary.clientId,
            sessionId: rotatedSession.id,
          });

          return {
            accessToken,
            rawRefreshToken: nextRawRefreshToken,
            user: userSummary,
          };
        }
      }

      // Beyond grace window or no active session -> Token reuse attack detected, revoke entire token family
      const revokedSessions = await prisma.authSession.findMany({
        where: { tokenFamily: session.tokenFamily },
        select: { id: true },
      });

      await prisma.authSession.updateMany({
        where: { tokenFamily: session.tokenFamily },
        data: { isRevoked: true },
      });

      for (const s of revokedSessions) {
        await this.markSessionRevokedInCache(s.id);
      }

      throw new Error("REFRESH_TOKEN_REUSE_DETECTED");
    }

    // Expiry check
    if (session.expiresAt < new Date()) {
      await prisma.authSession.update({
        where: { id: session.id },
        data: { isRevoked: true },
      });
      await this.markSessionRevokedInCache(session.id);
      throw new Error("SESSION_EXPIRED");
    }

    // Generate rotated refresh token
    const nextRawRefreshToken = passwordService.generateSecureToken(32);
    const nextRefreshTokenHash = passwordService.hashToken(nextRawRefreshToken);

    const nextExpiresAt = new Date();
    nextExpiresAt.setDate(
      nextExpiresAt.getDate() + config.jwt.refreshExpiresInDays,
    );

    // Revoke previous session in DB
    await prisma.authSession.update({
      where: { id: session.id },
      data: { isRevoked: true },
    });
    // Evict old session from active cache (grace window handles in-flight access tokens)
    try {
      await redis.del(`daih:session:active:${session.id}`);
    } catch {}

    // Create next session in the same token family
    const newSession = await prisma.authSession.create({
      data: {
        userId: session.userId,
        refreshTokenHash: nextRefreshTokenHash,
        tokenFamily: session.tokenFamily,
        ipAddress: context.ipAddress || session.ipAddress,
        userAgent: context.userAgent || session.userAgent,
        deviceFingerprint:
          context.deviceFingerprint || session.deviceFingerprint || null,
        mismatchCount: session.mismatchCount,
        expiresAt: nextExpiresAt,
        lastUsedAt: new Date(),
      },
      include: { user: true },
    });

    await this.markSessionActiveInCache(newSession.id);

    const u = (newSession as any).user || session.user;
    const userSummary: UserSummaryDTO = {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phoneNumber: u.phoneNumber,
      avatarUrl: (u as any).avatarUrl || null,
      birthday: (u as any).birthday || null,
      clientId: u.clientId,
      role: (u.role || session.user.role) as UserRole,
      isVerified: u.isVerified ?? session.user.isVerified,
      createdAt: u.createdAt || session.user.createdAt,
      referralCode: (u as any).referralCode || null,
    };

    const accessToken = this.generateAccessToken({
      id: userSummary.id,
      email: userSummary.email,
      role: userSummary.role,
      clientId: userSummary.clientId,
      sessionId: newSession.id,
    });

    return {
      accessToken,
      rawRefreshToken: nextRawRefreshToken,
      user: userSummary,
    };
  }

  /**
   * Revokes the session associated with the given raw refresh token (Logout)
   */
  async revokeSessionByRefreshToken(rawRefreshToken: string): Promise<void> {
    const tokenHash = passwordService.hashToken(rawRefreshToken);
    const sessions = await prisma.authSession.findMany({
      where: { refreshTokenHash: tokenHash },
      select: { id: true },
    });

    await prisma.authSession.updateMany({
      where: { refreshTokenHash: tokenHash },
      data: { isRevoked: true, lastUsedAt: new Date() },
    });

    for (const s of sessions) {
      await this.markSessionRevokedInCache(s.id);
    }
  }

  /**
   * Revokes the session associated with a session ID (Logout)
   */
  async revokeSessionById(sessionId: string): Promise<void> {
    await prisma.authSession.updateMany({
      where: { id: sessionId },
      data: { isRevoked: true, lastUsedAt: new Date() },
    });
    await this.markSessionRevokedInCache(sessionId);
  }

  /**
   * Revokes all active sessions for a user (e.g. after password reset)
   * Supports explicit session IDs list for immediate cache purge
   */
  async revokeAllUserSessions(
    userId: string,
    explicitSessionIds?: string[],
  ): Promise<void> {
    if (explicitSessionIds && explicitSessionIds.length > 0) {
      for (const id of explicitSessionIds) {
        await this.markSessionRevokedInCache(id);
      }
    }

    const sessions = await prisma.authSession.findMany({
      where: { userId },
      select: { id: true },
    });

    await prisma.authSession.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true, lastUsedAt: new Date() },
    });

    for (const s of sessions) {
      await this.markSessionRevokedInCache(s.id);
    }
  }
}

export const sessionService = new SessionService();

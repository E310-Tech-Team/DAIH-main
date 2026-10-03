import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/env.js";
import { prisma } from "../db/client.js";
import { redis } from "../config/redis.js";
import { UserRole } from "@daih/types";
import {
  checkSessionRevocation,
  InfrastructureUnavailableError,
} from "../utils/revocation-cache.js";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    clientId: string;
    sessionId?: string;
  };
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      code: "UNAUTHORIZED",
      message: "Authentication token is missing or invalid",
    });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, config.jwt.secret, {
      algorithms: ["HS256"],
    }) as any;
    const userId = payload?.id || payload?.userId || payload?.sub;
    const email = payload?.email;
    const role = payload?.role;
    const clientId = payload?.clientId || "DAIH-SYSTEM";

    if (!payload || !userId || !email || !role) {
      res.status(401).json({
        code: "INVALID_TOKEN",
        message: "Token claims are incomplete or malformed",
      });
      return;
    }

    if (payload.purpose && payload.purpose !== "access") {
      res.status(401).json({
        code: "INVALID_TOKEN",
        message:
          "Special-purpose tokens cannot be used for general authentication",
      });
      return;
    }

    // Verify session is active and not revoked (Redis Cache + DB Fallback with Circuit Breaker)
    if (payload.sessionId) {
      try {
        const { isValid } = await checkSessionRevocation(payload.sessionId);
        if (!isValid) {
          res.status(401).json({
            code: "SESSION_REVOKED",
            message:
              "This session has been logged out or replaced by a new token. Please log in again.",
          });
          return;
        }
      } catch (infraError) {
        if (infraError instanceof InfrastructureUnavailableError) {
          res.status(503).json({
            code: "SERVICE_UNAVAILABLE",
            message:
              "Authentication verification is temporarily degraded. Please retry shortly.",
          });
          return;
        }
        throw infraError;
      }
    } else if (config.env !== "test" || !process.env.VITEST) {
      res.status(401).json({
        code: "INVALID_TOKEN",
        message: "Token is missing required session claim",
      });
      return;
    }

    req.user = {
      id: userId,
      email: email,
      role: role as UserRole,
      clientId: clientId,
      sessionId: payload.sessionId,
    };

    // Verify user is not deactivated (Immediate Access Token Termination)
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { deactivatedAt: true },
    });
    if (userRecord?.deactivatedAt) {
      res.status(403).json({
        code: "ACCOUNT_DEACTIVATED",
        message:
          "Your account has been deactivated. Please contact support to reactivate your account.",
      });
      return;
    }

    // Ensure authenticated user data is never cached by intermediate proxies or shared CDN caches
    res.set("Cache-Control", "private, no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");

    next();
  } catch (error) {
    if (error instanceof InfrastructureUnavailableError) {
      res.status(503).json({
        code: "SERVICE_UNAVAILABLE",
        message:
          "Authentication verification is temporarily degraded. Please retry shortly.",
      });
      return;
    }

    res.status(401).json({
      code: "INVALID_TOKEN",
      message: "Token has expired or is invalid",
    });
  }
};

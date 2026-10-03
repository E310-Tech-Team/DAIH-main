import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import compression from "compression";
import { identityRouter } from "./modules/identity/identity.routes.js";
import { catalogueRouter } from "./modules/catalogue/catalogue.routes.js";
import { bookingRouter } from "./modules/booking/booking.routes.js";
import {
  paymentsRouter,
  paymentsWebhookRouter,
} from "./modules/payments/payments.routes.js";
import { accessRouter } from "./modules/access/access.routes.js";
import { emailTemplateRoutes } from "./modules/email/email-template.routes.js";
import { reportsRouter } from "./modules/reports/reports.routes.js";
import { debugRouter } from "./modules/debug/debug.routes.js";
import { legalRouter } from "./modules/legal/legal.routes.js";
import { discountRouter } from "./modules/discounts/discount.routes.js";
import { supportRouter } from "./modules/support/support.routes.js";
import { notificationsRouter } from "./modules/notifications/notifications.routes.js";
import { loyaltyRouter } from "./modules/loyalty/loyalty.routes.js";
import { reviewRouter } from "./modules/reviews/review.routes.js";
import { campaignRouter } from "./modules/campaigns/campaign.routes.js";
import { swaggerRouter } from "./modules/docs/swagger.routes.js";
import path from "node:path";
import fs from "node:fs";
import { errorHandler } from "./middleware/error-handler.middleware.js";
import { config, isAllowedOrigin } from "./config/env.js";

export const app = express();

// Trust verified reverse proxies (CIDRs / loopback) for accurate client IP rate limiting and fingerprinting
app.set("trust proxy", config.security.trustedProxies);

// Security & utility middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server, curl, mobile apps, and webhook callbacks with no origin
      if (!origin) return callback(null, true);

      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true,
  }),
);
app.use((req, res, next) => {
  res.header("Vary", "Origin");
  next();
});
app.use(cookieParser());

// Ensure uploads directory exists and mount static routes
const uploadLocations = [
  path.join(process.cwd(), "uploads"),
  path.join(process.cwd(), "apps", "api", "uploads"),
  path.resolve(__dirname, "..", "..", "uploads"),
  path.resolve(__dirname, "..", "uploads"),
  path.resolve(__dirname, "uploads"),
  path.resolve(__dirname, "../../../uploads"),
];

uploadLocations.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
  const resourcesDir = path.join(dir, "resources");
  if (!fs.existsSync(resourcesDir)) {
    try {
      fs.mkdirSync(resourcesDir, { recursive: true });
    } catch {}
  }
  const avatarsDir = path.join(dir, "avatars");
  if (!fs.existsSync(avatarsDir)) {
    try {
      fs.mkdirSync(avatarsDir, { recursive: true });
    } catch {}
  }
});

// Dedicated robust static file serving middleware for uploads
const serveUploadFile = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const rawPath = req.path
    .replace(/^\/api\/v1\/uploads\/?/, "")
    .replace(/^\/uploads\/?/, "")
    .replace(/^[\\\/]+/, "");
  if (!rawPath) return next();

  for (const baseDir of uploadLocations) {
    const candidateFile = path.join(baseDir, rawPath);
    if (fs.existsSync(candidateFile) && fs.statSync(candidateFile).isFile()) {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.sendFile(path.resolve(candidateFile));
    }
  }
  next();
};

app.use("/uploads", serveUploadFile);
app.use("/api/v1/uploads", serveUploadFile);

uploadLocations.forEach((dir) => {
  if (fs.existsSync(dir)) {
    app.use(
      "/uploads",
      (req, res, next) => {
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Access-Control-Allow-Origin", "*");
        next();
      },
      express.static(dir),
    );
    app.use(
      "/api/v1/uploads",
      (req, res, next) => {
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Access-Control-Allow-Origin", "*");
        next();
      },
      express.static(dir),
    );
  }
});

// Compress all responses over 1KB (gzip/deflate) — reduces large JSON payloads 5-10x
app.use(compression({ threshold: 1024 }));

// Mount webhook router BEFORE express.json() to preserve raw request body for HMAC verification
app.use("/api/v1/payments", paymentsWebhookRouter);

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use(morgan("dev"));

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "DAIH Modular API",
  });
});

// Modular Routes mount
app.use("/api/v1/identity", identityRouter);
app.use("/api/v1/catalogue", catalogueRouter);
app.use("/api/v1/bookings", bookingRouter);
app.use("/api/v1/payments", paymentsRouter);
app.use("/api/v1/discounts", discountRouter);
app.use("/api/v1/access", accessRouter);
app.use("/api/v1/email-templates", emailTemplateRoutes);
app.use("/api/v1/policies", legalRouter);
app.use("/api/v1/support", supportRouter);
app.use("/api/v1/notifications", notificationsRouter);
app.use("/api/v1/loyalty", loyaltyRouter);
app.use("/api/v1/reviews", reviewRouter);
app.use("/api/v1/campaigns", campaignRouter);
app.use("/api/v1/reports", reportsRouter);
app.use("/api/v1/debug", debugRouter);

// Interactive Swagger OpenAPI Documentation
app.use("/api-docs", swaggerRouter);
app.use("/api/v1/docs", swaggerRouter);

// Centralized error handler
app.use(errorHandler);

/**
 * PM2 process definitions for the DAIH production VPS.
 *
 * Every process runs a COMPILED artifact — never `tsx watch`, which keeps a
 * TypeScript compiler resident and restarts on any file touch.
 *
 * Usage on the server:
 *   pm2 start ecosystem.config.cjs      # first boot
 *   pm2 reload ecosystem.config.cjs     # graceful redeploy, no dropped requests
 *   pm2 save                            # persist across reboots
 */

const path = require("node:path");
const ROOT = __dirname;

/** Next.js apps all start the same way; only name, directory and port differ. */
const nextApp = (name, dir, port) => ({
  name,
  cwd: path.join(ROOT, "apps", dir),
  script: "node_modules/next/dist/bin/next",
  args: "start",
  interpreter: "node",
  env: { NODE_ENV: "production", PORT: String(port) },
  exec_mode: "fork",
  instances: 1,
  autorestart: true,
  max_restarts: 10,
  min_uptime: "20s",
  max_memory_restart: "600M",
  kill_timeout: 10000,
  wait_ready: false,
  listen_timeout: 30000,
  merge_logs: true,
  time: true,
});

module.exports = {
  apps: [
    {
      name: "daih-api",
      cwd: path.join(ROOT, "apps", "api"),
      script: "dist/server.js",
      env: { NODE_ENV: "production", PORT: "4000" },
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "20s",
      max_memory_restart: "800M",
      kill_timeout: 10000,
      merge_logs: true,
      time: true,
    },
    {
      // BullMQ consumer: hold expiry, retention sweeps, notification dispatch.
      // Single instance on purpose — the jobs are not partitioned, so a second
      // worker would process the same queue entries.
      name: "daih-worker",
      cwd: path.join(ROOT, "apps", "api"),
      script: "dist/jobs/worker.js",
      env: { NODE_ENV: "production" },
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "20s",
      max_memory_restart: "600M",
      kill_timeout: 20000, // let an in-flight job finish before SIGKILL
      merge_logs: true,
      time: true,
    },
    nextApp("daih-web", "web", 3000),
    nextApp("daih-pwa", "customer-pwa", 3001),
    nextApp("daih-kiosk", "reception-app", 3002),
    nextApp("daih-admin", "admin-portal", 3003),
  ],
};

# Complete Step-by-Step Guide: Hosting DAIH on Hostinger KVM VPS

**Target Architecture:** Multi-App Monorepo on a single Hostinger KVM Linux VPS  
**Domain Scope:** `*.daih.ng` / `.daih.ng` (Shared Parent Domain Cookie Scope)  
**Infrastructure Stack:** Ubuntu 24.04 LTS, Docker, PostgreSQL 16, Redis 7, MinIO, Node.js 20, pnpm 10, Nginx / Caddy Reverse Proxy

---

## Architecture Overview

```
                                  [ INTERNET ]
                                        │
                         [ Cloudflare DNS & Lagos Edge ]
                          (Proxied SSL / DDoS Shield)
                                        │
                                        ▼
                           Hostinger KVM VPS (France)
                    ┌───────────────────────────────────────┐
                    │    Reverse Proxy (Nginx / Caddy)      │
                    │        Ports 80 & 443 (HTTPS)         │
                    └───────────────────┬───────────────────┘
                                        │
        ┌───────────────┬───────────────┼───────────────┬───────────────┐
        ▼               ▼               ▼               ▼               ▼
     daih.ng      admin.daih.ng    app.daih.ng    kiosk.daih.ng    api.daih.ng
   (apps/web)    (admin-portal)  (customer-pwa)  (reception-app)   (apps/api)
    Port 3000       Port 3003       Port 3001       Port 3002       Port 4000
        │               │               │               │               ▲
        └───────────────┴───────┬───────┴───────────────┘               │
                                │                                       │
                     Next.js Same-Origin Proxy                          │
               (/api/v1/* -> http://127.0.0.1:4000) ────────────────────┘
                                                                        │
                                                     ┌──────────────────┴───────────────┐
                                                     ▼                                  ▼
                                            [ daih-postgres ]                   [ daih-redis ]
                                             (PostgreSQL 16)                       (Redis 7)
                                                Port 5432                          Port 6379
                                                     ▲                                  ▲
                                                     └──────────────────┬───────────────┘
                                                                        │
                                                             [ BullMQ Worker Daemon ]
                                                                (Background Jobs)
```

---

## Phase 1: Purchase & Provision Hostinger VPS

### Step 1.1: Select the Correct Plan

1. Go to [Hostinger VPS Hosting](https://www.hostinger.com/vps-hosting).
2. Select **KVM 2** (Minimum: 2 vCPU, 8 GB RAM, 100 GB NVMe) or **KVM 4** (Recommended: 4 vCPU, 16 GB RAM, 200 GB NVMe).
   > [!IMPORTANT]
   > Do **NOT** purchase Shared Web Hosting or Cloud Startup (hPanel). You must choose **KVM VPS**.

### Step 1.2: Server Setup Options

- **Server Location**: Select **France** (closest subsea fiber cable route to Lagos, Nigeria with ~80ms-100ms latency).
- **Operating System**:
  - **Option A (Recommended)**: Choose **Application / Panel** → **Ubuntu 24.04 with Coolify**.
  - **Option B**: Choose **Plain OS** → **Ubuntu 24.04 LTS 64-bit**.
- **Root Password**: Create a strong 24+ character password and save it securely.
- **SSH Keys (Optional but Recommended)**: Paste your public SSH key (`id_ed25519.pub`) to enable passwordless login.

---

## Phase 2: Domain & DNS Setup (Cloudflare)

To achieve **<10ms response times** for static assets in Nigeria, route your domain through Cloudflare:

1. In Cloudflare DNS (or your domain registrar), create the following `A` records pointing to your **Hostinger VPS Public IP**:

| Type | Name                      | Content (IPv4 Address) | Proxy Status           |
| :--- | :------------------------ | :--------------------- | :--------------------- |
| `A`  | `@` (`daih.ng`)           | `YOUR_VPS_PUBLIC_IP`   | Proxied (Orange Cloud) |
| `A`  | `www`                     | `YOUR_VPS_PUBLIC_IP`   | Proxied (Orange Cloud) |
| `A`  | `api` (`api.daih.ng`)     | `YOUR_VPS_PUBLIC_IP`   | Proxied (Orange Cloud) |
| `A`  | `admin` (`admin.daih.ng`) | `YOUR_VPS_PUBLIC_IP`   | Proxied (Orange Cloud) |
| `A`  | `app` (`app.daih.ng`)     | `YOUR_VPS_PUBLIC_IP`   | Proxied (Orange Cloud) |
| `A`  | `kiosk` (`kiosk.daih.ng`) | `YOUR_VPS_PUBLIC_IP`   | Proxied (Orange Cloud) |

2. In Cloudflare, set **SSL/TLS encryption mode** to **Full (strict)**.

---

## Phase 3: Initial Server Hardening & Swap

Connect to your VPS via SSH terminal:

```bash
ssh root@YOUR_VPS_PUBLIC_IP
```

### Step 3.1: Update System & Install Essentials

```bash
apt update && apt upgrade -y
apt install -y curl git ufw fail2ban htop unzip build-essential nginx certbot python3-certbot-nginx
```

### Step 3.2: Create a 4 GB Swap File (Critical for Next.js Builds)

Swap prevents Next.js compilation from running out of RAM during `pnpm build`:

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Optimize swappiness for database performance
sysctl vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.conf
```

### Step 3.3: Configure Firewall (UFW)

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 8000/tcp  # Coolify Dashboard (if using Coolify)
ufw enable -y
```

---

## Phase 4: Deploying with Coolify (Web UI Option)

If you chose the **Ubuntu with Coolify** template, access your dashboard at:

```text
http://YOUR_VPS_PUBLIC_IP:8000
```

### Step 4.1: Deploy PostgreSQL 16 & Redis 7

1. In Coolify, click **Projects** → **Default** → **Production** → **+ New Resource**.
2. Select **Databases** → **PostgreSQL**:
   - Name: `daih-postgres`
   - Version: `16`
   - Database Name: `daih_db`
   - User: `postgres`
   - Password: `[GENERATE_SECURE_PASSWORD]`
   - Click **Deploy**. Note the internal connection string:
     `postgresql://postgres:PASSWORD@daih-postgres:5432/daih_db`
3. Click **+ New Resource** → **Databases** → **Redis**:
   - Name: `daih-redis`
   - Version: `7`
   - Click **Deploy**. Internal URL: `redis://daih-redis:6379`

### Step 4.2: Connect Your GitHub Repository

1. In Coolify, go to **Keys & Tokens** → **Git Sources** → Add your GitHub App or Personal Access Token.
2. Grant read access to the `DAIH-main` repository.

### Step 4.3: Deploy `apps/api` (Core Backend)

1. In Coolify, click **+ New Resource** → **Application** → Select your GitHub repo.
2. Configure settings:
   - **Base Directory**: `apps/api`
   - **Build Pack**: Nixpacks or Dockerfile
   - **Install Command**: `pnpm install`
   - **Build Command**: `pnpm build`
   - **Start Command**: `node dist/server.js`
   - **Port**: `4000`
   - **Domains**: `https://api.daih.ng`
3. Add Environment Variables (see Phase 6).
4. Click **Deploy**.

### Step 4.4: Deploy the Background Worker (`BullMQ`)

1. Click **+ New Resource** → **Application** → Select same repo.
2. Configure settings:
   - **Name**: `daih-worker`
   - **Base Directory**: `apps/api`
   - **Start Command**: `node dist/jobs/worker.js` (or `tsx src/jobs/worker.ts`)
   - **Port**: None (Internal background worker)
3. Share the same environment variables as `apps/api`.
4. Click **Deploy**.

### Step 4.5: Deploy the 4 Next.js Frontends

For each frontend application, add a new Application from the repository:

| App Name           | Base Directory       | Start Port | Domain                                   |
| :----------------- | :------------------- | :--------- | :--------------------------------------- |
| **daih-web**       | `apps/web`           | `3000`     | `https://daih.ng`, `https://www.daih.ng` |
| **daih-admin**     | `apps/admin-portal`  | `3003`     | `https://admin.daih.ng`                  |
| **daih-customer**  | `apps/customer-pwa`  | `3001`     | `https://app.daih.ng`                    |
| **daih-reception** | `apps/reception-app` | `3002`     | `https://kiosk.daih.ng`                  |

- Build Command for each: `pnpm build`
- Start Command: `pnpm start -- -p $PORT`
- Environment Variables:
  - `INTERNAL_API_URL="http://daih-api:4000"` (Coolify internal network)
  - `NEXT_PUBLIC_API_URL="/api/v1"`

---

## Phase 5: Manual CLI Deployment with Docker Compose & Nginx (Production Best Practice)

If you are running directly on Ubuntu 24.04 without a control panel:

### Step 5.1: Install Node.js, pnpm, and Docker

```bash
# Install Docker & Compose
curl -fsSL https://get.docker.com | sh
usermod -aG docker root

# Install Node 20 & pnpm 10
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pnpm@10.23.0 pm2
```

### Step 5.2: Clone Repository & Run Databases

```bash
cd /var/www
git clone <YOUR_GIT_REPO_URL> daih
cd /var/www/daih

# Start Postgres 16 and Redis 7
cd infra/docker
docker compose up -d
```

### Step 5.3: Run Database Migrations & Super Admin Seed

> [!IMPORTANT]
> Always deploy migrations using `prisma:migrate:deploy`. Destructive schema synchronization (`prisma db push`) is strictly prohibited in staging and production environments to preserve transactional financial data, prevent table or column drops, and enforce migration history integrity.

```bash
cd /var/www/daih
pnpm install

# Apply versioned Prisma migrations deterministically
pnpm --filter @daih/api prisma:migrate:deploy

# Seed initial Super Admin
cd apps/api
npx tsx src/scripts/seed-super-admin.ts
```

### Step 5.4: Build Monorepo & Start PM2

```bash
cd /var/www/daih
pnpm build

# Start API & Worker
cd apps/api
pm2 start dist/server.js --name "daih-api"
pm2 start "npx tsx src/jobs/worker.ts" --name "daih-worker"

# Start Frontends
cd ../web && pm2 start "pnpm start -- -p 3000" --name "daih-web"
cd ../customer-pwa && pm2 start "pnpm start -- -p 3001" --name "daih-pwa"
cd ../reception-app && pm2 start "pnpm start -- -p 3002" --name "daih-kiosk"
cd ../admin-portal && pm2 start "pnpm start -- -p 3003" --name "daih-admin"

# Save PM2 process list to persist across reboots
pm2 save
pm2 startup
```

### Step 5.5: Configure Nginx (Reverse Proxy & SSL)

Create `/etc/nginx/sites-available/daih.conf`:

```nginx
# Map shared proxy headers
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Verified-Client-IP $remote_addr;
proxy_set_header X-Origin-Verify-Secret "your-production-origin-verify-secret";

# 1. Marketing Website (Port 3000)
server {
    server_name daih.ng www.daih.ng;
    client_max_body_size 15M;

    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}

# 2. Customer Mobile PWA (Port 3001)
server {
    server_name app.daih.ng;
    client_max_body_size 15M;

    location / {
        proxy_pass http://127.0.0.1:3001;
    }
}

# 3. Reception & Gate Kiosk (Port 3002)
server {
    server_name kiosk.daih.ng;
    client_max_body_size 15M;

    location / {
        proxy_pass http://127.0.0.1:3002;
    }
}

# 4. Admin & Staff Operations Portal (Port 3003)
server {
    server_name admin.daih.ng;
    client_max_body_size 15M;

    location / {
        proxy_pass http://127.0.0.1:3003;
    }
}

# 5. Core Backend API (Port 4000)
server {
    server_name api.daih.ng;
    client_max_body_size 15M;

    location / {
        proxy_pass http://127.0.0.1:4000;
    }
}
```

Enable the configuration and obtain Let's Encrypt SSL certificates:

```bash
ln -s /etc/nginx/sites-available/daih.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Issue automated SSL certificates for all domains
certbot --nginx -d daih.ng -d www.daih.ng -d app.daih.ng -d admin.daih.ng -d kiosk.daih.ng -d api.daih.ng
```

---

## Phase 6: Production Environment Variables Reference

### Backend API (`/var/www/daih/apps/api/.env`)

```ini
NODE_ENV=production
PORT=4000

# ─── Database & Redis ────────────────────────────────────────────────────────
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/daih_db?schema=public"
REDIS_URL="redis://127.0.0.1:6379"

# ─── Cryptographic Secrets (Min 32 characters, completely independent) ───────
JWT_SECRET="openssl-generated-32-char-secret-jwt"
JWT_REFRESH_SECRET="openssl-generated-32-char-secret-refresh"
TOKEN_ENCRYPTION_KEY="openssl-generated-32-char-secret-encryption"
QR_SIGNING_SECRET="openssl-generated-32-char-secret-qr"

# ─── Refresh Cookie Scoping (First-Party Wildcard SSO) ───────────────────────
COOKIE_DOMAIN=".daih.ng"
COOKIE_PATH="/api/v1/identity"
COOKIE_SAME_SITE="lax"
COOKIE_SECURE="true"

# ─── Reverse Proxy IP Trust & Origin Security ────────────────────────────────
TRUSTED_PROXIES="loopback,linklocal,uniquelocal"
ORIGIN_VERIFY_SECRET="your-production-origin-verify-secret"
ENABLE_DIAGNOSTIC_IP_ENDPOINT="false"

# ─── Super Admin Seeding ─────────────────────────────────────────────────────
SUPER_ADMIN_EMAIL="admin@daih.ng"
SUPER_ADMIN_PASSWORD="StrongSuperAdminPassword2026!"
SUPER_ADMIN_FIRST_NAME="Super"
SUPER_ADMIN_LAST_NAME="Administrator"
SUPER_ADMIN_PHONE="07042504389"

# ─── Transactional Email ─────────────────────────────────────────────────────
EMAIL_PROVIDER="auto"
RESEND_API_KEY="re_your_live_key"
RESEND_FROM_EMAIL="DAIH Hub <noreply@daih.ng>"

# ─── CORS & Allowed Origins ──────────────────────────────────────────────────
FRONTEND_CUSTOMER_URL="https://app.daih.ng"
FRONTEND_ADMIN_URL="https://admin.daih.ng"
FRONTEND_WEB_URL="https://daih.ng"
ALLOWED_ORIGINS="https://daih.ng,https://app.daih.ng,https://admin.daih.ng,https://kiosk.daih.ng"

# ─── Payments (Paystack) ─────────────────────────────────────────────────────
PAYSTACK_SECRET_KEY="sk_live_xxx"
PAYSTACK_PUBLIC_KEY="pk_live_xxx"
# Webhooks are verified with PAYSTACK_SECRET_KEY (Paystack signs them with it).
```

### Frontend Applications (`.env` for `admin-portal`, `customer-pwa`, `reception-app`, `web`)

```ini
# Internal loopback target for Next.js same-origin rewrites (/api/v1/* -> :4000)
INTERNAL_API_URL="http://127.0.0.1:4000"

# Relative same-origin path for client-side fetches (browser)
NEXT_PUBLIC_API_URL="/api/v1"

# Cross-Portal URLs
NEXT_PUBLIC_WEB_URL="https://daih.ng"
NEXT_PUBLIC_CUSTOMER_PWA_URL="https://app.daih.ng"
NEXT_PUBLIC_CUSTOMER_PORTAL_URL="https://app.daih.ng"
NEXT_PUBLIC_ADMIN_URL="https://admin.daih.ng"
NEXT_PUBLIC_RECEPTION_URL="https://kiosk.daih.ng"
```

---

## Phase 7: Verification & Health Checks

Once deployed, run these checks to verify every layer:

1. **Check API Health & Database Connection:**

   ```bash
   curl -I https://api.daih.ng/health
   # Expected: HTTP/2 200 OK
   ```

2. **Verify Single Set-Cookie & First-Party Storage:**
   - Open `https://admin.daih.ng/login`.
   - Sign in with Super Admin credentials.
   - Inspect Network response headers for `POST /api/v1/identity/login`.
   - **Verification**: Exactly **one** `Set-Cookie` header present:
     ```http
     Set-Cookie: daih_refresh_token=...; Path=/api/v1/identity; Domain=.daih.ng; HttpOnly; Secure; SameSite=Lax
     ```
   - Press **F5 (Reload)**: Page restores authenticated state silently without bouncing to `/login`.

3. **Check Client IP Resolution (Optional Debug Check):**
   - Temporarily set `ENABLE_DIAGNOSTIC_IP_ENDPOINT="true"` in `apps/api/.env` and reload.
   - Authenticate as Super Admin and call:
     ```bash
     curl -H "Authorization: Bearer <ADMIN_TOKEN>" https://admin.daih.ng/api/v1/identity/admin/debug-client-ip
     ```
   - Confirm `clientIp` matches your public ISP IP and not `127.0.0.1`.
   - Set `ENABLE_DIAGNOSTIC_IP_ENDPOINT="false"` and reload.

---

## Phase 8: Automated Daily Database Backups

Create `/usr/local/bin/backup-daih-db.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/daih-postgres"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
mkdir -p "$BACKUP_DIR"

# Dump database from local Docker container
docker exec $(docker ps -qf "name=postgres") pg_dump -U postgres daih_db | gzip > "$BACKUP_DIR/daih_backup_$TIMESTAMP.sql.gz"

# Retain last 7 days of daily backups
find "$BACKUP_DIR" -type f -name "*.sql.gz" -mtime +7 -delete
```

Make executable and register with cron:

```bash
chmod +x /usr/local/bin/backup-daih-db.sh
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/backup-daih-db.sh") | crontab -
```

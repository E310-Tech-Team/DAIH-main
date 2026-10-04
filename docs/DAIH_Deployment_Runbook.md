# DAIH — First Deployment Runbook

**Target:** Hostinger KVM VPS · Nginx + PM2 · Docker Postgres/Redis · Cloudflare DNS
**Situation:** first ever deployment — no server, no database, no live data
**Last updated:** 2026-09-26 (verified against `bc981ec`)

> Companion to [HOSTINGER_VPS_DEPLOYMENT_GUIDE.md](HOSTINGER_VPS_DEPLOYMENT_GUIDE.md), which has the full Nginx and Coolify detail. This runbook is the ordered checklist with the verification steps that guide omits.

---

## 0. Pre-flight — what you must have before starting

None of these can be done from a development machine. Gather them first; a half-provisioned deploy is worse than none.

| #   | Item                   | Notes                                                                          |
| --- | ---------------------- | ------------------------------------------------------------------------------ |
| 1   | **Hostinger KVM VPS**  | KVM 2 minimum (2 vCPU / 8 GB). Next.js builds four apps; 4 GB will swap-thrash |
| 2   | **Root SSH access**    | IP address, root password or key                                               |
| 3   | **Domain `daih.ng`**   | Registered, and nameservers pointed at Cloudflare                              |
| 4   | **Cloudflare account** | Zone added for `daih.ng`                                                       |
| 5   | **Paystack live keys** | `sk_live_…`, `pk_live_…`, and the webhook secret from the Paystack dashboard   |
| 6   | **Resend account**     | API key, plus `daih.ng` verified as a sending domain (SPF/DKIM records)        |
| 7   | **Sentry DSN**         | Optional but recommended before taking real bookings                           |

**Do not proceed past Phase 3 without items 5 and 6.** The app starts without them, but payments fail and no verification emails send — customers can register and then be stuck.

---

## Phase 1 — DNS (do this first; propagation takes time)

In Cloudflare, add six `A` records pointing at your VPS IP, all **Proxied**:

| Record | Host    | Serves                     |
| ------ | ------- | -------------------------- |
| A      | `@`     | Marketing site (port 3000) |
| A      | `www`   | Marketing site             |
| A      | `app`   | Customer PWA (port 3001)   |
| A      | `kiosk` | Reception app (port 3002)  |
| A      | `admin` | Admin portal (port 3003)   |
| A      | `api`   | Backend API (port 4000)    |

Set SSL/TLS mode to **Full (strict)**.

> The hostname is `kiosk.daih.ng`, not `reception.daih.ng`. The guide previously referenced both; only `kiosk` has DNS and a certificate.

**Verify:** `dig +short app.daih.ng` returns a Cloudflare IP.

---

## Phase 2 — Server hardening

```bash
ssh root@YOUR_VPS_IP

apt update && apt upgrade -y
apt install -y curl git ufw nginx

# 4 GB swap — required, the Next.js builds will OOM without it
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.conf

ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
```

**Verify:** `free -h` shows 4 GB swap · `ufw status` shows 22, 80, 443 open.

---

## Phase 3 — Runtime and databases

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Node 20 + pnpm 10
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
corepack enable && corepack prepare pnpm@10.23.0 --activate

# Clone
mkdir -p /var/www && cd /var/www
git clone https://github.com/E310-Tech-Team/DAIH-main.git daih
cd daih

# Start Postgres + Redis
docker compose -f infra/docker/docker-compose.yml up -d postgres redis
```

> **Change the Postgres password before this runs.** `infra/docker/docker-compose.yml` ships `POSTGRES_PASSWORD: postgrespassword`. Edit it to a generated value and use the same value in `DATABASE_URL`.

> **MinIO is omitted deliberately.** The `minio/minio:latest` image failed to pull during verification (`pull access denied`). Uploads are served by the API from local disk, so MinIO is not required to go live. If you want object storage later, pin a specific MinIO tag and run `docker login` first.

**Verify:** `docker ps` shows `daih-postgres` and `daih-redis` as `Up`.

---

## Phase 4 — Environment file

```bash
cd /var/www/daih
cp .env.example .env

# Generate the five secrets — never reuse one for two purposes
for k in JWT_SECRET JWT_REFRESH_SECRET TOKEN_ENCRYPTION_KEY QR_SIGNING_SECRET ORIGIN_VERIFY_SECRET; do
  echo "$k=\"$(openssl rand -hex 32)\""
done
```

Paste those five into `.env`, then set by hand:

| Variable                                            | Value                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                          | `production`                                                                                                 |
| `DATABASE_URL`                                      | with your new Postgres password                                                                              |
| `COOKIE_DOMAIN`                                     | `.daih.ng`                                                                                                   |
| `COOKIE_SECURE`                                     | `true`                                                                                                       |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`        | your real first admin — change the password after first login                                                |
| `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY`       | live values (webhooks are verified with the secret key; payments stay disabled until it is real)             |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL`              | live values                                                                                                  |
| `EMAIL_PROVIDER`                                    | `resend`                                                                                                     |
| `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | from Google Cloud Console → Credentials → OAuth 2.0 Client IDs. No client secret — this is the ID-token flow |
| `SENTRY_DSN`                                        | if using Sentry                                                                                              |

**Verify:** `grep -c "replace-with\|xxx\|YOUR_" .env` returns **0**. Any remaining placeholder is a bug waiting to surface in production.

---

## Phase 5 — Install, migrate, seed

```bash
cd /var/www/daih
pnpm install --frozen-lockfile

# Applies the 7-migration chain; builds all 39 tables on an empty database
pnpm --filter @daih/api run prisma:migrate:deploy

# Seed, in this order
pnpm --filter @daih/api run seed:templates   # 12 email templates
pnpm --filter @daih/api run seed:loyalty     # approved PeeDee configuration
pnpm --filter @daih/api run seed:admin       # first Super Administrator
```

**Verify:** the admin seed prints a Client ID in the form `DAIH-2026-000001`, and the loyalty seed prints `earn 1 PD per NGN 200 (0.5%)`.

> **About `seed:loyalty`.** The API creates a `loyalty_settings` row on first
> use. Both that code path and the column defaults now carry the approved
> configuration, so a fresh environment is correct even if this seed never runs
> — verified by wiping the database, migrating, and letting the app create the
> row unaided.
>
> The seed remains the explicit, documented write, and the repair tool for any
> environment that already holds a wrong row (a database created before
> `20260926120000_align_loyalty_defaults_with_approved_config`). It will not
> overwrite an existing row unless passed `-- --force`. On a **live** system,
> change settings through Finance → Loyalty in the admin portal instead, so the
> change is audit-logged against a named person.

> Use `prisma:migrate:deploy`, never `db push`. The chain starts at
> `20260901000000_init` and runs through six further migrations covering auth
> identity, the PeeDee ledger, refunds, campaigns and loyalty settings. Verified
> on an empty database: 39 tables, 23 enums, zero drift against `schema.prisma`.

---

## Phase 6 — Build and run

```bash
cd /var/www/daih
pnpm build            # ~1-3 minutes on a 2 vCPU box
npm install -g pm2

pm2 start ecosystem.config.cjs
pm2 save && pm2 startup   # run the command pm2 startup prints
```

`ecosystem.config.cjs` defines all six processes declaratively, so the same
file drives the first boot, every later redeploy (`pm2 reload`) and recovery
after a reboot. Every process runs a compiled artifact — `dist/server.js`,
`dist/jobs/worker.js`, and Next's own binary — never `tsx watch`, which keeps
a TypeScript compiler resident and restarts on any file touch.

**Verify:** `pm2 list` shows six processes `online`, and
`curl -s localhost:4000/api/v1/catalogue/resources` returns JSON rather than a
connection error.

---

## Phase 7 — Nginx and TLS

Use the server blocks from Phase 5.5 of the [deployment guide](HOSTINGER_VPS_DEPLOYMENT_GUIDE.md), then:

```bash
nginx -t && systemctl reload nginx
apt install -y certbot python3-certbot-nginx
certbot --nginx -d daih.ng -d www.daih.ng -d app.daih.ng -d admin.daih.ng -d kiosk.daih.ng -d api.daih.ng
```

**Verify:** each of the six hostnames loads over HTTPS with a valid certificate.

---

## Phase 8 — Paystack webhook

In the Paystack dashboard, set the webhook URL to:

```
https://api.daih.ng/api/v1/payments/webhook
```

**Verify:** send a test event from Paystack and confirm a 200 in `pm2 logs daih-api`.

> The webhook route is mounted **before** the JSON body parser so the raw body is available for HMAC verification. If you ever reorder middleware in `apps/api/src/app.ts`, signature checks fail silently — the request still parses, it just never verifies.

---

## Phase 8.5 — Automatic deploys on merge

Once the first deploy is verified, every merge to `master` can redeploy itself:
CI runs lint, typecheck, tests and build, and only on success does it SSH in and
run `scripts/deploy.sh`.

### On the server — create a deploy key

```bash
# As the user the deploy will run as (root, or a dedicated `deploy` user)
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "github-actions-daih"
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

cat ~/.ssh/github_deploy      # the PRIVATE key — copy this into GitHub
```

The server also needs read access to the repository. Use a **repository deploy
key** rather than a personal token, so revoking the server never disturbs anyone's
own account:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/repo_readonly -N "" -C "daih-vps"
cat ~/.ssh/repo_readonly.pub  # add under Repo -> Settings -> Deploy keys (read-only)

cd /var/www/daih
git remote set-url origin git@github.com:E310-Tech-Team/DAIH-main.git
```

### On GitHub — add the secrets

Settings → Secrets and variables → Actions:

| Secret        | Value                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| `VPS_HOST`    | your VPS IP or hostname                                                   |
| `VPS_USER`    | the SSH user the deploy runs as                                           |
| `VPS_SSH_KEY` | the **private** key printed above, whole file including header and footer |
| `VPS_PORT`    | optional, defaults to `22`                                                |
| `VPS_APP_DIR` | optional, defaults to `/var/www/daih`                                     |

### Optional but recommended — require approval

Settings → Environments → **production** → add yourself under _Required
reviewers_. Deploys then pause for a click instead of shipping on merge. Worth
having while the programme is new.

### What a deploy does

1. Dumps the database to `/var/backups/daih/` (keeps the last 20)
2. `git reset --hard` to the merged commit
3. `pnpm install --frozen-lockfile`
4. `prisma migrate deploy`
5. Idempotent seeds: email templates, loyalty settings
6. `pnpm build`
7. `pm2 reload ecosystem.config.cjs` — graceful, no dropped requests
8. Health-checks the API and all four frontends
9. **Rolls the code back automatically** if the health check fails

### The limit you must understand

**Rollback reverts code, not the database.** Migrations are forward-only. If a
migration applies and the release is then rolled back, the schema is left ahead
of the code. The script prints the path of the dump it took; restoring it is a
deliberate, manual decision:

```bash
gunzip -c /var/backups/daih/daih-<timestamp>-<sha>.sql.gz \
  | docker exec -i daih-postgres psql -U postgres -d daih_db
```

Because of this, treat any PR containing a migration as a manual deploy: merge it
when you can watch, not on a Friday evening.

---

## Phase 9 — Smoke test before announcing

Run these against the live site, in order. Each depends on the previous.

| #   | Test                                        | Confirms                              |
| --- | ------------------------------------------- | ------------------------------------- |
| 1   | Register a real customer account            | Database writes, Client ID allocation |
| 2   | Receive the verification email              | Resend, DNS records, templates        |
| 3   | Log in, reach the dashboard                 | JWT, refresh cookie, cookie domain    |
| 4   | Book a resource, pay with a real card       | Paystack live, webhook, invoice       |
| 5   | Open the QR screen                          | QR signing secret                     |
| 6   | Scan it in the kiosk app, check in          | Access module, visit session          |
| 7   | Log into the admin portal, find the booking | RBAC, admin queries                   |
| 8   | Issue a refund from Finance                 | Refund path, audit log                |

Do **1 through 4 with a real card and a small amount** before opening to customers. A live Paystack key that is misconfigured fails only at the moment a customer tries to pay.

---

## Rollback

Automated deploys roll the code back on their own when the health check fails.
To roll back by hand:

```bash
cd /var/www/daih
git reset --hard <previous-good-commit>
pnpm install --frozen-lockfile && pnpm build
pm2 reload ecosystem.config.cjs --update-env
```

The database is untouched by a code rollback. If a **migration** must be undone, restore from a dump — take one before every future deploy:

```bash
docker exec daih-postgres pg_dump -U postgres daih_db > ~/daih-$(date +%F-%H%M).sql
```

---

## Known state at time of writing

Verified against commit `bc981ec` on 2026-09-26.

| Check                                  | Result                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------- |
| Install (frozen lockfile)              | ✅                                                                         |
| Typecheck                              | ✅ 9/9 workspaces                                                          |
| Monorepo build                         | ✅ 6/6 tasks                                                               |
| Tests                                  | ✅ 321 passed, 0 failed, 10 skipped                                        |
| Migration chain on empty DB            | ✅ 8/8 applied · 39 tables · 23 enums · zero drift                         |
| Seeds                                  | ✅ 12 templates · approved loyalty config · Super Admin `DAIH-2026-000001` |
| Fresh env self-configures without seed | ✅ 0.5% earn · 20/50/30 bonuses · referrals on · legacy flat pinned to 0   |
| MinIO container                        | ❌ image pull denied — excluded, not required                              |

**Not verifiable from a development machine:** live Paystack payments, real email
delivery through Resend, Google OAuth callbacks, and TLS. All four are covered by
the Phase 9 smoke test.

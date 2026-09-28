#!/usr/bin/env bash
#
# Server-side deploy for the DAIH VPS. Invoked by .github/workflows/ci.yml
# over SSH after the validate job passes, or run by hand:
#
#   /var/www/daih/scripts/deploy.sh [git-sha]
#
# Idempotent. Takes a database dump first, health-checks afterwards, and rolls
# the CODE back automatically if the health check fails.
#
# IT DOES NOT ROLL BACK THE DATABASE. Migrations are forward-only: if a
# migration lands and the release is then rolled back, the schema stays ahead
# of the code. Restore the dump printed below if that happens.

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/var/www/daih}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/daih}"
PG_CONTAINER="${PG_CONTAINER:-daih-postgres}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-daih_db}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/api/v1/catalogue/resources}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_DELAY="${HEALTH_DELAY:-3}"
TARGET_REF="${1:-origin/master}"

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m!!\033[0m %s\n' "$*" >&2; }

cd "$APP_DIR"

# ── Preconditions ────────────────────────────────────────────────────────────
command -v pnpm >/dev/null || { fail "pnpm not on PATH"; exit 1; }
command -v pm2  >/dev/null || { fail "pm2 not on PATH"; exit 1; }
[ -f .env ] || { fail ".env missing in $APP_DIR — refusing to deploy"; exit 1; }

PREVIOUS_SHA="$(git rev-parse HEAD)"
log "Current release: ${PREVIOUS_SHA:0:8}"

# ── Database dump ────────────────────────────────────────────────────────────
# Taken before migrations, which is the only irreversible step in this script.
mkdir -p "$BACKUP_DIR"
DUMP="$BACKUP_DIR/daih-$(date +%Y%m%d-%H%M%S)-${PREVIOUS_SHA:0:8}.sql"
if docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  log "Dumping database to $DUMP"
  docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" > "$DUMP"
  gzip -f "$DUMP" && DUMP="$DUMP.gz"
  # Keep the last 20 dumps.
  ls -1t "$BACKUP_DIR"/daih-*.sql.gz 2>/dev/null | tail -n +21 | xargs -r rm -f
else
  fail "Postgres container '$PG_CONTAINER' not running — refusing to deploy"
  exit 1
fi

# ── Fetch target ─────────────────────────────────────────────────────────────
log "Fetching $TARGET_REF"
git fetch --prune origin
git reset --hard "$TARGET_REF"
git clean -fd -e .env -e node_modules
TARGET_SHA="$(git rev-parse HEAD)"
log "Deploying ${TARGET_SHA:0:8}"

if [ "$TARGET_SHA" = "$PREVIOUS_SHA" ]; then
  log "Already at target commit — nothing to do."
  exit 0
fi

# ── Build ────────────────────────────────────────────────────────────────────
rollback() {
  fail "Deploy failed — rolling code back to ${PREVIOUS_SHA:0:8}"
  git reset --hard "$PREVIOUS_SHA"
  pnpm install --frozen-lockfile || true
  pnpm build || true
  pm2 reload ecosystem.config.cjs --update-env || pm2 restart all || true
  fail "Rolled back. NOTE: database migrations were NOT reverted."
  fail "If the schema is now ahead of the code, restore: $DUMP"
  exit 1
}
trap rollback ERR

log "Installing dependencies"
pnpm install --frozen-lockfile

log "Applying database migrations"
pnpm --filter @daih/api run prisma:migrate:deploy

log "Seeding idempotent reference data"
pnpm --filter @daih/api run seed:templates
# Creates the loyalty settings row only if absent; never overwrites live tuning.
pnpm --filter @daih/api run seed:loyalty

log "Building workspace"
pnpm build

# ── Release ──────────────────────────────────────────────────────────────────
log "Reloading PM2 processes"
if pm2 describe daih-api >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

# ── Health check ─────────────────────────────────────────────────────────────
log "Health check: $HEALTH_URL"
healthy=0
for i in $(seq 1 "$HEALTH_RETRIES"); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
  if [ "$code" = "200" ]; then healthy=1; echo "  attempt $i: 200 OK"; break; fi
  echo "  attempt $i: ${code:-no response}"
  sleep "$HEALTH_DELAY"
done
[ "$healthy" = "1" ] || { fail "API did not become healthy"; false; }

for p in 3000 3001 3002 3003; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$p/" || true)"
  case "$code" in
    200|301|302|307|308) echo "  port $p: $code" ;;
    *) fail "Frontend on port $p returned '${code:-no response}'"; false ;;
  esac
done

trap - ERR
log "Deployed ${TARGET_SHA:0:8} successfully. Backup: $DUMP"
pm2 list

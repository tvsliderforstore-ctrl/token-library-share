# Setup, Backup & Restore

## Prerequisites
- Node.js 22+ (uses built-in `node:http`, `node:test`, `fetch`).
- No C/C++ build tools required (zero native dependencies).

## Install & run

```bash
cd C:\Users\chlam\product-token-library
npm install
copy .env.example .env        # then edit paths if needed
node src/db/seed.js           # create + migrate + seed (idempotent)
node src/server.js            # http://127.0.0.1:4310
```

Open the dashboard at `http://127.0.0.1:4310`.

## Configuration
All settings come from environment variables (see `.env.example`):
port/host, DB file path, taxonomy version, confidence thresholds, freshness window,
and the existing Hermes stock/price skill locations.

## Tests

```bash
node --test "test/*.test.js"     # 48 tests: classification, ingestion, e2e
node skills/product-token-classifier/tests/run-skill-tests.js   # 68 golden/skill checks (server must be running)
```

## Backup

### Full database backup
```bash
curl -OJ http://127.0.0.1:4310/api/export/backup
# or click 「完整資料庫備份」 on the 設定 page
```
Produces a timestamped `.db` file — copy it somewhere safe.

### Taxonomy-only backup
```bash
curl http://127.0.0.1:4310/api/export/taxonomy > taxonomy-backup.json
```

## Restore validation
Before restoring, validate a backup file:
```bash
curl -X POST --data-binary @backup.db http://127.0.0.1:4310/api/restore/validate
```
Returns whether the file is a valid SQLite DB with the expected tables.

### Restoring
Stop the server, replace the DB file at `PTL_DB_FILE` with the validated backup, restart.

## Daily refresh (price & stock)
Price and stock refreshes are independent and configurable (default once daily, not
hard-coded). Trigger manually from the dashboard or via `POST /api/ingest/run`. Each run:
creates an ingestion-run record, locks the data type, validates, transforms through the
adapter, maps to SKUs, inserts observations, routes ambiguous records to review, and
preserves previous valid data on failure.

## Upgrading the taxonomy
Bump `PTL_TAXONOMY_VERSION` and re-run `node src/db/seed.js` (idempotent; inserts a new
`taxonomy_versions` row). The Hermes skill reads the current version on every task.

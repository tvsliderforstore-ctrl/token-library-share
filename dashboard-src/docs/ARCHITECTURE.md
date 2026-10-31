# Architecture

## Goals & constraints

- Local-first; runs offline on Windows (MSYS), Node 22.
- Deterministic classification first; fuzzy only with human review.
- Stable taxonomy strictly separated from volatile price/stock observations.
- Reuse existing Hermes skills via adapters — never duplicate collection logic.
- Real, executable tests on this host.

## Stack decision (verified, not assumed)

| Option | Verdict | Reason |
|--------|---------|--------|
| Next.js + Prisma + better-sqlite3 | ❌ | `better-sqlite3` fails `node-gyp` build on this host (no prebuilt binary for Node 22, no working MSVC toolchain). Verified by probe. |
| **Pure Node 22 + sql.js (WASM) + hand-written SQL** | ✅ | Zero native deps → installs and tests run reliably here. |

The data-access layer is isolated in `src/db/repo.js`. All SQL goes through it, so a
future migration to PostgreSQL (or native `node:sqlite` once stable) touches only that file.

```
┌──────────────────────────────────────────────────────────┐
│  React 18 SPA (public/)  — Traditional Chinese, 11 pages │
└──────────────▲───────────────────────────────────────────┘
               │ fetch (REST/JSON)
┌──────────────┴───────────────────────────────────────────┐
│  node:http server (src/server.js)                        │
│   ├─ Router (src/api/httpUtil.js)                        │
│   ├─ Classification engine (src/classify/classify.js)    │
│   ├─ Normalization (src/lib/normalize.js)                │
│   ├─ Ingestion svc (src/ingest/ingest.js) + Adapters     │
│   └─ Import/Export (src/api/importExport.js)             │
└──────────────▲───────────────────────────────────────────┘
               │ repo.js (typed DAL)
┌──────────────┴───────────────────────────────────────────┐
│  SQLite (sql.js WASM) — src/db/db.js persistence wrapper │
│  schema: src/db/migrations/0001_schema.sql               │
└──────────────────────────────────────────────────────────┘
               ▲ wraps (does NOT reimplement)
   ┌───────────┴────────────┐
   │ stock-status-checker   │  check_sku.py <SKU> → JSON
   │ psos-discount-report   │  PSOS discount CSV (RSP/PSP)
   └────────────────────────┘
```

## Layers

### 1. Persistence (`src/db/`)
- `db.js` — sql.js wrapper: loads the DB into memory, debounced save to disk, `tx()`.
- `migrations/0001_schema.sql` — all entities, FKs, uniqueness, indexes, latest-value views.
- `migrate.js` — ordered migration runner (`_migrations` table).
- `seed.js` — idempotent seed (10 groups, 6 tokens, 6 keys, aliases, brands, origins).
- `repo.js` — typed data-access (the only place with SQL besides migrations).

### 2. Normalization (`src/lib/normalize.js`)
Deterministic pipeline (spec §7): Unicode NFKC, full/half-width, case-folded match keys,
bracket + hashtag extraction, pack-size parsing (ml/mL/ML/毫升, x/X/×, Chinese numerals,
L/公升, g/克, kg/公斤), Simplified↔Traditional search forms, Product Key fingerprint.

### 3. Classification (`src/classify/classify.js`)
11-step deterministic hierarchy (spec §8). Confirmed ID/barcode/name → exact alias →
longest alias → brand+component → regex → group scoring → fuzzy (review) → unmatched.
Alias priority: longest/most-specific beats generic (一口牛柳粒 > 牛肉粒). Confidence bands
0.95/0.75. Token-only allowed; never forces a Product Key without evidence.

### 4. Ingestion (`src/ingest/ingest.js`)
Adapters transform existing-skill output to the standard price/stock contracts.
Mapping order: external SKU ID → barcode → confirmed name → confirmed key → token
candidate (review) → unmatched. Append-only observations; per-data-type run locking;
ambiguous → `mapping_reviews`; invalid → `ingestion_errors`; failed runs preserve prior data.

### 5. API (`src/server.js`, `src/api/`)
REST endpoints for taxonomy, SKU/classification, price/stock, ingestion, import/export,
system. Money in integer minor units; returned as decimals. No credentials exposed.

### 6. Frontend (`public/`)
Hash-routed React SPA, 11 pages (Overview, Large Groups, Tokens, Product Keys, SKUs,
Tester, Review Queue, Price & Stock, Import/Export, Audit, Settings). Vendored React —
no runtime internet needed.

### 7. Hermes skill (`skills/product-token-classifier/`)
Thin read/classify/review client over the API. Source of truth = dashboard, never memory.

## Data freshness & display
- Every price/stock value carries `observed_at` + a freshness label (FRESH < 30h, STALE, MISSING).
- Token/Key/Large-Group summaries are derived from SKU-level observations; a token-level
  price is shown as a **range**, never a single exact price.
- A whole token is never marked out-of-stock because one SKU/location is.

## Security & reliability
- Input + output validation; transactional imports; idempotent ingestion; duplicate-run
  locking; append-only history; audit logs for corrections/destructive actions.
- No secrets in source; `.env.example` documents required vars.

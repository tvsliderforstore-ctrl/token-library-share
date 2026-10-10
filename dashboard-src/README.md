# 產品符號庫 · Product Token Library & Product Intelligence Dashboard

A **local-first** full-stack application that identifies products from inconsistent or very
long SKU names and maps them into a four-level controlled hierarchy, then displays daily
price and stock data supplied by existing Hermes skills.

**The dashboard + its database are the source of truth.** Hermes memory is never the
product library.

## Stack (zero native dependencies)

- **Runtime:** Node.js 22 (built-in `node:http`, `node:test`) — no framework
- **DB:** SQLite via [sql.js] (WASM, pure JS) — chosen because `better-sqlite3` cannot
  build on this Windows/MSYS host (no prebuilt binary for Node 22). SQL lives in
  `src/db/repo.js`, so migrating to PostgreSQL later only touches that layer.
- **Frontend:** React 18 SPA (vendored locally in `public/vendor/`, no runtime CDN/internet)
- **Chinese conversion:** OpenCC (Simplified↔Traditional search forms)
- **Excel import/export:** ExcelJS

Everything runs locally; no public domain required.

## Quick start

```bash
cd C:\Users\chlam\product-token-library
npm install                 # installs sql.js, exceljs, opencc, react (vendored)
node src/db/seed.js         # create + migrate + seed the DB (idempotent)
node src/server.js          # → http://127.0.0.1:4310
```

Open **http://127.0.0.1:4310** in a browser. The UI is in Traditional Chinese.

### Run the tests

```bash
node --test "test/*.test.js"        # app suite (classification, ingestion, e2e) — 48 tests
node skills/product-token-classifier/tests/run-skill-tests.js   # skill golden cases (server must be running)
```

## Four-level hierarchy

```
Large Group  (10 seeded: 乾貨食品 … 飲品)
└── Product Token  (canonical concept: 豆奶, 一口牛, 洗衣液 …)
    └── Product Key  (品牌 | 符號 | 產地 | 款式 | 規格)
        └── SKU  (exact sellable record; raw name never overwritten)
            ├── price observations   (append-only)
            └── stock observations   (append-only)
```

- **Product Token ≠ Product Key.** Tokens are shared concepts; keys are structured
  commercial configs. Variant/pack differences keep keys separate.
- **Token-only results are valid** when Product Key evidence is incomplete — never forced.
- **Stable vs dynamic:** taxonomy is stable; price/stock are volatile SKU-level observations.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, stack rationale
- [`docs/API.md`](docs/API.md) — REST endpoint reference
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md) — end-to-end verification report
- [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) — assumptions & limitations
- [`docs/SETUP.md`](docs/SETUP.md) — detailed setup, backup, restore
- [`.env.example`](.env.example) — environment template (no secrets)

## Hermes skill

`product-token-classifier` is installed into the active Hermes profile
(`profiles/app/skills/productivity/product-token-classifier/`). It classifies SKUs by
querying this dashboard live, returns structured JSON, routes ambiguous records to the
review queue, and never creates/modifies taxonomy without explicit human approval.

```bash
node skills/product-token-classifier/scripts/classify-product.js "一口牛柳粒(急凍)#牛肉粒" --pretty
```

## Price & stock skill integration

Adapters **wrap existing Hermes skills** — they never reimplement collection:

| Data | Skill | Adapter input |
|------|-------|---------------|
| Stock | `stock-status-checker` | `check_sku.py <SKU>` → `{stock_state, price_hkd, checked_at}` |
| Price | `psos-discount-report-download` | PSOS discount CSV (RSP=col E 原價, PSP=col F 特價) |

If a skill is unreachable, the dashboard shows a visible **"not connected"** status
(Settings page) rather than inventing live results.

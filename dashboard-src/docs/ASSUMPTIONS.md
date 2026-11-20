# Assumptions & Limitations

## Assumptions

1. **Stock skill location.** The authoritative stock skill is
   `profiles/app/skills/productivity/stock-status-checker/scripts/check_sku.py` (where it
   actually lives). Per your directive it is the only skill integrated; its contract is
   `check_sku.py <SKU> → {stock_state, price_hkd, product_name, checked_at}`.
2. **No new collection logic.** Per your directive, no new price/stock fetcher was
   developed — only adapters wrapping the existing skills. The price adapter maps the
   existing PSOS discount report CSV (RSP=col E 原價, PSP=col F 特價); it does not build
   a new PSOS downloader.
3. **Currency** is HKD; timezone Asia/Hong_Kong.
4. **Money** is stored as integer minor units (cents) and surfaced as decimals.
5. **Chinese display names** are labels, never DB primary keys; stable codes are used.
6. **Single-user local deployment.** The API binds to `127.0.0.1` by default; role-based
   edit protection is represented via reviewer identity + audit logs rather than full auth.

## Limitations (honest)

1. **SQLite engine is sql.js (WASM).** Chosen because `better-sqlite3` cannot build on
   this host (verified). The whole DB is held in memory with debounced disk saves. This is
   fine for a local product library (thousands–tens of thousands of SKUs) but is not a
   high-concurrency server DB. Migration path: `repo.js` is the only SQL layer → swap to
   PostgreSQL or native `node:sqlite` when available.
2. **Stock status granularity.** `check_sku.py` returns `in_stock / out_of_stock / delisted /
   unknown`. `LOW_STOCK`, `PREORDER`, quantity, and per-store location breakdown are not
   provided by that skill and therefore surface as `UNKNOWN`/absent until a richer source
   is connected. The schema already supports them.
3. **Live browser screenshot** could not be captured here (no CDP browser on this host);
   the dashboard was verified via HTTP responses and by serving the self-contained SPA
   (vendored React, no CDN) rather than a pixel screenshot.
4. **Daily scheduling** is configurable but the actual OS-level scheduler (cron/Task
   Scheduler) is left to deployment; the app exposes the run endpoints and manual controls.
5. **Concurrent multi-process writes** to the same DB file are not coordinated (single-process
   design). Per-data-type run locking prevents duplicate refreshes within the process.

## Deliberate design choices

- **Specific beats generic** in alias matching （一口牛柳粒 > 牛肉粒）; short generic aliases
  on long titles are capped below the auto-accept band and routed to review.
- **Fuzzy never auto-approves** — even the best fuzzy candidate requires human review.
- **Token-only is a first-class valid result**; Product Keys are never forced without evidence.
- **Append-only observations** so history is never lost and failed refreshes never erase prior values.

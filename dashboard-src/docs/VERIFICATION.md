# Final Verification Report

**Date:** 2026-07-27 · **Build:** Product Token Library & Product Intelligence Dashboard
**Environment:** Windows 10 (MSYS), Node 22.23.1, sql.js (WASM SQLite)

## Test results (executed, not asserted)

| Suite | Command | Result |
|-------|---------|--------|
| App (classification + normalization) | `node --test test/classification.test.js` | ✅ all pass |
| App (ingestion + price/stock) | `node --test test/ingestion.test.js` | ✅ all pass |
| App (end-to-end via live HTTP server) | `node --test test/e2e.test.js` | ✅ 13/13 pass |
| **App total** | `node --test "test/*.test.js"` | ✅ **48/48 pass** |
| Hermes skill golden + pack cases | `node skills/product-token-classifier/tests/run-skill-tests.js` | ✅ **68/68 pass** |

## Spec §31 verification checklist

| Requirement | Status | Evidence |
|-------------|--------|----------|
| All ten Large Groups exist | ✅ | `e2e` test 1 — exactly 10, names verified |
| Product Tokens separate from Product Keys | ✅ | `e2e` test 2 — 6 tokens / 6 keys; 豆奶 has 4 distinct keys |
| All six required Product Keys exist exactly | ✅ | `e2e` test 3 — display keys match verbatim |
| Long SKU names map to a Product Token | ✅ | `e2e` test 4 — spec §3 example returns the exact expected JSON |
| Token-only result is allowed | ✅ | `e2e` test 5 — `product_key_display: null`, valid |
| Ambiguous results reviewed, not guessed | ✅ | `e2e` test 6 — near-miss routes to review (conf < 0.95) |
| Price & stock stored at SKU level | ✅ | `e2e` test 7 — observations on `sku_id` |
| Historical observations retained | ✅ | `e2e` test 7 — 2 stock obs appended, not overwritten |
| Existing price & stock skills reused | ✅ | `e2e` test 11 — adapters wrap `check_sku.py` + PSOS CSV |
| Failed refresh preserves previous valid data | ✅ | `e2e` test 8 — count unchanged after FAILED run |
| Dashboard shows observation time + freshness | ✅ | `e2e` test 9 — `observed_at` + FRESH/STALE/MISSING |
| Token-level price shown as range | ✅ | `e2e` test 10 — range, not a single price |
| Hermes reads dashboard, not memory | ✅ | skill scripts query the API; taxonomy version read each task |

## Seed data (verified)

- 10 Large Groups (乾貨食品, 保健用品, 保健食品, 個人護理, 家居清潔, 寵物用品, 急凍/冷凍, 街市貨品, 長者護理, 飲品)
- 6 Product Tokens （洗臉巾, 洗衣液, 洗衣珠, 豆奶, 牛奶, 一口牛）
- 6 Product Keys exactly as specified （鈣思寶 ×4, 北海道乳業 ×2)
- 4 approved aliases for 一口牛 （一口牛, 一口牛柳粒, 一口牛肉粒, 急凍一口牛柳粒）

## Golden classification cases (all pass)

```
一口牛柳粒(急凍)#牛肉粒#淋滑#韓燒烤#家常小菜
  → 急凍/冷凍 · 一口牛 · EXACT_APPROVED_ALIAS · conf 1.000 · review:false
  → attributes [急凍, 牛肉粒, 淋滑, 韓燒烤, 家常小菜]
一口牛柳粒（急凍）            → 一口牛 · review:false
一口牛柳粒 # 家常小菜          → 一口牛 · review:false
鈣思寶無糖豆奶250毫升24支       → 豆奶 · 鈣思寶 | 豆奶 | 中國 | 無糖 | 250ml x 24支 · conf 0.990
北海道乳業北海道3.6牛乳1000ml四支裝 → 牛奶 · 北海道乳業 | 牛奶 | 日本 | 北海道3.6牛乳 | 1000ml x 4支 · conf 0.990
一口牛柳妙粒 (near-miss)       → 一口牛 · conf 0.675 · review:true  (not auto-accepted)
```

## Stack verification

- `better-sqlite3` build **fails** on this host (node-gyp error) → confirmed before choosing sql.js.
- sql.js, exceljs, opencc all load and run (OpenCC: 钙思宝→鈣思寶 verified).
- Dashboard serves the SPA + all API routes over `http://127.0.0.1:4310` (verified via HTTP).

## Known limitations
See [`ASSUMPTIONS.md`](ASSUMPTIONS.md) — sql.js in-memory engine, stock-status granularity
limited by the existing skill's output, no live pixel screenshot (no CDP browser here).

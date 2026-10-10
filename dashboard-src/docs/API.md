# API Reference

Base URL: `http://127.0.0.1:4310`. All bodies/responses are JSON (`Content-Type: application/json`).
Money is stored as integer minor units and returned as decimals (HKD). No credentials are exposed.

Errors: `{ "error": "message", ...details }` with an appropriate HTTP status.

## System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check (`{ok, time, db}`) |
| GET | `/api/system/skill-status` | Price/stock skill connection status |
| GET | `/api/system/taxonomy-version` | Current taxonomy version |

## Taxonomy
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/large-groups` | List groups + token/key/SKU counts |
| POST | `/api/large-groups` | Create group |
| PATCH | `/api/large-groups/:id` | Update description/order/active/name_en |
| GET | `/api/tokens?group_id=` | List tokens (optional group filter) |
| POST | `/api/tokens` | Create token |
| GET | `/api/tokens/:id` | Token detail + aliases + negative aliases |
| PATCH | `/api/tokens/:id` | Update token |
| POST | `/api/tokens/:id/aliases` | Add approved alias `{alias}` |
| POST | `/api/tokens/:id/negative-aliases` | Add negative alias `{alias}` |
| GET | `/api/product-keys?q=` | List/search keys by any component (無糖/250ml/鈣思寶/…) |
| POST | `/api/product-keys` | Create key (structured fields) |
| GET | `/api/product-keys/:id` | Key detail |
| PATCH | `/api/product-keys/:id` | Update key |
| GET | `/api/search?q=` | Search tokens + keys |

## SKU & classification
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/skus?q=&group_id=&token_id=&key_id=&review_status=&limit=&offset=` | List SKUs |
| GET | `/api/skus/:id` | One SKU (full raw name preserved) |
| POST | `/api/skus/import` | Import SKUs `{rows:[…]}` — auto-classifies |
| POST | `/api/classify` | Classify `{raw_sku_name}` or `{items:[…]}` (batch) |
| GET | `/api/classify/results/:id` | Stored result + candidates |
| GET | `/api/review/queue?type=` | Pending classification/mapping reviews |
| POST | `/api/review/submit` | Submit human decision `{sku_id, action, product_token_id?, product_key_id?, …}` |
| GET | `/api/export/mappings` | Export SKU→taxonomy mappings |

## Price & stock
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/skus/:id/price` | Current price (effective, previous, diff, pct, promo, freshness) |
| GET | `/api/skus/:id/price-history` | Full price history |
| GET | `/api/skus/:id/stock` | Latest stock per location |
| GET | `/api/skus/:id/stock-history` | Full stock history |
| GET | `/api/product-keys/:id/summary` | Key-level price/stock summary |
| GET | `/api/tokens/:id/summary` | Token-level price range + stock summary |
| GET | `/api/price-stock/overview` | In/low/out/unknown stock, promos, missing, stale |
| POST | `/api/ingest/run` | Run an ingestion `{data_type:"PRICE"\|"STOCK", records:[…]}` (adapter-transformed) |
| GET | `/api/ingest/runs?data_type=` | Ingestion run history |
| GET | `/api/ingest/runs/:id` | One run's status/counts |
| GET | `/api/ingest/mapping-reviews` | Unresolved operational mappings |

## Import / export / backup
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/import/template?format=csv\|xlsx` | Download import template |
| POST | `/api/import/validate` | Validate rows `{rows:[…]}` → valid/invalid/warnings |
| POST | `/api/import/commit` | Import `{rows:[…], importValidOnly?}` |
| GET | `/api/export/skus?format=csv\|xlsx\|json` | Export SKUs |
| GET | `/api/export/taxonomy` | Export taxonomy (JSON) |
| GET | `/api/export/backup` | Download full DB backup |
| POST | `/api/restore/validate` | Validate a backup file (binary body) |

## Classification result shape
```json
{
  "raw_sku_name": "…", "normalized_sku_name": "…", "base_title": "…",
  "large_group_code": "FROZEN", "large_group_name": "急凍/冷凍",
  "product_token_code": "PT-FROZEN-BEEF-BITE", "product_token_name": "一口牛",
  "product_key_code": null, "product_key_display": null,
  "matched_alias": "一口牛柳粒", "extracted_attributes": ["急凍","牛肉粒","淋滑","韓燒烤","家常小菜"],
  "match_method": "EXACT_APPROVED_ALIAS", "confidence": 1.0, "requires_review": false,
  "alternative_candidates": [], "explanation": "…"
}
```

# API Contract

Base URL: `http://127.0.0.1:4310` (override with `PTL_API`). All responses are JSON.
No credentials are exposed through the API.

## Taxonomy (read)
- `GET /api/large-groups` — list groups (with token/key/SKU counts)
- `GET /api/tokens?group_id=` — list tokens
- `GET /api/tokens/:id` — token detail incl. aliases + negative aliases
- `GET /api/product-keys?q=` — list/search Product Keys by any component
- `GET /api/product-keys/:id`
- `GET /api/search?q=` — search tokens + keys
- `GET /api/system/taxonomy-version` — current taxonomy version

## Classification
- `POST /api/classify` — body `{raw_sku_name}` or `{items:[...]}` for batch.
  Returns the classification result (see Classification rules doc for the shape).
- `GET /api/classify/results/:id` — a stored result + its candidates

## Review
- `GET /api/review/queue?type=` — pending classification/mapping reviews
- `POST /api/review/submit` — submit a human decision. Body:
  `{sku_id, action, product_token_id?, product_key_id?, large_group_id?, reviewer?, reason?, add_alias?, add_negative_alias?}`

## SKU
- `GET /api/skus?q=&group_id=&token_id=&key_id=&review_status=&limit=&offset=`
- `GET /api/skus/:id`
- `POST /api/skus/import` — body `{rows:[{external_sku_id,barcode,raw_sku_name,...}]}` (auto-classifies)

## Price & stock
- `GET /api/skus/:id/price` — current price (effective, previous, diff, pct, freshness)
- `GET /api/skus/:id/price-history`
- `GET /api/skus/:id/stock` — per-location latest stock
- `GET /api/skus/:id/stock-history`
- `GET /api/product-keys/:id/summary` — key-level price/stock summary
- `GET /api/tokens/:id/summary` — token-level price range + stock summary
- `GET /api/price-stock/overview`
- `POST /api/ingest/run` — body `{data_type:"PRICE"|"STOCK", records:[...]}` (adapter-transformed)
- `GET /api/ingest/runs?data_type=` / `GET /api/ingest/runs/:id`
- `GET /api/ingest/mapping-reviews`

## System
- `GET /api/health`
- `GET /api/system/skill-status` — price/stock skill connection status
- `GET /api/export/skus?format=csv|xlsx|json`
- `GET /api/export/taxonomy` / `GET /api/export/backup`
- `POST /api/restore/validate` — validate a backup file (binary body)

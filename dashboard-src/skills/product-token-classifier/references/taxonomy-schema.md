# Taxonomy Schema

Four-level controlled hierarchy. Stable taxonomy is separate from volatile operational data.

## Levels

### Level 1 — Large Group (`large_groups`)
Highest business category. Exactly 10 seeded: 乾貨食品, 保健用品, 保健食品, 個人護理,
家居清潔, 寵物用品, 急凍/冷凍, 街市貨品, 長者護理, 飲品.
Fields: `group_code` (stable, e.g. `BEVERAGES`), `name_zh` (primary label), `name_en`,
`description`, `display_order`, `active`, timestamps.

### Level 2 — Product Token (`product_tokens`)
Controlled canonical product concept (not a sellable product).
Fields: `token_code` (e.g. `PT-BEVERAGE-SOY-MILK`), `name_zh` (canonical), `large_group_id`,
`priority`, `active`, `taxonomy_version`.
Relations: `product_token_aliases` (APPROVED/PENDING/REJECTED), `product_token_negative_aliases`,
`product_token_patterns` (approved regex).

### Level 3 — Product Key (`product_keys`)
Structured product family / commercial configuration.
Display format: `品牌 | Product Token | 產地 | 款式/功能/口味 | 規格`.
Stored as structured fields: `brand_id`, `token_id`, `origin_id`, `variant`, `unit_size`,
`unit_measurement`, `pack_count`, `pack_unit`, `display_pack_format`, `display_key`,
`fingerprint` (dedupe). Null field → dashboard shows `待確認`.

### Level 4 — SKU (`sku_records`)
Exact sellable record from the source system.
Fields: `external_sku_id`, `barcode`, `raw_sku_name` (never overwritten),
`normalized_sku_name`, `product_key_id`, `product_token_id`, `large_group_id`,
`mapping_status`, `mapping_confidence`, `mapping_method`, `review_status`, first/last seen.

## Supporting tables
- `brands`, `brand_aliases`, `origins`, `product_key_aliases`
- `sku_product_mappings`, `taxonomy_versions`
- Classification/review: `classification_results`, `classification_candidates`,
  `classification_reviews`, `mapping_reviews`, `correction_examples`, `audit_logs`
- Price/stock (append-only): `sku_price_observations`, `sku_stock_observations`,
  `inventory_locations`, `ingestion_runs`, `ingestion_errors`, `ingestion_source_records`

## Stable vs dynamic
Stable (taxonomy): groups, tokens, keys, brands, origins, aliases, matching rules.
Dynamic (operational): price, promo, stock, quantity, location, observation time, refresh status.
Dynamic data attaches to the **SKU level** as append-only observations; summaries are derived.

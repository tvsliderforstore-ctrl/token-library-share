-- Tier status (Current Status baseline) + per-SKU GMV store for the tier engine.

-- GMV per SKU (from the Final-list Excel; Lite GMV with Main GMV fallback).
CREATE TABLE IF NOT EXISTS sku_gmv (
  external_sku_id TEXT PRIMARY KEY,
  gmv REAL,
  source TEXT,
  updated_at TEXT
);

-- Current Status baseline: the applied tier per facing id (product_key_id).
-- tier: 1 | 2 | 3.  representative_sku_id = the SKU that represents this facing id.
CREATE TABLE IF NOT EXISTS tier_status (
  product_key_id INTEGER PRIMARY KEY,
  tier INTEGER NOT NULL,
  representative_sku_id TEXT,
  sub_category_id INTEGER,
  gmv REAL,
  applied_at TEXT NOT NULL
);

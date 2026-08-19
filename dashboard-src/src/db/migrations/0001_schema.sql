-- 0001_schema.sql — Product Token Library schema.
-- Stable taxonomy is separated from volatile operational observations.
-- Money stored as INTEGER minor units (cents). Prices never binary float.
-- Observation tables are append-only; "latest" is derived by query/view.

-- ============ TAXONOMY ============

CREATE TABLE IF NOT EXISTS large_groups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_code    TEXT NOT NULL UNIQUE,          -- DRY_FOOD, BEVERAGES, ...
  name_zh       TEXT NOT NULL,                 -- 乾貨食品 (primary label)
  name_en       TEXT,
  description   TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brands (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_code    TEXT UNIQUE,
  display_name  TEXT NOT NULL UNIQUE,          -- 鈣思寶, 北海道乳業
  name_en       TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brand_aliases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id    INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL,
  normalized  TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  UNIQUE(brand_id, normalized)
);

CREATE TABLE IF NOT EXISTS origins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  origin_code TEXT UNIQUE,
  name_zh     TEXT NOT NULL UNIQUE,            -- 中國, 日本
  name_en     TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_tokens (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  token_code       TEXT NOT NULL UNIQUE,       -- PT-BEVERAGE-SOY-MILK
  name_zh          TEXT NOT NULL,              -- 豆奶 (canonical)
  name_en          TEXT,
  large_group_id   INTEGER NOT NULL REFERENCES large_groups(id),
  description      TEXT,
  priority         INTEGER NOT NULL DEFAULT 0, -- higher = evaluated first
  active           INTEGER NOT NULL DEFAULT 1,
  taxonomy_version TEXT NOT NULL DEFAULT '1.0.0',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_group ON product_tokens(large_group_id);

CREATE TABLE IF NOT EXISTS product_token_aliases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id    INTEGER NOT NULL REFERENCES product_tokens(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL,                   -- display form e.g. 一口牛柳粒
  normalized  TEXT NOT NULL,                   -- normalized matching form
  status      TEXT NOT NULL DEFAULT 'APPROVED',-- APPROVED | PENDING | REJECTED
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(token_id, normalized)
);
CREATE INDEX IF NOT EXISTS idx_alias_norm ON product_token_aliases(normalized);

CREATE TABLE IF NOT EXISTS product_token_negative_aliases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id    INTEGER NOT NULL REFERENCES product_tokens(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL,
  normalized  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE(token_id, normalized)
);

CREATE TABLE IF NOT EXISTS product_token_patterns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id    INTEGER NOT NULL REFERENCES product_tokens(id) ON DELETE CASCADE,
  pattern     TEXT NOT NULL,                   -- regex source (approved only)
  flags       TEXT NOT NULL DEFAULT 'i',
  priority    INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'APPROVED',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_keys (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  product_key_code   TEXT NOT NULL UNIQUE,     -- PK-000001
  brand_id           INTEGER REFERENCES brands(id),
  token_id           INTEGER NOT NULL REFERENCES product_tokens(id),
  origin_id          INTEGER REFERENCES origins(id),
  variant            TEXT,                     -- 無糖 / 植物固醇 / 北海道3.6牛乳
  unit_size          REAL,
  unit_measurement   TEXT,                     -- ml, L, g, ...
  pack_count         INTEGER,
  pack_unit          TEXT,                     -- 支, 粒, 片
  display_pack_format TEXT,                    -- 250ml x 24支
  display_key        TEXT NOT NULL,            -- 鈣思寶 | 豆奶 | 中國 | 無糖 | 250ml x 24支
  fingerprint        TEXT NOT NULL,            -- normalized dedupe key
  active             INTEGER NOT NULL DEFAULT 1,
  taxonomy_version   TEXT NOT NULL DEFAULT '1.0.0',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pkey_fingerprint ON product_keys(fingerprint);
CREATE INDEX IF NOT EXISTS idx_pkey_token ON product_keys(token_id);
CREATE INDEX IF NOT EXISTS idx_pkey_brand ON product_keys(brand_id);

CREATE TABLE IF NOT EXISTS product_key_aliases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_key_id  INTEGER NOT NULL REFERENCES product_keys(id) ON DELETE CASCADE,
  alias           TEXT NOT NULL,
  normalized      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'APPROVED',
  created_at      TEXT NOT NULL,
  UNIQUE(product_key_id, normalized)
);

CREATE TABLE IF NOT EXISTS sku_records (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  external_sku_id    TEXT UNIQUE,              -- source system id
  barcode            TEXT,
  raw_sku_name       TEXT NOT NULL,            -- full original name, never overwritten
  normalized_sku_name TEXT,
  product_key_id     INTEGER REFERENCES product_keys(id),
  product_token_id   INTEGER REFERENCES product_tokens(id),
  large_group_id     INTEGER REFERENCES large_groups(id),
  sales_channel      TEXT,
  variant_metadata   TEXT,                     -- JSON
  active             INTEGER NOT NULL DEFAULT 1,
  first_seen_at      TEXT,
  last_seen_at       TEXT,
  mapping_status     TEXT NOT NULL DEFAULT 'UNMAPPED', -- MAPPED|TOKEN_ONLY|UNMAPPED|REVIEW
  mapping_confidence REAL,
  mapping_method     TEXT,
  review_status      TEXT NOT NULL DEFAULT 'NONE',     -- NONE|PENDING|CONFIRMED|REJECTED
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sku_barcode ON sku_records(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sku_token ON sku_records(product_token_id);
CREATE INDEX IF NOT EXISTS idx_sku_key ON sku_records(product_key_id);
CREATE INDEX IF NOT EXISTS idx_sku_group ON sku_records(large_group_id);

CREATE TABLE IF NOT EXISTS sku_product_mappings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id          INTEGER NOT NULL REFERENCES sku_records(id) ON DELETE CASCADE,
  product_key_id  INTEGER REFERENCES product_keys(id),
  product_token_id INTEGER REFERENCES product_tokens(id),
  mapping_method  TEXT NOT NULL,
  confidence      REAL,
  confirmed       INTEGER NOT NULL DEFAULT 0,
  confirmed_by    TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS taxonomy_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version     TEXT NOT NULL UNIQUE,
  note        TEXT,
  created_at  TEXT NOT NULL
);

-- ============ CLASSIFICATION & REVIEW ============

CREATE TABLE IF NOT EXISTS classification_results (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id             INTEGER REFERENCES sku_records(id),
  raw_input          TEXT NOT NULL,
  normalized_input   TEXT,
  base_title         TEXT,
  large_group_id     INTEGER REFERENCES large_groups(id),
  product_token_id   INTEGER REFERENCES product_tokens(id),
  product_key_id     INTEGER REFERENCES product_keys(id),
  matched_alias      TEXT,
  match_method       TEXT,
  confidence         REAL,
  extracted_attributes TEXT,                   -- JSON array
  explanation        TEXT,
  requires_review    INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'PROPOSED', -- PROPOSED|CONFIRMED|REJECTED
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS classification_candidates (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id          INTEGER NOT NULL REFERENCES classification_results(id) ON DELETE CASCADE,
  product_token_id   INTEGER REFERENCES product_tokens(id),
  product_key_id     INTEGER REFERENCES product_keys(id),
  score              REAL,
  reason             TEXT
);
CREATE INDEX IF NOT EXISTS idx_cand_result ON classification_candidates(result_id);

CREATE TABLE IF NOT EXISTS classification_reviews (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id      INTEGER REFERENCES classification_results(id),
  sku_id         INTEGER REFERENCES sku_records(id),
  queue_type     TEXT NOT NULL DEFAULT 'TOKEN', -- TOKEN|PRODUCT_KEY|PRICE|STOCK|DUPLICATE_KEY|ALIAS_CONFLICT
  proposed       TEXT,                          -- JSON
  final_value    TEXT,                          -- JSON
  action         TEXT,                          -- CONFIRM|REASSIGN|CREATE_ALIAS|ADD_NEGATIVE|MARK_UNMATCHED|...
  reviewer       TEXT,
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'PENDING', -- PENDING|RESOLVED|DISMISSED
  created_at     TEXT NOT NULL,
  resolved_at    TEXT
);

CREATE TABLE IF NOT EXISTS mapping_reviews (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type    TEXT NOT NULL,                 -- PRICE | STOCK
  source_record  TEXT NOT NULL,                 -- JSON raw record
  proposed_sku_id INTEGER REFERENCES sku_records(id),
  proposed_token_id INTEGER REFERENCES product_tokens(id),
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'PENDING',
  reviewer       TEXT,
  created_at     TEXT NOT NULL,
  resolved_at    TEXT
);

CREATE TABLE IF NOT EXISTS correction_examples (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_input      TEXT NOT NULL,
  old_value      TEXT,
  new_value      TEXT,
  correction_type TEXT,
  reviewer       TEXT,
  reason         TEXT,
  taxonomy_version TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type    TEXT NOT NULL,
  entity_id      INTEGER,
  action         TEXT NOT NULL,
  old_value      TEXT,
  new_value      TEXT,
  reviewer       TEXT,
  reason         TEXT,
  source_ref     TEXT,
  taxonomy_version TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

-- ============ PRICE & STOCK (append-only observations) ============

CREATE TABLE IF NOT EXISTS inventory_locations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  location_code TEXT UNIQUE,
  name          TEXT NOT NULL,
  channel       TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sku_price_observations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id            INTEGER NOT NULL REFERENCES sku_records(id) ON DELETE CASCADE,
  regular_price_minor     INTEGER,           -- cents; NULL if missing
  promotional_price_minor INTEGER,
  effective_price_minor   INTEGER,
  currency          TEXT NOT NULL DEFAULT 'HKD',
  promotion_name    TEXT,
  promotion_start_at TEXT,
  promotion_end_at  TEXT,
  sales_channel     TEXT,
  source_skill      TEXT,
  source            TEXT,
  observed_at       TEXT NOT NULL,
  ingested_at       TEXT NOT NULL,
  ingestion_run_id  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_price_sku_time ON sku_price_observations(sku_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS sku_stock_observations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id            INTEGER NOT NULL REFERENCES sku_records(id) ON DELETE CASCADE,
  location_id       INTEGER REFERENCES inventory_locations(id),
  stock_status      TEXT NOT NULL DEFAULT 'UNKNOWN', -- IN_STOCK|LOW_STOCK|OUT_OF_STOCK|PREORDER|DISCONTINUED|UNKNOWN
  available_quantity  REAL,
  reserved_quantity   REAL,
  incoming_quantity   REAL,
  expected_restock_at TEXT,
  sales_channel     TEXT,
  raw_value         TEXT,                        -- raw source value for audit
  source_skill      TEXT,
  source            TEXT,
  observed_at       TEXT NOT NULL,
  ingested_at       TEXT NOT NULL,
  ingestion_run_id  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_stock_sku_time ON sku_stock_observations(sku_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_loc ON sku_stock_observations(location_id);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  data_type     TEXT NOT NULL,               -- PRICE | STOCK
  status        TEXT NOT NULL DEFAULT 'RUNNING', -- RUNNING|COMPLETED|FAILED|PARTIAL
  source_skill  TEXT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  records_total INTEGER DEFAULT 0,
  records_ok    INTEGER DEFAULT 0,
  records_ambiguous INTEGER DEFAULT 0,
  records_invalid INTEGER DEFAULT 0,
  error_message TEXT,
  triggered_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_ingest_type_time ON ingestion_runs(data_type, started_at DESC);

-- Partial unique index enforces one RUNNING run per data_type (duplicate-run lock).
CREATE UNIQUE INDEX IF NOT EXISTS uq_running_per_type
  ON ingestion_runs(data_type) WHERE status = 'RUNNING';

CREATE TABLE IF NOT EXISTS ingestion_errors (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ingestion_run_id  INTEGER REFERENCES ingestion_runs(id) ON DELETE CASCADE,
  record            TEXT,                       -- JSON
  error             TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_source_records (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ingestion_run_id  INTEGER REFERENCES ingestion_runs(id) ON DELETE CASCADE,
  data_type         TEXT NOT NULL,
  raw_record        TEXT NOT NULL,              -- JSON raw
  mapped_sku_id     INTEGER REFERENCES sku_records(id),
  mapping_status    TEXT NOT NULL DEFAULT 'UNMATCHED', -- MATCHED|REVIEW|UNMATCHED
  created_at        TEXT NOT NULL
);

-- Latest-valid views (do not overwrite history; derive current state).
-- ROW_NUMBER with a deterministic tie-break (highest id wins) so that observations
-- sharing an identical observed_at timestamp (common in bulk imports) yield exactly
-- ONE latest row per sku — never a fan-out that duplicates SKUs in drill-downs.
CREATE VIEW IF NOT EXISTS v_latest_price AS
SELECT id, sku_id, regular_price_minor, promotional_price_minor, effective_price_minor,
       currency, promotion_name, promotion_start_at, promotion_end_at, sales_channel,
       source_skill, source, observed_at, ingestion_run_id
FROM (
  SELECT p.*,
    ROW_NUMBER() OVER (PARTITION BY p.sku_id ORDER BY p.observed_at DESC, p.id DESC) AS rn
  FROM sku_price_observations p
) WHERE rn = 1;

CREATE VIEW IF NOT EXISTS v_latest_stock AS
SELECT id, sku_id, location_id, stock_status, available_quantity, reserved_quantity,
       incoming_quantity, expected_restock_at, sales_channel, raw_value, source_skill,
       source, observed_at, ingestion_run_id
FROM (
  SELECT s.*,
    ROW_NUMBER() OVER (PARTITION BY s.sku_id, IFNULL(s.location_id,-1)
                     ORDER BY s.observed_at DESC, s.id DESC) AS rn
  FROM sku_stock_observations s
) WHERE rn = 1;

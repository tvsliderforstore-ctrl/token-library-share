-- 0002_sub_categories.sql — add Sub Cat level under large_groups (Main Cats).
-- Reuses existing large_groups as the Main Cat level (the 10 groups already match the
-- approved list). Adds sub_categories, links sku_records/product_tokens to a Sub Cat,
-- and adds FK + consistency validation. All additive — nothing existing is dropped.

CREATE TABLE IF NOT EXISTS sub_categories (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sub_cat_code    TEXT NOT NULL UNIQUE,          -- BEV_SOY_DAIRY (stable, non-Chinese)
  name_zh         TEXT NOT NULL,                 -- 豆奶/奶類 (display)
  description     TEXT,
  large_group_id  INTEGER NOT NULL REFERENCES large_groups(id),
  display_order   INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  taxonomy_version TEXT NOT NULL DEFAULT '1.1.0',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subcat_group ON sub_categories(large_group_id);
CREATE INDEX IF NOT EXISTS idx_subcat_code ON sub_categories(sub_cat_code);
CREATE INDEX IF NOT EXISTS idx_subcat_active ON sub_categories(active);

-- Link SKUs and Product Tokens to a Sub Cat.
ALTER TABLE sku_records ADD COLUMN sub_category_id INTEGER REFERENCES sub_categories(id);
ALTER TABLE product_tokens ADD COLUMN sub_category_id INTEGER REFERENCES sub_categories(id);

-- Indexes supporting category browsing, filtering and server-side pagination.
CREATE INDEX IF NOT EXISTS idx_sku_subcat ON sku_records(sub_category_id);
CREATE INDEX IF NOT EXISTS idx_token_subcat ON product_tokens(sub_category_id);
CREATE INDEX IF NOT EXISTS idx_sku_review_status ON sku_records(review_status);
CREATE INDEX IF NOT EXISTS idx_sku_external ON sku_records(external_sku_id);
CREATE INDEX IF NOT EXISTS idx_stock_status ON sku_stock_observations(stock_status);

-- Consistency trigger: a SKU's Sub Cat must belong to the SKU's Main Cat (large_group).
-- Rejects e.g. Main Cat=飲品 with Sub Cat=魚 (which lives under 急凍/冷凍).
CREATE TRIGGER IF NOT EXISTS trg_sku_subcat_group_check
BEFORE INSERT ON sku_records
WHEN NEW.sub_category_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'SUBCAT_GROUP_MISMATCH')
  WHERE (SELECT large_group_id FROM sub_categories WHERE id = NEW.sub_category_id)
        IS NOT COALESCE(NEW.large_group_id, (SELECT large_group_id FROM sub_categories WHERE id = NEW.sub_category_id));
END;

CREATE TRIGGER IF NOT EXISTS trg_sku_subcat_group_check_upd
BEFORE UPDATE OF sub_category_id, large_group_id ON sku_records
WHEN NEW.sub_category_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'SUBCAT_GROUP_MISMATCH')
  WHERE (SELECT large_group_id FROM sub_categories WHERE id = NEW.sub_category_id)
        IS NOT COALESCE(NEW.large_group_id, (SELECT large_group_id FROM sub_categories WHERE id = NEW.sub_category_id));
END;

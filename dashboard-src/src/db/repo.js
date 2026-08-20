'use strict';
/**
 * repo.js — typed data-access layer over the Database.
 * Keeps SQL in one place so a future PostgreSQL migration only touches this file.
 */
const { keyFingerprint, analyze, matchKey } = require('../lib/normalize');
const config = require('../config');

const NOW = () => new Date().toISOString();

function trimNum(n) { return Number.isInteger(n) ? String(n) : String(n).replace(/\.?0+$/, ''); }
function packFormat(usize, umeas, pcount, punit) {
  const size = usize != null && umeas ? `${trimNum(Number(usize))}${umeas}` : null;
  const pack = pcount != null ? `${pcount}${punit || ''}`.trim() : null;
  if (size && pack) return `${size} x ${pack}`;
  return size || pack || null;
}

// ---------- Large Groups ----------
const Groups = {
  list: (db) => db.all(`
    SELECT g.*,
      (SELECT COUNT(*) FROM product_tokens t WHERE t.large_group_id=g.id) AS token_count,
      (SELECT COUNT(*) FROM product_keys k JOIN product_tokens t ON t.id=k.token_id WHERE t.large_group_id=g.id) AS key_count,
      (SELECT COUNT(*) FROM sku_records s WHERE s.large_group_id=g.id) AS sku_count
    FROM large_groups g ORDER BY g.display_order`),
  get: (db, id) => db.get('SELECT * FROM large_groups WHERE id=?', [id]),
  byCode: (db, code) => db.get('SELECT * FROM large_groups WHERE group_code=?', [code]),
  update(db, id, fields, reviewer) {
    const g = this.get(db, id);
    if (!g) return null;
    const now = NOW();
    db.run('UPDATE large_groups SET name_en=?, description=?, display_order=?, active=?, updated_at=? WHERE id=?', [
      fields.name_en !== undefined ? fields.name_en : g.name_en,
      fields.description !== undefined ? fields.description : g.description,
      fields.display_order !== undefined ? fields.display_order : g.display_order,
      fields.active !== undefined ? (fields.active ? 1 : 0) : g.active,
      now, id,
    ]);
    Audit.log(db, 'large_group', id, 'UPDATE', g, fields, reviewer, fields.reason);
    return this.get(db, id);
  },
};

// ---------- Tokens ----------
const Tokens = {
  list(db, { groupId } = {}) {
    const where = groupId ? 'WHERE t.large_group_id=?' : '';
    const params = groupId ? [groupId] : [];
    return db.all(`
      SELECT t.*, g.name_zh AS group_name, g.group_code,
        (SELECT COUNT(*) FROM product_keys k WHERE k.token_id=t.id) AS key_count,
        (SELECT COUNT(*) FROM sku_records s WHERE s.product_token_id=t.id) AS sku_count
      FROM product_tokens t JOIN large_groups g ON g.id=t.large_group_id ${where}
      ORDER BY t.priority DESC, t.id`, params);
  },
  get: (db, id) => db.get(`
    SELECT t.*, g.name_zh AS group_name, g.group_code
    FROM product_tokens t JOIN large_groups g ON g.id=t.large_group_id WHERE t.id=?`, [id]),
  byCode: (db, code) => db.get('SELECT * FROM product_tokens WHERE token_code=?', [code]),
  aliases: (db, id) => db.all('SELECT * FROM product_token_aliases WHERE token_id=? ORDER BY id', [id]),
  negativeAliases: (db, id) => db.all('SELECT * FROM product_token_negative_aliases WHERE token_id=? ORDER BY id', [id]),
  addAlias(db, id, alias, status, reviewer, reason) {
    const now = NOW();
    const norm = matchKey(alias);
    db.run('INSERT INTO product_token_aliases (token_id, alias, normalized, status, created_at, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(token_id, normalized) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at',
      [id, alias, norm, status || 'APPROVED', now, now]);
    Audit.log(db, 'product_token', id, 'ADD_ALIAS', null, { alias, status }, reviewer, reason);
  },
  addNegativeAlias(db, id, alias, reviewer, reason) {
    const now = NOW();
    db.run('INSERT INTO product_token_negative_aliases (token_id, alias, normalized, created_at) VALUES (?,?,?,?) ON CONFLICT(token_id, normalized) DO NOTHING',
      [id, alias, matchKey(alias), now]);
    Audit.log(db, 'product_token', id, 'ADD_NEGATIVE_ALIAS', null, { alias }, reviewer, reason);
  },
};

// ---------- Product Keys ----------
const Keys = {
  list(db, { tokenId, q } = {}) {
    let sql = `
      SELECT k.*, b.display_name AS brand_name, o.name_zh AS origin_name, t.name_zh AS token_name, t.id AS token_id,
        (SELECT COUNT(*) FROM sku_records s WHERE s.product_key_id=k.id) AS sku_count
      FROM product_keys k
      LEFT JOIN brands b ON b.id=k.brand_id
      LEFT JOIN origins o ON o.id=k.origin_id
      JOIN product_tokens t ON t.id=k.token_id`;
    const params = [];
    const conds = [];
    if (tokenId) { conds.push('k.token_id=?'); params.push(tokenId); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY k.id';
    let rows = db.all(sql, params);
    if (q) {
      const needle = matchKey(q);
      rows = rows.filter((k) =>
        matchKey(k.display_key).includes(needle) ||
        matchKey(k.brand_name || '').includes(needle) ||
        matchKey(k.token_name || '').includes(needle) ||
        matchKey(k.origin_name || '').includes(needle) ||
        matchKey(k.variant || '').includes(needle) ||
        matchKey(k.display_pack_format || '').includes(needle) ||
        (k.fingerprint || '').includes(matchKey(q).replace(/\s+/g, '')));
    }
    return rows;
  },
  get(db, id) {
    return db.get(`
      SELECT k.*, b.display_name AS brand_name, o.name_zh AS origin_name, t.name_zh AS token_name
      FROM product_keys k LEFT JOIN brands b ON b.id=k.brand_id
      LEFT JOIN origins o ON o.id=k.origin_id JOIN product_tokens t ON t.id=k.token_id WHERE k.id=?`, [id]);
  },
  byFingerprint: (db, fp) => db.get('SELECT * FROM product_keys WHERE fingerprint=?', [fp]),
  create(db, fields, reviewer) {
    const now = NOW();
    const token = db.get('SELECT * FROM product_tokens WHERE id=?', [fields.token_id]);
    if (!token) throw new Error('Unknown token_id');
    const brand = fields.brand_id ? db.get('SELECT * FROM brands WHERE id=?', [fields.brand_id]) : null;
    const origin = fields.origin_id ? db.get('SELECT * FROM origins WHERE id=?', [fields.origin_id]) : null;
    const fmt = fields.display_pack_format || packFormat(fields.unit_size, fields.unit_measurement, fields.pack_count, fields.pack_unit);
    const displayKey = fields.display_key || [brand && brand.display_name, token.name_zh, origin && origin.name_zh, fields.variant, fmt].filter(Boolean).join(' | ');
    const fp = keyFingerprint({
      brand: brand && brand.display_name, token: token.name_zh, origin: origin && origin.name_zh,
      variant: fields.variant, unit_size: fields.unit_size, unit_measurement: fields.unit_measurement,
      pack_count: fields.pack_count, pack_unit: fields.pack_unit,
    });
    if (this.byFingerprint(db, fp)) throw new Error('DUPLICATE_PRODUCT_KEY');
    const code = fields.product_key_code || nextKeyCode(db);
    db.run(`INSERT INTO product_keys
      (product_key_code, brand_id, token_id, origin_id, variant, unit_size, unit_measurement, pack_count, pack_unit,
       display_pack_format, display_key, fingerprint, active, taxonomy_version, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      [code, brand ? brand.id : null, token.id, origin ? origin.id : null, fields.variant || null,
       fields.unit_size != null ? fields.unit_size : null, fields.unit_measurement || null,
       fields.pack_count != null ? fields.pack_count : null, fields.pack_unit || null,
       fmt, displayKey, fp, config.taxonomyVersion, now, now]);
    const row = db.get('SELECT * FROM product_keys WHERE product_key_code=?', [code]);
    Audit.log(db, 'product_key', row.id, 'CREATE', null, fields, reviewer, fields.reason);
    return this.get(db, row.id);
  },
};

function nextKeyCode(db) {
  const row = db.get("SELECT product_key_code FROM product_keys ORDER BY id DESC LIMIT 1");
  let n = 1;
  if (row && /^PK-(\d+)$/.test(row.product_key_code)) n = parseInt(RegExp.$1, 10) + 1;
  let code = `PK-${String(n).padStart(6, '0')}`;
  while (db.get('SELECT id FROM product_keys WHERE product_key_code=?', [code])) { n++; code = `PK-${String(n).padStart(6, '0')}`; }
  return code;
}

// ---------- SKUs ----------
const Skus = {
  list(db, { q, groupId, tokenId, keyId, reviewStatus, limit = 200, offset = 0 } = {}) {
    let sql = `
      SELECT s.*, g.name_zh AS group_name, t.name_zh AS token_name, k.display_key AS key_display
      FROM sku_records s
      LEFT JOIN large_groups g ON g.id=s.large_group_id
      LEFT JOIN product_tokens t ON t.id=s.product_token_id
      LEFT JOIN product_keys k ON k.id=s.product_key_id`;
    const conds = []; const params = [];
    if (groupId) { conds.push('s.large_group_id=?'); params.push(groupId); }
    if (tokenId) { conds.push('s.product_token_id=?'); params.push(tokenId); }
    if (keyId) { conds.push('s.product_key_id=?'); params.push(keyId); }
    if (reviewStatus) { conds.push('s.review_status=?'); params.push(reviewStatus); }
    if (q) { conds.push('(s.raw_sku_name LIKE ? OR s.external_sku_id LIKE ? OR s.barcode LIKE ?)'); const like = `%${q}%`; params.push(like, like, like); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY s.id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const rows = db.all(sql, params);
    // Enrich with per-Key cheapest ranking (full key membership).
    const keyIds = [...new Set(rows.map((r) => r.product_key_id).filter((x) => x != null))];
    const rankMap = keyRankMap(db, keyIds);
    return rows.map((r) => {
      const rk = rankMap[r.id] || {};
      return { ...r, cheapest_rank: rk.cheapest_rank, cheapest_group_size: rk.cheapest_group_size,
        is_cheapest: !!rk.is_cheapest, is_real_top1: !!rk.is_real_top1,
        real_rank: rk.real_rank, real_top1_offset: rk.real_top1_offset };
    });
  },
  count(db, filters = {}) { return this.list(db, { ...filters, limit: 100000 }).length; },
  get(db, id) {
    return db.get(`
      SELECT s.*, g.name_zh AS group_name, t.name_zh AS token_name, k.display_key AS key_display
      FROM sku_records s LEFT JOIN large_groups g ON g.id=s.large_group_id
      LEFT JOIN product_tokens t ON t.id=s.product_token_id
      LEFT JOIN product_keys k ON k.id=s.product_key_id WHERE s.id=?`, [id]);
  },
  byExternalId: (db, ext) => db.get('SELECT * FROM sku_records WHERE external_sku_id=?', [ext]),
  byBarcode: (db, bc) => db.get('SELECT * FROM sku_records WHERE barcode=?', [bc]),

  /** Upsert a SKU from import, then (optionally) apply a classification result. */
  upsert(db, rec, classification) {
    const now = NOW();
    const a = analyze(rec.raw_sku_name);
    let existing = null;
    if (rec.external_sku_id) existing = this.byExternalId(db, rec.external_sku_id);
    if (!existing && rec.barcode) existing = this.byBarcode(db, rec.barcode);

    const tokenId = classification && classification.product_token_id ? classification.product_token_id : (rec.product_token_id || null);
    const keyId = classification && classification.product_key_id ? classification.product_key_id : (rec.product_key_id || null);
    const groupId = classification && classification.large_group_id ? classification.large_group_id : (rec.large_group_id || null);
    const mappingStatus = keyId ? 'MAPPED' : (tokenId ? 'TOKEN_ONLY' : (classification && classification.requires_review ? 'REVIEW' : 'UNMAPPED'));
    const confidence = classification ? classification.confidence : null;
    const method = classification ? classification.match_method : null;
    const reviewStatus = classification ? (classification.requires_review ? 'PENDING' : 'NONE') : 'NONE';

    if (existing) {
      db.run(`UPDATE sku_records SET barcode=?, normalized_sku_name=?, product_key_id=?, product_token_id=?, large_group_id=?,
              sales_channel=?, last_seen_at=?, mapping_status=?, mapping_confidence=?, mapping_method=?, review_status=?, updated_at=? WHERE id=?`,
        [rec.barcode || existing.barcode, a.normalized_sku_name, keyId, tokenId, groupId,
         rec.sales_channel || existing.sales_channel, now, mappingStatus, confidence, method, reviewStatus, now, existing.id]);
      return { id: existing.id, created: false };
    }
    const ins = db.run(`INSERT INTO sku_records
      (external_sku_id, barcode, raw_sku_name, normalized_sku_name, product_key_id, product_token_id, large_group_id,
       sales_channel, variant_metadata, active, first_seen_at, last_seen_at, mapping_status, mapping_confidence, mapping_method, review_status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?)`,
      [rec.external_sku_id || null, rec.barcode || null, rec.raw_sku_name, a.normalized_sku_name, keyId, tokenId, groupId,
       rec.sales_channel || null, rec.variant_metadata ? JSON.stringify(rec.variant_metadata) : null,
       now, now, mappingStatus, confidence, method, reviewStatus, now, now]);
    return { id: ins.lastId, created: true };
  },
};

// ---------- Audit ----------
const Audit = {
  log(db, entityType, entityId, action, oldValue, newValue, reviewer, reason, sourceRef) {
    db.run(`INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, reviewer, reason, source_ref, taxonomy_version, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [entityType, entityId, action,
       oldValue != null ? JSON.stringify(oldValue) : null,
       newValue != null ? JSON.stringify(newValue) : null,
       reviewer || null, reason || null, sourceRef || null, config.taxonomyVersion, NOW()]);
  },
  list(db, { entityType, limit = 200 } = {}) {
    if (entityType) return db.all('SELECT * FROM audit_logs WHERE entity_type=? ORDER BY id DESC LIMIT ?', [entityType, limit]);
    return db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?', [limit]);
  },
};

// ---------- Overview stats ----------
function overview(db) {
  const c = (sql, p) => db.get(sql, p || []).c;
  return {
    large_groups: c('SELECT COUNT(*) c FROM large_groups WHERE active=1'),
    product_tokens: c('SELECT COUNT(*) c FROM product_tokens WHERE active=1'),
    product_keys: c('SELECT COUNT(*) c FROM product_keys WHERE active=1'),
    skus: c('SELECT COUNT(*) c FROM sku_records WHERE active=1'),
    skus_auto_matched: c("SELECT COUNT(*) c FROM sku_records WHERE review_status='NONE' AND mapping_status IN ('MAPPED','TOKEN_ONLY')"),
    skus_review: c("SELECT COUNT(*) c FROM sku_records WHERE review_status='PENDING'"),
    skus_unmatched: c("SELECT COUNT(*) c FROM sku_records WHERE mapping_status='UNMAPPED'"),
    tokens_without_keys: c('SELECT COUNT(*) c FROM product_tokens t WHERE NOT EXISTS (SELECT 1 FROM product_keys k WHERE k.token_id=t.id)'),
    keys_without_skus: c('SELECT COUNT(*) c FROM product_keys k WHERE NOT EXISTS (SELECT 1 FROM sku_records s WHERE s.product_key_id=k.id)'),
    missing_price: c('SELECT COUNT(*) c FROM sku_records s WHERE s.active=1 AND NOT EXISTS (SELECT 1 FROM sku_price_observations p WHERE p.sku_id=s.id)'),
    missing_stock: c('SELECT COUNT(*) c FROM sku_records s WHERE s.active=1 AND NOT EXISTS (SELECT 1 FROM sku_stock_observations o WHERE o.sku_id=s.id)'),
    // Online/offline (Tableau is_invisible) — joined by external sku_id. Visible=online, Invisible=offline.
    online_count: c("SELECT COUNT(*) c FROM sku_records s JOIN sku_operational_current soc ON soc.sku_id=s.external_sku_id WHERE s.active=1 AND soc.current_is_invisible=0"),
    offline_count: c("SELECT COUNT(*) c FROM sku_records s JOIN sku_operational_current soc ON soc.sku_id=s.external_sku_id WHERE s.active=1 AND soc.current_is_invisible=1"),
    visibility_unknown_count: c("SELECT COUNT(*) c FROM sku_records s LEFT JOIN sku_operational_current soc ON soc.sku_id=s.external_sku_id WHERE s.active=1 AND soc.current_is_invisible IS NULL"),
    last_visibility_refresh: (db.get("SELECT MAX(last_tableau_refresh_at) t FROM sku_operational_current") || {}).t || null,
    last_price_refresh: (db.get("SELECT MAX(finished_at) t FROM ingestion_runs WHERE data_type='PRICE' AND status='COMPLETED'") || {}).t || null,
    last_stock_refresh: (db.get("SELECT MAX(finished_at) t FROM ingestion_runs WHERE data_type='STOCK' AND status='COMPLETED'") || {}).t || null,
    recent_corrections: db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 10'),
  };
}

// ---------- Categories (Main Cat = large_groups, Sub Cat = sub_categories) ----------
// All queries are set-based and support server-side pagination; nothing loads a whole
// SKU table into memory. Counts join to the latest price/stock observation views.
const _latestPrice = `LEFT JOIN (
    SELECT sku_id, effective_price_minor, observed_at FROM (
      SELECT p.sku_id, p.effective_price_minor, p.observed_at,
        ROW_NUMBER() OVER (PARTITION BY p.sku_id ORDER BY p.observed_at DESC, p.id DESC) AS rn
      FROM sku_price_observations p
    ) WHERE rn = 1
  ) lp ON lp.sku_id = s.id`;
const _latestStock = `LEFT JOIN (
    SELECT sku_id, stock_status, observed_at FROM (
      SELECT o.sku_id, o.stock_status, o.observed_at,
        ROW_NUMBER() OVER (PARTITION BY o.sku_id ORDER BY o.observed_at DESC, o.id DESC) AS rn
      FROM sku_stock_observations o
    ) WHERE rn = 1
  ) ls ON ls.sku_id = s.id`;

// ---------- Cheapest ranking (per Product Key group) ----------
// "cheapest_rank": rank of the SKU within its Product Key by effective price (rank 1 = cheapest).
// "real_rank" (real top-1): the cheapest SKU that is currently IN STOCK. If the cheapest is
// out of stock, the real top-1 falls to the next cheapest in-stock SKU, and so on.
// A SKU has real_rank set ONLY if it is the in-stock "real top-1" of its key (real_rank===1
// meaning it is the buyable top pick). We expose:
//   cheapest_rank, cheapest_group_size, is_cheapest      -> normal logic
//   real_rank (=1 when this SKU is the real top-1), is_real_top1, real_top1_offset
// real_top1_offset = how many cheaper SKUs are out of stock above this real top-1
// (0 = cheapest is also real; 1 = cheapest OOS so 2nd is real top-1; etc.)

// Compute ranking for an arbitrary list of SKU row objects that each carry
// product_key_id, effective_price_minor, stock_status. Mutates + returns the rows.
// Ranking is done per product_key_id across the FULL key membership (not just the
// page passed in), so callers should pass the full-set rank map when paginating.
function computeKeyRanks(rows) {
  const byKey = {};
  for (const r of rows) {
    if (r.product_key_id == null) continue;
    (byKey[r.product_key_id] = byKey[r.product_key_id] || []).push(r);
  }
  for (const kid of Object.keys(byKey)) {
    const arr = byKey[kid].slice().sort((a, b) => {
      const pa = a.effective_price_minor, pb = b.effective_price_minor;
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;   // nulls last
      if (pb == null) return -1;
      return pa - pb;
    });
    const size = arr.length;
    // normal cheapest rank
    arr.forEach((r, i) => {
      r.cheapest_rank = i + 1;
      r.cheapest_group_size = size;
      r.is_cheapest = (i === 0);
    });
    // real top-1 = first in-stock in the price-sorted order
    const inStock = (r) => r.stock_status === 'IN_STOCK' || r.stock_status === 'LOW_STOCK';
    let realIdx = -1;
    for (let i = 0; i < arr.length; i++) { if (inStock(arr[i])) { realIdx = i; break; } }
    arr.forEach((r, i) => {
      r.is_real_top1 = (i === realIdx);
      r.real_rank = (i === realIdx) ? 1 : null;
      // offset: for the real top-1, how many cheaper SKUs above it are out of stock
      r.real_top1_offset = (i === realIdx) ? realIdx : null;
    });
  }
  return rows;
}

// Load the full key-membership rank map for a set of key ids (so pagination windows
// rank against the whole key, not just the visible page). Returns {skuId -> rank fields}.
function keyRankMap(db, keyIds) {
  if (!keyIds || !keyIds.length) return {};
  const ph = keyIds.map(() => '?').join(',');
  const rows = db.all(`
    SELECT s.id, s.product_key_id, lp.effective_price_minor, ls.stock_status
    FROM sku_records s ${_latestPrice} ${_latestStock}
    WHERE s.active=1 AND s.product_key_id IN (${ph})`, keyIds);
  computeKeyRanks(rows);
  const map = {};
  for (const r of rows) {
    map[r.id] = {
      cheapest_rank: r.cheapest_rank, cheapest_group_size: r.cheapest_group_size,
      is_cheapest: r.is_cheapest, is_real_top1: r.is_real_top1,
      real_rank: r.real_rank, real_top1_offset: r.real_top1_offset,
    };
  }
  return map;
}

// Overview: of all keys' "cheapest" (rank-1) SKUs, how many are ALSO the real top-1
// (i.e. the cheapest is in stock) vs NOT (cheapest is OOS, so a pricier SKU is the buyable top).
function cheapestRealOverview(db) {
  const rows = db.all(`
    SELECT s.id, s.product_key_id, lp.effective_price_minor, ls.stock_status
    FROM sku_records s ${_latestPrice} ${_latestStock}
    WHERE s.active=1 AND s.product_key_id IS NOT NULL`, []);
  computeKeyRanks(rows);
  let cheapest_total = 0, cheapest_is_real = 0, cheapest_not_real = 0;
  let real_substituted = 0; // keys where the real top-1 is NOT the cheapest (someone cheaper is OOS)
  for (const r of rows) {
    if (r.is_cheapest) {
      cheapest_total++;
      if (r.is_real_top1) cheapest_is_real++; else cheapest_not_real++;
    }
    if (r.is_real_top1 && r.real_top1_offset > 0) real_substituted++;
  }
  return {
    cheapest_total,
    cheapest_is_real,          // cheapest top-1 IS the real top-1 (cheapest in stock)
    cheapest_not_real,         // cheapest top-1 is OOS (NOT the real top-1)
    real_substituted,          // keys whose real top-1 is a pricier substitute
    keys_total: cheapest_total,
  };
}

// Drill-down for the 最平/有貨 Top1 總覽 cards. kind:
//   'is-real'      -> keys where cheapest top-1 IS the real top-1 (cheapest in stock)
//   'not-real'     -> keys where the cheapest is OOS (NOT the real top-1) — show the cheapest (OOS) SKU
//   'substituted'  -> keys whose real top-1 is a pricier substitute — show the real top-1 SKU
// Returns {total, rows} paginated. Each row: one representative SKU per Product Key.
function cheapestRealDrill(db, kind, { limit = 50, offset = 0 } = {}) {
  limit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  offset = Math.max(parseInt(offset, 10) || 0, 0);
  const rows = db.all(`
    SELECT s.id, s.external_sku_id AS sku_id, s.raw_sku_name AS product_name,
           s.product_key_id, k.display_key, g.name_zh AS main_cat, sc.name_zh AS sub_cat,
           t.name_zh AS token_name, b.display_name AS brand,
           lp.effective_price_minor, ls.stock_status
    FROM sku_records s
    LEFT JOIN product_keys k ON k.id=s.product_key_id
    LEFT JOIN large_groups g ON g.id=s.large_group_id
    LEFT JOIN sub_categories sc ON sc.id=s.sub_category_id
    LEFT JOIN product_tokens t ON t.id=s.product_token_id
    LEFT JOIN brands b ON b.id=k.brand_id
    ${_latestPrice} ${_latestStock}
    WHERE s.active=1 AND s.product_key_id IS NOT NULL`, []);
  computeKeyRanks(rows);
  // pick the representative SKU per kind
  let picked = rows.filter((r) => {
    if (kind === 'is-real') return r.is_cheapest && r.is_real_top1;
    if (kind === 'not-real') return r.is_cheapest && !r.is_real_top1;
    if (kind === 'substituted') return r.is_real_top1 && r.real_top1_offset > 0;
    return false;
  });
  // stable order by main_cat then sku
  picked.sort((a, b) => String(a.main_cat || '').localeCompare(String(b.main_cat || '')) || String(a.sku_id).localeCompare(String(b.sku_id)));
  const total = picked.length;
  const pageRows = picked.slice(offset, offset + limit).map((r) => ({
    sku_id: r.sku_id, product_name: r.product_name, display_key: r.display_key,
    main_cat: r.main_cat, sub_cat: r.sub_cat, token_name: r.token_name, brand: r.brand,
    discount_price: r.effective_price_minor != null ? r.effective_price_minor / 100 : null,
    stock_status: r.stock_status,
    cheapest_rank: r.cheapest_rank, cheapest_group_size: r.cheapest_group_size,
    is_cheapest: r.is_cheapest, is_real_top1: r.is_real_top1, real_top1_offset: r.real_top1_offset,
  }));
  return { total, rows: pageRows };
}

const Categories = {
  // Main Cat cards: per-group rollup incl. operational counts.
  mainList(db) {
    return db.all(`
      SELECT g.id, g.group_code AS code, g.name_zh AS name, g.display_order, g.active,
        (SELECT COUNT(*) FROM sub_categories sc WHERE sc.large_group_id=g.id AND sc.active=1) AS subcat_count,
        (SELECT COUNT(*) FROM sku_records s WHERE s.large_group_id=g.id AND s.active=1) AS sku_count,
        (SELECT COUNT(*) FROM sku_records s WHERE s.large_group_id=g.id AND s.active=1 AND s.review_status='PENDING') AS review_count,
        (SELECT COUNT(*) FROM sku_records s ${_latestPrice} WHERE s.large_group_id=g.id AND s.active=1 AND lp.sku_id IS NULL) AS missing_price_count,
        (SELECT COUNT(*) FROM sku_records s ${_latestStock} WHERE s.large_group_id=g.id AND s.active=1 AND ls.sku_id IS NULL) AS missing_stock_count,
        (SELECT COUNT(*) FROM sku_records s ${_latestStock} WHERE s.large_group_id=g.id AND s.active=1 AND ls.stock_status='IN_STOCK') AS in_stock_count,
        (SELECT COUNT(*) FROM sku_records s ${_latestStock} WHERE s.large_group_id=g.id AND s.active=1 AND ls.stock_status='OUT_OF_STOCK') AS out_of_stock_count
      FROM large_groups g WHERE g.active=1 ORDER BY g.display_order`);
  },

  // Sub Cats under one Main Cat (by group code), with per-subcat counts.
  subList(db, groupCode, { sort = 'order', includeInactive = false } = {}) {
    const g = db.get('SELECT * FROM large_groups WHERE group_code=?', [groupCode]);
    if (!g) return null;
    const orderBy = {
      order: 'sc.display_order ASC',
      count_desc: 'sku_count DESC, sc.display_order ASC',
      count_asc: 'sku_count ASC, sc.display_order ASC',
      name: 'sc.name_zh ASC',
    }[sort] || 'sc.display_order ASC';
    const rows = db.all(`
      SELECT sc.id, sc.sub_cat_code AS code, sc.name_zh AS name, sc.description,
             sc.display_order, sc.active,
        (SELECT COUNT(*) FROM sku_records s WHERE s.sub_category_id=sc.id AND s.active=1) AS sku_count,
        (SELECT COUNT(*) FROM sku_records s WHERE s.sub_category_id=sc.id AND s.active=1 AND s.review_status='PENDING') AS review_count,
        (SELECT COUNT(*) FROM product_tokens t WHERE t.sub_category_id=sc.id) AS token_count,
        (SELECT COUNT(*) FROM sku_records s ${_latestPrice} WHERE s.sub_category_id=sc.id AND s.active=1 AND lp.sku_id IS NULL) AS missing_price_count,
        (SELECT COUNT(*) FROM sku_records s ${_latestStock} WHERE s.sub_category_id=sc.id AND s.active=1 AND ls.sku_id IS NULL) AS missing_stock_count,
        (SELECT COUNT(*) FROM sku_records s ${_latestStock} WHERE s.sub_category_id=sc.id AND s.active=1 AND ls.stock_status='IN_STOCK') AS in_stock_count,
        (SELECT COUNT(*) FROM sku_records s ${_latestStock} WHERE s.sub_category_id=sc.id AND s.active=1 AND ls.stock_status='OUT_OF_STOCK') AS out_of_stock_count
      FROM sub_categories sc
      WHERE sc.large_group_id=? ${includeInactive ? '' : 'AND sc.active=1'}
      ORDER BY ${orderBy}`, [g.id]);
    return { main_cat: { code: g.group_code, name: g.name_zh }, sub_cats: rows };
  },

  getSub(db, subCatCode) {
    return db.get(`SELECT sc.*, g.group_code AS main_code, g.name_zh AS main_name
                   FROM sub_categories sc JOIN large_groups g ON g.id=sc.large_group_id
                   WHERE sc.sub_cat_code=?`, [subCatCode]);
  },

  // Distinct brands present in one Sub Cat (for the brand filter dropdown).
  brandsInSub(db, subCatCode) {
    const sc = this.getSub(db, subCatCode);
    if (!sc) return null;
    return db.all(`
      SELECT DISTINCT b.display_name AS brand
      FROM sku_records s
      JOIN product_keys k ON k.id = s.product_key_id
      JOIN brands b ON b.id = k.brand_id
      WHERE s.sub_category_id=? AND s.active=1 AND b.display_name IS NOT NULL
      ORDER BY b.display_name`, [sc.id]).map((r) => r.brand);
  },

  // Product Tokens present in one Sub Cat (with live SKU counts), for the
  // 分類瀏覽 drill-down: Main Cat → Sub Cat → 產品符號 → SKUs. Tokens are shown
  // whether or not the token's own sub_category_id matches (we count by SKU),
  // so a token appears as long as at least one active SKU maps to it in this subcat.
  tokensInSub(db, subCatCode) {
    const sc = this.getSub(db, subCatCode);
    if (!sc) return null;
    const rows = db.all(`
      SELECT t.id, t.token_code AS code, t.name_zh AS name,
        COUNT(s.id) AS sku_count,
        SUM(CASE WHEN ls.stock_status='IN_STOCK' THEN 1 ELSE 0 END) AS in_stock_count,
        SUM(CASE WHEN ls.stock_status='LOW_STOCK' THEN 1 ELSE 0 END) AS low_stock_count,
        SUM(CASE WHEN ls.stock_status='OUT_OF_STOCK' THEN 1 ELSE 0 END) AS out_of_stock_count
      FROM product_tokens t
      JOIN sku_records s ON s.product_token_id = t.id AND s.active=1 AND s.sub_category_id=?
      ${_latestStock}
      GROUP BY t.id
      ORDER BY t.priority DESC, t.name_zh`, [sc.id]);
    return {
      main_cat: { code: sc.main_code, name: sc.main_name },
      sub_cat: { code: sc.sub_cat_code, name: sc.name_zh },
      tokens: rows,
    };
  },

  // Paginated, filtered SKU list for one Sub Cat. Server-side only.
  skusInSub(db, subCatCode, opts = {}) {
    const sc = this.getSub(db, subCatCode);
    if (!sc) return null;
    let page = parseInt(opts.page, 10); if (!(page >= 1)) page = 1;
    let pageSize = parseInt(opts.page_size, 10); if (!(pageSize >= 1)) pageSize = 30;
    if (pageSize > 100) pageSize = 100;

    const where = ['s.sub_category_id = ?', 's.active = 1'];
    const params = [sc.id];
    if (opts.sku_id) { where.push('s.external_sku_id = ?'); params.push(String(opts.sku_id).trim()); }
    if (opts.brand) { where.push('b.display_name = ?'); params.push(opts.brand); }
    if (opts.product_token) { where.push('t.name_zh = ?'); params.push(opts.product_token); }
    if (opts.token_id) { const tid = parseInt(opts.token_id, 10); if (tid >= 1) { where.push('s.product_token_id = ?'); params.push(tid); } }
    if (opts.review_status) { where.push('s.review_status = ?'); params.push(opts.review_status); }
    if (opts.visibility === 'visible') where.push("COALESCE(soc.current_is_invisible,0)=0");
    else if (opts.visibility === 'invisible') where.push('soc.current_is_invisible=1');
    if (opts.stock_status) { where.push('ls.stock_status = ?'); params.push(opts.stock_status); }
    if (opts.missing_price === '1' || opts.missing_price === 'true') where.push('lp.sku_id IS NULL');
    if (opts.missing_stock === '1' || opts.missing_stock === 'true') where.push('ls.sku_id IS NULL');
    if (opts.keyword) {
      where.push('(s.raw_sku_name LIKE ? OR s.external_sku_id LIKE ? OR b.display_name LIKE ? OR k.display_pack_format LIKE ?)');
      const kw = `%${opts.keyword}%`; params.push(kw, kw, kw, kw);
    }
    const whereSql = where.join(' AND ');

    const sortCol = {
      sku_id: 's.external_sku_id', name: 's.raw_sku_name', brand: 'b.display_name',
      price: 'lp.effective_price_minor', stock: 'ls.stock_status', token: 't.name_zh',
    }[opts.sort_by] || 's.external_sku_id';
    const sortDir = String(opts.sort_order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const total = db.get(`
      SELECT COUNT(*) c FROM sku_records s
      LEFT JOIN product_keys k ON k.id=s.product_key_id
      LEFT JOIN brands b ON b.id=k.brand_id
      LEFT JOIN product_tokens t ON t.id=s.product_token_id
      LEFT JOIN sku_operational_current soc ON soc.sku_id = s.external_sku_id
      ${_latestPrice} ${_latestStock}
      WHERE ${whereSql}`, params).c;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (page > totalPages) page = totalPages;

    const rows = db.all(`
      SELECT s.id, s.external_sku_id AS sku_id, s.raw_sku_name AS product_name,
             s.review_status, s.mapping_confidence, s.product_key_id,
             b.display_name AS brand, k.display_pack_format AS packing_spec,
             t.name_zh AS product_token, g.name_zh AS main_cat, sc.name_zh AS sub_cat,
             lp.effective_price_minor, lp.observed_at AS price_updated_at,
             ls.stock_status, ls.observed_at AS stock_updated_at,
             soc.current_is_invisible
      FROM sku_records s
      LEFT JOIN product_keys k ON k.id=s.product_key_id
      LEFT JOIN brands b ON b.id=k.brand_id
      LEFT JOIN product_tokens t ON t.id=s.product_token_id
      LEFT JOIN large_groups g ON g.id=s.large_group_id
      LEFT JOIN sub_categories sc ON sc.id=s.sub_category_id
      LEFT JOIN sku_operational_current soc ON soc.sku_id = s.external_sku_id
      ${_latestPrice} ${_latestStock}
      WHERE ${whereSql}
      ORDER BY ${sortCol} ${sortDir}, s.id ASC
      LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);

    // Enrich with per-Key cheapest ranking (against FULL key membership, not just this page).
    const keyIds = [...new Set(rows.map((r) => r.product_key_id).filter((x) => x != null))];
    const rankMap = keyRankMap(db, keyIds);

    return {
      main_cat: { code: sc.main_code, name: sc.main_name },
      sub_cat: { code: sc.sub_cat_code, name: sc.name_zh },
      pagination: { page, page_size: pageSize, total_rows: total, total_pages: totalPages },
      rows: rows.map((r) => {
        const rk = rankMap[r.id] || {};
        return {
          ...r,
          discount_price: r.effective_price_minor != null ? r.effective_price_minor / 100 : null,
          is_invisible: r.current_is_invisible == null ? null : !!r.current_is_invisible,
          cheapest_rank: rk.cheapest_rank, cheapest_group_size: rk.cheapest_group_size,
          is_cheapest: !!rk.is_cheapest, is_real_top1: !!rk.is_real_top1,
          real_rank: rk.real_rank, real_top1_offset: rk.real_top1_offset,
          effective_price_minor: undefined, current_is_invisible: undefined,
        };
      }),
    };
  },

  // Overview additions: Sub Cat metrics for the dashboard overview page.
  subcatOverview(db) {
    const c = (sql, p) => db.get(sql, p || []).c;
    return {
      total_subcats: c('SELECT COUNT(*) c FROM sub_categories WHERE active=1'),
      skus_missing_subcat: c('SELECT COUNT(*) c FROM sku_records WHERE active=1 AND sub_category_id IS NULL'),
      subcat_conflicts: c(`SELECT COUNT(*) c FROM sku_records s JOIN sub_categories sc ON sc.id=s.sub_category_id
                           WHERE s.large_group_id IS NOT NULL AND sc.large_group_id <> s.large_group_id`),
      largest_subcat: db.get(`SELECT sc.name_zh name, COUNT(*) cnt FROM sku_records s
                              JOIN sub_categories sc ON sc.id=s.sub_category_id WHERE s.active=1
                              GROUP BY sc.id ORDER BY cnt DESC LIMIT 1`),
      subcats_with_missing_price: c(`SELECT COUNT(DISTINCT s.sub_category_id) c FROM sku_records s ${_latestPrice}
                                     WHERE s.active=1 AND s.sub_category_id IS NOT NULL AND lp.sku_id IS NULL`),
      subcats_with_missing_stock: c(`SELECT COUNT(DISTINCT s.sub_category_id) c FROM sku_records s ${_latestStock}
                                     WHERE s.active=1 AND s.sub_category_id IS NOT NULL AND ls.sku_id IS NULL`),
      subcats_requiring_review: c(`SELECT COUNT(DISTINCT sub_category_id) c FROM sku_records
                                   WHERE active=1 AND sub_category_id IS NOT NULL AND review_status='PENDING'`),
      sku_count_by_cat: db.all(`SELECT g.name_zh main_cat, sc.name_zh sub_cat, COUNT(s.id) cnt
                                FROM sub_categories sc JOIN large_groups g ON g.id=sc.large_group_id
                                LEFT JOIN sku_records s ON s.sub_category_id=sc.id AND s.active=1
                                WHERE sc.active=1 GROUP BY sc.id
                                HAVING cnt > 0 ORDER BY g.display_order, sc.display_order`),
    };
  },

  // ===== Stock drill-down (總覽 有貨/缺貨 -> Main Cat -> Sub Cat -> Product Token -> SKU) =====
  // status: 'IN_STOCK' | 'OUT_OF_STOCK'. Each level rolls up counts of SKUs with that status.
  StockDrill: {
    _cond(status) {
      const s = String(status).toUpperCase();
      if (s === 'OUT_OF_STOCK') return "ls.stock_status='OUT_OF_STOCK'";
      if (s === 'LOW_STOCK') return "ls.stock_status='LOW_STOCK'";
      return "ls.stock_status='IN_STOCK'";
    },
    main(db, status) {
      const cond = this._cond(status);
      return db.all(`
        SELECT g.group_code AS code, g.name_zh AS name,
          (SELECT COUNT(*) FROM sku_records s ${_latestStock} WHERE s.large_group_id=g.id AND s.active=1 AND ${cond}) AS cnt
        FROM large_groups g WHERE g.active=1
          AND (SELECT COUNT(*) FROM sku_records s ${_latestStock} WHERE s.large_group_id=g.id AND s.active=1 AND ${cond}) > 0
        ORDER BY g.display_order`);
    },
    sub(db, status, groupCode) {
      const cond = this._cond(status);
      const g = db.get('SELECT id FROM large_groups WHERE group_code=?', [groupCode]);
      if (!g) return null;
      return db.all(`
        SELECT sc.sub_cat_code AS code, sc.name_zh AS name,
          (SELECT COUNT(*) FROM sku_records s ${_latestStock} WHERE s.sub_category_id=sc.id AND s.active=1 AND ${cond}) AS cnt
        FROM sub_categories sc WHERE sc.large_group_id=? AND sc.active=1
          AND (SELECT COUNT(*) FROM sku_records s ${_latestStock} WHERE s.sub_category_id=sc.id AND s.active=1 AND ${cond}) > 0
        ORDER BY sc.display_order`, [g.id]);
    },
    tokens(db, status, subCatCode) {
      const cond = this._cond(status);
      const sc = db.get('SELECT id FROM sub_categories WHERE sub_cat_code=?', [subCatCode]);
      if (!sc) return null;
      return db.all(`
        SELECT t.id, t.token_code AS code, t.name_zh AS name,
          (SELECT COUNT(*) FROM sku_records s ${_latestStock} WHERE s.product_token_id=t.id AND s.active=1 AND ${cond}) AS cnt
        FROM product_tokens t WHERE t.sub_category_id=? AND t.active=1
          AND (SELECT COUNT(*) FROM sku_records s ${_latestStock} WHERE s.product_token_id=t.id AND s.active=1 AND ${cond}) > 0
        ORDER BY t.priority DESC, t.name_zh`, [sc.id]);
    },
    // SKUs of one Product Token with the given stock status, each ranked within its Product Key
    // group by effective price (rank 1 = cheapest). Ranking uses the shared computeKeyRanks
    // against the FULL key membership so a filtered view still ranks correctly.
    skus(db, status, tokenId) {
      const cond = this._cond(status);
      const rows = db.all(`
        SELECT s.id, s.external_sku_id AS sku_id, s.raw_sku_name AS product_name,
               s.product_key_id, k.display_key, k.display_pack_format AS packing_spec,
               b.display_name AS brand,
               lp.effective_price_minor, ls.stock_status, ls.observed_at AS stock_updated_at
        FROM sku_records s
        LEFT JOIN product_keys k ON k.id=s.product_key_id
        LEFT JOIN brands b ON b.id=k.brand_id
        ${_latestPrice} ${_latestStock}
        WHERE s.product_token_id=? AND s.active=1 AND ${cond}
        ORDER BY k.display_key, lp.effective_price_minor`, [tokenId]);
      // Rank against full key membership (the token filter may hide same-key siblings).
      const keyIds = [...new Set(rows.map((r) => r.product_key_id).filter((x) => x != null))];
      const rankMap = keyRankMap(db, keyIds);
      return rows.map((r) => {
        const rk = rankMap[r.id] || {};
        return {
          ...r,
          discount_price: r.effective_price_minor != null ? r.effective_price_minor / 100 : null,
          // keep legacy field names for the existing UI, plus the new real-top1 fields
          key_rank: rk.cheapest_rank, key_group_size: rk.cheapest_group_size, is_cheapest: !!rk.is_cheapest,
          cheapest_rank: rk.cheapest_rank, cheapest_group_size: rk.cheapest_group_size,
          is_real_top1: !!rk.is_real_top1, real_rank: rk.real_rank, real_top1_offset: rk.real_top1_offset,
          effective_price_minor: undefined,
        };
      });
    },
  },

  // Taxonomy editor: update a Sub Cat (name/description/order/active).
  updateSub(db, subCatCode, fields, reviewer) {
    const sc = this.getSub(db, subCatCode);
    if (!sc) return null;
    db.run('UPDATE sub_categories SET name_zh=?, description=?, display_order=?, active=?, updated_at=? WHERE id=?', [
      fields.name_zh !== undefined ? fields.name_zh : sc.name_zh,
      fields.description !== undefined ? fields.description : sc.description,
      fields.display_order !== undefined ? fields.display_order : sc.display_order,
      fields.active !== undefined ? (fields.active ? 1 : 0) : sc.active,
      NOW(), sc.id,
    ]);
    Audit.log(db, 'sub_category', sc.id, 'UPDATE', sc, fields, reviewer, fields.reason);
    return this.getSub(db, subCatCode);
  },
};

// ---------- Stat drill (總覽 top-card drill-downs) ----------
// Generic per-kind row queries; server clamps limit/offset. Each returns {total, rows}.
function statDrill(db, kind, { limit = 50, offset = 0 } = {}) {
  limit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  offset = Math.max(parseInt(offset, 10) || 0, 0);
  const cnt = (sql, p) => (db.get(sql, p || []) || {}).c || 0;
  const page = (rowsSql, countSql, params) => ({
    total: cnt(countSql, params),
    rows: db.all(rowsSql + ' LIMIT ? OFFSET ?', (params || []).concat([limit, offset])),
  });
  const SKU_BASE = `FROM sku_records s
      LEFT JOIN large_groups g ON g.id=s.large_group_id
      LEFT JOIN product_tokens t ON t.id=s.product_token_id
      LEFT JOIN product_keys k ON k.id=s.product_key_id`;
  const SKU_COLS = `s.external_sku_id, s.raw_sku_name, g.name_zh AS group_name, t.name_zh AS token_name, s.mapping_status, s.mapping_confidence, s.review_status`;
  switch (kind) {
    case 'large-groups':
      return page(
        `SELECT g.group_code, g.name_zh,
           (SELECT COUNT(*) FROM product_tokens t WHERE t.large_group_id=g.id) AS token_count,
           (SELECT COUNT(*) FROM product_keys k JOIN product_tokens t ON t.id=k.token_id WHERE t.large_group_id=g.id) AS key_count,
           (SELECT COUNT(*) FROM sku_records s WHERE s.large_group_id=g.id) AS sku_count
         FROM large_groups g WHERE g.active=1 ORDER BY g.display_order`,
        'SELECT COUNT(*) c FROM large_groups WHERE active=1');
    case 'tokens':
      return page(
        `SELECT t.token_code, t.name_zh AS name, g.name_zh AS group_name,
           (SELECT COUNT(*) FROM product_keys k WHERE k.token_id=t.id) AS key_count,
           (SELECT COUNT(*) FROM sku_records s WHERE s.product_token_id=t.id) AS sku_count
         FROM product_tokens t JOIN large_groups g ON g.id=t.large_group_id WHERE t.active=1 ORDER BY t.priority DESC, t.id`,
        'SELECT COUNT(*) c FROM product_tokens WHERE active=1');
    case 'keys':
      return page(
        `SELECT k.product_key_code, k.display_key AS display, t.name_zh AS token_name,
           (SELECT COUNT(*) FROM sku_records s WHERE s.product_key_id=k.id) AS sku_count
         FROM product_keys k JOIN product_tokens t ON t.id=k.token_id WHERE k.active=1 ORDER BY k.id`,
        'SELECT COUNT(*) c FROM product_keys WHERE active=1');
    case 'skus':
      return page(
        `SELECT ${SKU_COLS} ${SKU_BASE} WHERE s.active=1 ORDER BY s.id`,
        'SELECT COUNT(*) c FROM sku_records WHERE active=1');
    case 'auto-matched':
      return page(
        `SELECT ${SKU_COLS} ${SKU_BASE} WHERE s.review_status='NONE' AND s.mapping_status IN ('MAPPED','TOKEN_ONLY') ORDER BY s.id`,
        "SELECT COUNT(*) c FROM sku_records WHERE review_status='NONE' AND mapping_status IN ('MAPPED','TOKEN_ONLY')");
    case 'review':
      return page(
        `SELECT ${SKU_COLS} ${SKU_BASE} WHERE s.review_status='PENDING' ORDER BY s.id`,
        "SELECT COUNT(*) c FROM sku_records WHERE review_status='PENDING'");
    case 'tokens-no-keys':
      return page(
        `SELECT t.token_code, t.name_zh AS name, g.name_zh AS group_name,
           (SELECT COUNT(*) FROM sku_records s WHERE s.product_token_id=t.id) AS sku_count
         FROM product_tokens t JOIN large_groups g ON g.id=t.large_group_id
         WHERE NOT EXISTS (SELECT 1 FROM product_keys k WHERE k.token_id=t.id) ORDER BY t.id`,
        'SELECT COUNT(*) c FROM product_tokens t WHERE NOT EXISTS (SELECT 1 FROM product_keys k WHERE k.token_id=t.id)');
    case 'keys-no-skus':
      return page(
        `SELECT k.product_key_code, k.display_key AS display, t.name_zh AS token_name
         FROM product_keys k JOIN product_tokens t ON t.id=k.token_id
         WHERE NOT EXISTS (SELECT 1 FROM sku_records s WHERE s.product_key_id=k.id) ORDER BY k.id`,
        'SELECT COUNT(*) c FROM product_keys k WHERE NOT EXISTS (SELECT 1 FROM sku_records s WHERE s.product_key_id=k.id)');
    case 'missing-price':
      return page(
        `SELECT ${SKU_COLS} ${SKU_BASE} WHERE s.active=1 AND NOT EXISTS (SELECT 1 FROM sku_price_observations p WHERE p.sku_id=s.id) ORDER BY s.id`,
        'SELECT COUNT(*) c FROM sku_records s WHERE s.active=1 AND NOT EXISTS (SELECT 1 FROM sku_price_observations p WHERE p.sku_id=s.id)');
    default:
      return null;
  }
}

module.exports = { Groups, Tokens, Keys, Skus, Audit, Categories, overview, statDrill, cheapestRealOverview, cheapestRealDrill, keyRankMap, computeKeyRanks, packFormat, trimNum };

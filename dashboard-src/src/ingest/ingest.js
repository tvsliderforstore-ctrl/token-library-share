'use strict';
/**
 * ingest.js — price/stock ingestion service (spec §13, §17, §18, §19).
 *
 * Wraps EXISTING Hermes skills via adapters (never re-implements collection).
 * Observations are append-only. A failed refresh preserves previous valid data.
 * Duplicate concurrent runs per data_type are blocked by a partial unique index.
 */
const config = require('../config');
const { matchKey } = require('../lib/normalize');

const NOW = () => new Date().toISOString();

// ---------- Adapters (transform existing-skill output -> standard contract) ----------
const Adapters = {
  /**
   * Stock adapter for the existing `stock-status-checker` skill.
   * Input: array of that skill's per-SKU JSON results (or single object).
   * The skill emits: {sku, url, in_stock, stock_state, price_hkd, product_name, checked_at, ...}
   */
  stock(rawResults, runMeta) {
    const arr = Array.isArray(rawResults) ? rawResults : [rawResults];
    const records = arr.map((r) => ({
      external_sku_id: r.sku || r.external_sku_id || null,
      barcode: r.barcode || null,
      sku_name: r.product_name || r.sku_name || r.sku || '',
      location_id: r.location_id || null,
      location_name: r.location_name || null,
      sales_channel: r.sales_channel || 'HKTVmall',
      stock_status: mapStockState(r.stock_state, r.in_stock),
      available_quantity: numOrNull(r.available_quantity),
      reserved_quantity: numOrNull(r.reserved_quantity),
      incoming_quantity: numOrNull(r.incoming_quantity),
      expected_restock_at: r.expected_restock_at || null,
      observed_at: r.checked_at || r.observed_at || NOW(),
      raw_value: r.raw_signal || r.stock_state || null,
    }));
    return {
      data_type: 'stock',
      retrieved_at: NOW(),
      source_skill: runMeta.skillName,
      source: runMeta.source,
      records,
    };
  },

  /**
   * Price adapter for the existing `psos-discount-report-download` skill output.
   * Accepts parsed PSOS discount rows. RSP (原價) and PSP (特價) map to
   * regular/promotional price. Missing price stays null (never 0).
   */
  price(rawRows, runMeta) {
    const arr = Array.isArray(rawRows) ? rawRows : [rawRows];
    const records = arr.map((r) => {
      const regular = moneyToMinor(r.regular_price != null ? r.regular_price : r.rsp);
      const promo = moneyToMinor(r.promotional_price != null ? r.promotional_price : r.psp);
      return {
        external_sku_id: r.external_sku_id || r.sku || null,
        barcode: r.barcode || null,
        sku_name: r.sku_name || r.product_name || '',
        regular_price_minor: regular,
        promotional_price_minor: promo,
        currency: r.currency || config.currency,
        promotion_name: r.promotion_name || null,
        promotion_start_at: r.promotion_start_at || null,
        promotion_end_at: r.promotion_end_at || null,
        sales_channel: r.sales_channel || runMeta.source,
        observed_at: r.observed_at || NOW(),
      };
    });
    return { data_type: 'price', retrieved_at: NOW(), source_skill: runMeta.skillName, source: runMeta.source, records };
  },
};

function mapStockState(state, inStock) {
  const s = String(state || '').toLowerCase();
  if (s === 'in_stock') return 'IN_STOCK';
  if (s === 'out_of_stock') return 'OUT_OF_STOCK';
  if (s === 'delisted' || s === 'offline') return 'DISCONTINUED';
  if (s === 'low_stock') return 'LOW_STOCK';
  if (s === 'preorder') return 'PREORDER';
  if (s === 'unknown') return 'UNKNOWN';
  if (inStock === true) return 'IN_STOCK';
  if (inStock === false) return 'OUT_OF_STOCK';
  return 'UNKNOWN';
}
function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function moneyToMinor(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100); // store cents; never binary float
}

// ---------- Operational mapping (spec §17) ----------
function mapRecordToSku(db, rec) {
  // 1. exact external SKU id
  if (rec.external_sku_id) {
    const s = db.get('SELECT id FROM sku_records WHERE external_sku_id=?', [rec.external_sku_id]);
    if (s) return { sku_id: s.id, status: 'MATCHED', method: 'EXTERNAL_SKU_ID' };
  }
  // 2. exact barcode
  if (rec.barcode) {
    const s = db.get('SELECT id FROM sku_records WHERE barcode=?', [rec.barcode]);
    if (s) return { sku_id: s.id, status: 'MATCHED', method: 'BARCODE' };
  }
  // 3. confirmed exact normalized name
  if (rec.sku_name) {
    const s = db.get("SELECT id FROM sku_records WHERE normalized_sku_name=? AND review_status='CONFIRMED'", [matchKey(rec.sku_name)]);
    if (s) return { sku_id: s.id, status: 'MATCHED', method: 'EXACT_NAME' };
  }
  // 5. token-level candidate -> review (do NOT broadcast to all SKUs under a token)
  if (rec.sku_name) {
    const key = matchKey(rec.sku_name);
    const token = db.get(`SELECT t.id FROM product_tokens t WHERE t.active=1 AND instr(?, lower(t.name_zh))>0 LIMIT 1`, [key]);
    if (token) return { sku_id: null, token_id: token.id, status: 'REVIEW', method: 'TOKEN_CANDIDATE' };
  }
  return { sku_id: null, status: 'UNMATCHED', method: 'NONE' };
}

// ---------- Ingestion run lifecycle ----------
function startRun(db, dataType, sourceSkill, triggeredBy) {
  // Duplicate-run lock via partial unique index; catch constraint error.
  try {
    const ins = db.run(
      `INSERT INTO ingestion_runs (data_type, status, source_skill, started_at, triggered_by) VALUES (?,'RUNNING',?,?,?)`,
      [dataType, sourceSkill || null, NOW(), triggeredBy || 'manual']);
    return { ok: true, runId: ins.lastId };
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) return { ok: false, error: 'RUN_ALREADY_IN_PROGRESS' };
    throw e;
  }
}

function finishRun(db, runId, status, counts, errorMessage) {
  db.run(`UPDATE ingestion_runs SET status=?, finished_at=?, records_total=?, records_ok=?, records_ambiguous=?, records_invalid=?, error_message=? WHERE id=?`,
    [status, NOW(), counts.total, counts.ok, counts.ambiguous, counts.invalid, errorMessage || null, runId]);
}

/**
 * Ingest a standardized batch (already adapter-transformed) into observations.
 * Append-only. Ambiguous -> mapping_reviews. Invalid -> ingestion_errors.
 */
function ingestStandard(db, runId, standard) {
  const isPrice = standard.data_type === 'price';
  const counts = { total: standard.records.length, ok: 0, ambiguous: 0, invalid: 0 };
  const now = NOW();
  for (const rec of standard.records) {
    try {
      // validation
      if (isPrice && rec.regular_price_minor == null && rec.promotional_price_minor == null && !rec.external_sku_id && !rec.sku_name) {
        throw new Error('Missing both price and identifiers');
      }
      if (!isPrice && !rec.stock_status) rec.stock_status = 'UNKNOWN';
      const mapping = mapRecordToSku(db, rec);
      db.run(`INSERT INTO ingestion_source_records (ingestion_run_id, data_type, raw_record, mapped_sku_id, mapping_status, created_at) VALUES (?,?,?,?,?,?)`,
        [runId, standard.data_type.toUpperCase(), JSON.stringify(rec), mapping.sku_id, mapping.status, now]);

      if (mapping.status === 'MATCHED') {
        if (isPrice) {
          const effective = rec.promotional_price_minor != null ? rec.promotional_price_minor : rec.regular_price_minor;
          db.run(`INSERT INTO sku_price_observations
            (sku_id, regular_price_minor, promotional_price_minor, effective_price_minor, currency, promotion_name,
             promotion_start_at, promotion_end_at, sales_channel, source_skill, source, observed_at, ingested_at, ingestion_run_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [mapping.sku_id, rec.regular_price_minor, rec.promotional_price_minor, effective, rec.currency || 'HKD',
             rec.promotion_name, rec.promotion_start_at, rec.promotion_end_at, rec.sales_channel,
             standard.source_skill, standard.source, rec.observed_at, now, runId]);
        } else {
          let locationId = null;
          if (rec.location_name || rec.location_id) {
            locationId = ensureLocation(db, rec.location_id, rec.location_name, rec.sales_channel);
          }
          db.run(`INSERT INTO sku_stock_observations
            (sku_id, location_id, stock_status, available_quantity, reserved_quantity, incoming_quantity, expected_restock_at,
             sales_channel, raw_value, source_skill, source, observed_at, ingested_at, ingestion_run_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [mapping.sku_id, locationId, rec.stock_status, rec.available_quantity, rec.reserved_quantity, rec.incoming_quantity,
             rec.expected_restock_at, rec.sales_channel, rec.raw_value, standard.source_skill, standard.source, rec.observed_at, now, runId]);
        }
        counts.ok++;
      } else if (mapping.status === 'REVIEW') {
        db.run(`INSERT INTO mapping_reviews (record_type, source_record, proposed_sku_id, proposed_token_id, reason, status, created_at) VALUES (?,?,?,?,?,'PENDING',?)`,
          [standard.data_type.toUpperCase(), JSON.stringify(rec), mapping.sku_id, mapping.token_id || null,
           `Record matched a token but not a specific SKU (${mapping.method})`, now]);
        counts.ambiguous++;
      } else {
        db.run(`INSERT INTO mapping_reviews (record_type, source_record, reason, status, created_at) VALUES (?,?,?,'PENDING',?)`,
          [standard.data_type.toUpperCase(), JSON.stringify(rec), 'No SKU match found', now]);
        counts.ambiguous++;
      }
    } catch (e) {
      db.run(`INSERT INTO ingestion_errors (ingestion_run_id, record, error, created_at) VALUES (?,?,?,?)`,
        [runId, JSON.stringify(rec), String(e.message), now]);
      counts.invalid++;
    }
  }
  return counts;
}

function ensureLocation(db, code, name, channel) {
  const key = code || name;
  let loc = db.get('SELECT id FROM inventory_locations WHERE location_code=? OR name=?', [key, key]);
  if (loc) return loc.id;
  const ins = db.run('INSERT INTO inventory_locations (location_code, name, channel, active, created_at) VALUES (?,?,?,1,?)',
    [code || null, name || String(key), channel || null, NOW()]);
  return ins.lastId;
}

module.exports = { Adapters, mapRecordToSku, startRun, finishRun, ingestStandard, ensureLocation, mapStockState, moneyToMinor };

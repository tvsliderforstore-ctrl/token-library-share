'use strict';
/**
 * server.js — local-first HTTP server: REST API + static SPA + dashboard logic.
 * No framework; uses node:http + the sql.js Database. Zero native deps.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Database } = require('./db/db');
const config = require('./config');
const repo = require('./db/repo');
const { classify, classifyBatch } = require('./classify/classify');
const ingest = require('./ingest/ingest');
const ie = require('./api/importExport');
const { Router, sendJson, sendError, sendBuffer, readJson, readBody, parseQuery } = require('./api/httpUtil');

const PUBLIC = path.join(__dirname, '..', 'public');

function money(minor) { return minor == null ? null : minor / 100; }
function hoursAgo(iso) { return (Date.now() - new Date(iso).getTime()) / 36e5; }
function freshness(iso) {
  if (!iso) return 'MISSING';
  return hoursAgo(iso) <= config.freshness.freshHours ? 'FRESH' : 'STALE';
}

async function createApp(dbFile) {
  const { Database } = require('./db/db.js');
  const db = await Database.open(dbFile || config.dbFile);
  const r = new Router();

  // ===== System =====
  r.get('/api/health', (req, res) => sendJson(res, 200, { ok: true, time: new Date().toISOString(), db: db.filePath }));
  r.get('/api/system/skill-status', (req, res) => {
    const stockExists = fs.existsSync(config.stockSkill.script);
    sendJson(res, 200, {
      price_skill: { name: config.priceSkill.name, source: config.priceSkill.source, candidates: config.priceSkill.candidates, connected: true, note: 'Adapter wraps existing PSOS discount skill output.' },
      stock_skill: { name: config.stockSkill.name, script: config.stockSkill.script, connected: stockExists, note: stockExists ? 'Adapter wraps existing check_sku.py.' : 'Stock skill not connected — check script path.' },
    });
  });
  r.get('/api/system/taxonomy-version', (req, res) => {
    const v = db.get('SELECT version, created_at FROM taxonomy_versions ORDER BY id DESC LIMIT 1');
    sendJson(res, 200, { version: v ? v.version : config.taxonomyVersion, since: v ? v.created_at : null });
  });
  r.get('/api/overview', (req, res) => sendJson(res, 200, repo.overview(db)));

  // ===== Large Groups =====
  r.get('/api/large-groups', (req, res) => sendJson(res, 200, repo.Groups.list(db)));
  r.get('/api/large-groups/:id', (req, res, p) => {
    const g = repo.Groups.get(db, p.id); return g ? sendJson(res, 200, g) : sendError(res, 404, 'Not found');
  });
  r.patch('/api/large-groups/:id', async (req, res, p) => {
    const body = await readJson(req);
    const g = repo.Groups.update(db, p.id, body, body.reviewer || 'dashboard');
    db.save(); return g ? sendJson(res, 200, g) : sendError(res, 404, 'Not found');
  });

  // ===== Categories (Main Cat = large_groups, Sub Cat = sub_categories) =====
  r.get('/api/main-categories', (req, res) => sendJson(res, 200, repo.Categories.mainList(db)));
  r.get('/api/main-categories/:code/sub-categories', (req, res, p, q) => {
    const out = repo.Categories.subList(db, p.code, {
      sort: q.sort || 'order',
      includeInactive: q.include_inactive === '1' || q.include_inactive === 'true',
    });
    return out ? sendJson(res, 200, out) : sendError(res, 404, 'Main Cat not found');
  });
  r.get('/api/sub-categories/:code', (req, res, p) => {
    const sc = repo.Categories.getSub(db, p.code); return sc ? sendJson(res, 200, sc) : sendError(res, 404, 'Sub Cat not found');
  });
  r.get('/api/sub-categories/:code/brands', (req, res, p) => {
    const out = repo.Categories.brandsInSub(db, p.code); return out ? sendJson(res, 200, out) : sendError(res, 404, 'Sub Cat not found');
  });
  r.get('/api/sub-categories/:code/tokens', (req, res, p) => {
    const out = repo.Categories.tokensInSub(db, p.code); return out ? sendJson(res, 200, out) : sendError(res, 404, 'Sub Cat not found');
  });
  r.get('/api/sub-categories/:code/skus', (req, res, p, q) => {
    const out = repo.Categories.skusInSub(db, p.code, q);
    return out ? sendJson(res, 200, out) : sendError(res, 404, 'Sub Cat not found');
  });
  r.get('/api/categories/overview', (req, res) => sendJson(res, 200, repo.Categories.subcatOverview(db)));
  r.get('/api/stat-drill/:kind', (req, res, p, q) => {
    const out = repo.statDrill(db, p.kind, { limit: q.limit, offset: q.offset });
    if (!out) return sendError(res, 404, 'Unknown stat-drill kind: ' + p.kind);
    sendJson(res, 200, out);
  });
  r.get('/api/cheapest-real-overview', (req, res) => sendJson(res, 200, repo.cheapestRealOverview(db)));
  r.patch('/api/sub-categories/:code', async (req, res, p) => {
    const body = await readJson(req);
    // Block deactivating is allowed (deactivate, not delete). Guard: cannot move a Sub Cat
    // that contains SKUs to a different Main Cat without explicit confirmation.
    if (body.large_group_code !== undefined) {
      const sc = repo.Categories.getSub(db, p.code);
      if (!sc) return sendError(res, 404, 'Sub Cat not found');
      const target = repo.Groups.byCode(db, body.large_group_code);
      if (!target) return sendError(res, 400, 'Unknown target Main Cat');
      if (target.id !== sc.large_group_id) {
        const cnt = db.get('SELECT COUNT(*) c FROM sku_records WHERE sub_category_id=?', [sc.id]).c;
        if (cnt > 0 && !body.confirm_migration) {
          return sendError(res, 409, `SUBCAT_HAS_SKUS: contains ${cnt} SKUs; pass confirm_migration=true to move`);
        }
        db.run('UPDATE sub_categories SET large_group_id=?, updated_at=? WHERE id=?', [target.id, new Date().toISOString(), sc.id]);
        db.save();
        return sendJson(res, 200, repo.Categories.getSub(db, p.code));
      }
    }
    const sc = repo.Categories.updateSub(db, p.code, body, body.reviewer || 'dashboard');
    db.save(); return sc ? sendJson(res, 200, sc) : sendError(res, 404, 'Sub Cat not found');
  });

  // ===== Tokens =====
  r.get('/api/tokens', (req, res, p, q) => sendJson(res, 200, repo.Tokens.list(db, { groupId: q.group_id })));
  r.get('/api/tokens/:id', (req, res, p) => {
    const t = repo.Tokens.get(db, p.id); if (!t) return sendError(res, 404, 'Not found');
    t.aliases = repo.Tokens.aliases(db, p.id);
    t.negative_aliases = repo.Tokens.negativeAliases(db, p.id);
    sendJson(res, 200, t);
  });
  r.post('/api/tokens/:id/aliases', async (req, res, p) => {
    const body = await readJson(req);
    repo.Tokens.addAlias(db, p.id, body.alias, body.status || 'APPROVED', body.reviewer || 'dashboard', body.reason);
    db.save(); sendJson(res, 201, { ok: true });
  });
  r.post('/api/tokens/:id/negative-aliases', async (req, res, p) => {
    const body = await readJson(req);
    repo.Tokens.addNegativeAlias(db, p.id, body.alias, body.reviewer || 'dashboard', body.reason);
    db.save(); sendJson(res, 201, { ok: true });
  });

  // ===== Product Keys =====
  r.get('/api/product-keys', (req, res, p, q) => sendJson(res, 200, repo.Keys.list(db, { tokenId: q.token_id, q: q.q })));
  r.get('/api/product-keys/:id', (req, res, p) => {
    const k = repo.Keys.get(db, p.id); return k ? sendJson(res, 200, k) : sendError(res, 404, 'Not found');
  });
  r.post('/api/product-keys', async (req, res) => {
    const body = await readJson(req);
    try { const k = repo.Keys.create(db, body, body.reviewer || 'dashboard'); db.save(); sendJson(res, 201, k); }
    catch (e) { sendError(res, e.message === 'DUPLICATE_PRODUCT_KEY' ? 409 : 400, e.message); }
  });

  // ===== Taxonomy search =====
  r.get('/api/search', (req, res, p, q) => {
    const query = q.q || '';
    sendJson(res, 200, {
      tokens: repo.Tokens.list(db).filter((t) => (t.name_zh + (t.name_en || '')).includes(query)),
      product_keys: repo.Keys.list(db, { q: query }),
    });
  });

  // ===== SKUs =====
  r.get('/api/skus', (req, res, p, q) => {
    sendJson(res, 200, repo.Skus.list(db, { q: q.q, groupId: q.group_id, tokenId: q.token_id, keyId: q.key_id, reviewStatus: q.review_status, limit: parseInt(q.limit || '200', 10), offset: parseInt(q.offset || '0', 10) }));
  });
  r.get('/api/skus/:id', (req, res, p) => {
    const s = repo.Skus.get(db, p.id); return s ? sendJson(res, 200, s) : sendError(res, 404, 'Not found');
  });
  r.post('/api/skus/import', async (req, res) => {
    const body = await readJson(req);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const results = [];
    db.tx(() => {
      for (const rec of rows) {
        const cls = rec.raw_sku_name ? classify(db, rec.raw_sku_name, rec) : null;
        const up = repo.Skus.upsert(db, rec, cls);
        results.push({ id: up.id, created: up.created, classification: cls ? { token: cls.product_token_name, key: cls.product_key_display, confidence: cls.confidence, requires_review: cls.requires_review } : null });
      }
    });
    db.save(); sendJson(res, 201, { imported: results.length, results });
  });

  // ===== Classification =====
  r.post('/api/classify', async (req, res) => {
    const body = await readJson(req);
    if (Array.isArray(body.items)) return sendJson(res, 200, { results: classifyBatch(db, body.items) });
    const out = classify(db, body.raw_sku_name || body.name || '', body);
    sendJson(res, 200, out);
  });
  r.get('/api/classify/results/:id', (req, res, p) => {
    const row = db.get('SELECT * FROM classification_results WHERE id=?', [p.id]);
    if (!row) return sendError(res, 404, 'Not found');
    row.candidates = db.all('SELECT * FROM classification_candidates WHERE result_id=?', [p.id]);
    sendJson(res, 200, row);
  });

  // ===== Review =====
  r.get('/api/review/queue', (req, res, p, q) => {
    const type = q.type;
    const classification = db.all(`SELECT cr.*, s.raw_sku_name FROM classification_reviews cr LEFT JOIN sku_records s ON s.id=cr.sku_id ${type ? 'WHERE cr.queue_type=?' : ''} ORDER BY cr.id DESC LIMIT 200`, type ? [type] : []);
    const mapping = db.all(`SELECT * FROM mapping_reviews WHERE status='PENDING' ORDER BY id DESC LIMIT 200`);
    const pendingSkus = repo.Skus.list(db, { reviewStatus: 'PENDING', limit: 200 });
    sendJson(res, 200, { classification, mapping, pending_skus: pendingSkus });
  });
  r.post('/api/review/submit', async (req, res) => {
    const body = await readJson(req);
    // body: {sku_id, action, product_token_id, product_key_id, large_group_id, reviewer, reason, add_alias, add_negative_alias, new_token_name}
    const now = new Date().toISOString();
    db.tx(() => {
      if (body.sku_id) {
        const sku = repo.Skus.get(db, body.sku_id);
        const updates = {};
        if (body.product_token_id) updates.product_token_id = body.product_token_id;
        if (body.product_key_id) updates.product_key_id = body.product_key_id;
        if (body.large_group_id) updates.large_group_id = body.large_group_id;
        const mappingStatus = updates.product_key_id ? 'MAPPED' : (updates.product_token_id ? 'TOKEN_ONLY' : sku.mapping_status);
        db.run(`UPDATE sku_records SET product_token_id=?, product_key_id=?, large_group_id=?, mapping_status=?, review_status='CONFIRMED', updated_at=? WHERE id=?`,
          [updates.product_token_id || sku.product_token_id, updates.product_key_id || sku.product_key_id, updates.large_group_id || sku.large_group_id, mappingStatus, now, body.sku_id]);
        repo.Audit.log(db, 'sku_record', body.sku_id, 'REVIEW_CONFIRM', { old: sku }, { new: updates }, body.reviewer, body.reason);
        // Only human-confirmed corrections become aliases.
        if (body.add_alias && updates.product_token_id) repo.Tokens.addAlias(db, updates.product_token_id, body.add_alias, 'APPROVED', body.reviewer, body.reason);
        if (body.add_negative_alias && updates.product_token_id) repo.Tokens.addNegativeAlias(db, updates.product_token_id, body.add_negative_alias, body.reviewer, body.reason);
        db.run(`INSERT INTO correction_examples (raw_input, old_value, new_value, correction_type, reviewer, reason, taxonomy_version, created_at) VALUES (?,?,?,?,?,?,?,?)`,
          [sku.raw_sku_name, JSON.stringify({ token: sku.product_token_id, key: sku.product_key_id }), JSON.stringify(updates), body.action || 'CONFIRM', body.reviewer || null, body.reason || null, config.taxonomyVersion, now]);
      }
      if (body.mapping_review_id) {
        db.run(`UPDATE mapping_reviews SET status='RESOLVED', reviewer=?, resolved_at=? WHERE id=?`, [body.reviewer || 'dashboard', now, body.mapping_review_id]);
      }
    });
    db.save(); sendJson(res, 200, { ok: true });
  });

  // ===== Price & Stock =====
  r.get('/api/skus/:id/price', (req, res, p) => {
    const cur = db.get('SELECT * FROM v_latest_price WHERE sku_id=?', [p.id]);
    const prev = db.get('SELECT * FROM sku_price_observations WHERE sku_id=? ORDER BY observed_at DESC LIMIT 1 OFFSET 1', [p.id]);
    sendJson(res, 200, presentPrice(cur, prev));
  });
  r.get('/api/skus/:id/price-history', (req, res, p) => {
    sendJson(res, 200, db.all('SELECT * FROM sku_price_observations WHERE sku_id=? ORDER BY observed_at DESC', [p.id]).map((x) => presentPrice(x)));
  });
  r.get('/api/skus/:id/stock', (req, res, p) => {
    sendJson(res, 200, db.all('SELECT * FROM v_latest_stock WHERE sku_id=?', [p.id]).map(presentStock));
  });
  r.get('/api/skus/:id/stock-history', (req, res, p) => {
    sendJson(res, 200, db.all('SELECT * FROM sku_stock_observations WHERE sku_id=? ORDER BY observed_at DESC', [p.id]).map(presentStock));
  });
  // Tableau operational data (discount_price + is_invisible) by external sku_id.
  // Written by the tableau-sku-price-visibility wrapper via a separate connection;
  // tables may not exist in this sql.js instance until it reloads — guard and
  // return null (never 500) in that case.
  r.get('/api/skus/:id/operational', (req, res, p) => {
    try {
      const s = db.get('SELECT external_sku_id FROM sku_records WHERE id=?', [p.id]);
      if (!s) return sendJson(res, 200, null);
      const tables = new Set(db.all("SELECT name FROM sqlite_master WHERE type='table'").map((x) => x.name));
      if (!tables.has('sku_operational_current')) return sendJson(res, 200, null);
      const cur = db.get('SELECT * FROM sku_operational_current WHERE sku_id=?', [s.external_sku_id]);
      if (!cur) return sendJson(res, 200, { sku_id: s.external_sku_id, status: 'MISSING', freshness: 'MISSING' });
      sendJson(res, 200, {
        sku_id: s.external_sku_id,
        current_discount_price: cur.current_discount_price_minor != null ? cur.current_discount_price_minor / 100 : null,
        current_is_invisible: cur.current_is_invisible == null ? null : !!cur.current_is_invisible,
        operational_data_status: cur.operational_data_status,
        discount_price_observed_at: cur.discount_price_observed_at,
        visibility_observed_at: cur.visibility_observed_at,
        last_tableau_refresh_at: cur.last_tableau_refresh_at,
        freshness: freshness(cur.discount_price_observed_at || cur.last_tableau_refresh_at),
      });
    } catch (e) { sendJson(res, 200, null); }
  });

  // ===== Stock drill-down (總覽 有貨/缺貨) =====
  const drillStatus = (s) => { const u = String(s).toUpperCase(); return ['OUT_OF_STOCK', 'LOW_STOCK'].includes(u) ? u : 'IN_STOCK'; };
  r.get('/api/stock-drill/:status/main', (req, res, p) => sendJson(res, 200, repo.Categories.StockDrill.main(db, drillStatus(p.status))));
  r.get('/api/stock-drill/:status/main/:code', (req, res, p) => {
    const out = repo.Categories.StockDrill.sub(db, drillStatus(p.status), p.code);
    return out ? sendJson(res, 200, out) : sendError(res, 404, 'Main Cat not found');
  });
  r.get('/api/stock-drill/:status/sub/:code', (req, res, p) => {
    const out = repo.Categories.StockDrill.tokens(db, drillStatus(p.status), p.code);
    return out ? sendJson(res, 200, out) : sendError(res, 404, 'Sub Cat not found');
  });
  r.get('/api/stock-drill/:status/token/:id', (req, res, p) => sendJson(res, 200, repo.Categories.StockDrill.skus(db, drillStatus(p.status), p.id)));

  function presentPrice(row, prev) {
    if (!row) return { status: 'MISSING', freshness: 'MISSING' };
    return {
      sku_id: row.sku_id,
      regular_price: money(row.regular_price_minor),
      promotional_price: money(row.promotional_price_minor),
      effective_price: money(row.effective_price_minor),
      currency: row.currency,
      promotion_name: row.promotion_name,
      promotion_start_at: row.promotion_start_at,
      promotion_end_at: row.promotion_end_at,
      previous_price: prev ? money(prev.effective_price_minor) : null,
      price_difference: prev && row.effective_price_minor != null && prev.effective_price_minor != null ? money(row.effective_price_minor - prev.effective_price_minor) : null,
      pct_change: prev && prev.effective_price_minor ? +(((row.effective_price_minor - prev.effective_price_minor) / prev.effective_price_minor) * 100).toFixed(2) : null,
      observed_at: row.observed_at,
      freshness: freshness(row.observed_at),
    };
  }
  function presentStock(row) {
    if (!row) return { status: 'MISSING', freshness: 'MISSING' };
    return {
      sku_id: row.sku_id, location_id: row.location_id, stock_status: row.stock_status,
      available_quantity: row.available_quantity, reserved_quantity: row.reserved_quantity,
      incoming_quantity: row.incoming_quantity, expected_restock_at: row.expected_restock_at,
      sales_channel: row.sales_channel, observed_at: row.observed_at, freshness: freshness(row.observed_at),
    };
  }

  // summaries
  r.get('/api/product-keys/:id/summary', (req, res, p) => sendJson(res, 200, keySummary(db, p.id)));
  r.get('/api/tokens/:id/summary', (req, res, p) => sendJson(res, 200, tokenSummary(db, p.id)));
  r.get('/api/price-stock/overview', (req, res) => sendJson(res, 200, priceStockOverview(db)));

  // Visibility drill: list SKUs by online/offline (is_invisible), grouped by Main Cat.
  // state = 'visible' (online, is_invisible=0) | 'invisible' (offline, is_invisible=1)
  r.get('/api/visibility-drill/:state', (req, res, p, q) => {
    const state = p.state === 'invisible' ? 1 : 0;
    const limit = Math.min(parseInt(q.limit || '500', 10) || 500, 2000);
    const offset = parseInt(q.offset || '0', 10) || 0;
    const rows = db.all(`
      SELECT s.id, s.external_sku_id AS sku_id, s.raw_sku_name AS product_name,
             s.product_key_id,
             g.name_zh AS main_cat, sc.name_zh AS sub_cat, b.display_name AS brand,
             k.display_pack_format AS packing_spec,
             soc.current_is_invisible, soc.current_discount_price_minor,
             soc.visibility_observed_at
      FROM sku_records s
      JOIN sku_operational_current soc ON soc.sku_id = s.external_sku_id
      LEFT JOIN large_groups g ON g.id = s.large_group_id
      LEFT JOIN sub_categories sc ON sc.id = s.sub_category_id
      LEFT JOIN product_keys k ON k.id = s.product_key_id
      LEFT JOIN brands b ON b.id = k.brand_id
      WHERE s.active=1 AND soc.current_is_invisible = ?
      ORDER BY g.display_order, sc.display_order, s.external_sku_id
      LIMIT ? OFFSET ?`, [state, limit, offset]);
    const total = db.get(`SELECT COUNT(*) c FROM sku_records s JOIN sku_operational_current soc ON soc.sku_id=s.external_sku_id WHERE s.active=1 AND soc.current_is_invisible=?`, [state]).c;
    // Enrich with per-Key cheapest ranking (full key membership).
    const keyIds = [...new Set(rows.map((r) => r.product_key_id).filter((x) => x != null))];
    const rankMap = repo.keyRankMap(db, keyIds);
    sendJson(res, 200, { total, rows: rows.map((r) => {
      const rk = rankMap[r.id] || {};
      return { ...r, discount_price: r.current_discount_price_minor != null ? r.current_discount_price_minor / 100 : null, is_invisible: r.current_is_invisible === 1,
        cheapest_rank: rk.cheapest_rank, cheapest_group_size: rk.cheapest_group_size, is_cheapest: !!rk.is_cheapest,
        is_real_top1: !!rk.is_real_top1, real_rank: rk.real_rank, real_top1_offset: rk.real_top1_offset,
        current_discount_price_minor: undefined };
    }) });
  });

  // refresh / ingestion
  r.post('/api/ingest/run', async (req, res) => {
    const body = await readJson(req);
    const dataType = (body.data_type || '').toUpperCase();
    if (!['PRICE', 'STOCK'].includes(dataType)) return sendError(res, 400, 'data_type must be PRICE or STOCK');
    const started = ingest.startRun(db, dataType, body.source_skill || (dataType === 'PRICE' ? config.priceSkill.name : config.stockSkill.name), body.triggered_by || 'api');
    if (!started.ok) return sendError(res, 409, started.error);
    const runId = started.runId;
    try {
      // Records must come from the existing skill (passed in body.records after
      // the caller ran the skill) OR a provided adapter payload. We never fabricate.
      const rawRecords = body.records || [];
      const standard = dataType === 'PRICE'
        ? ingest.Adapters.price(rawRecords, { skillName: config.priceSkill.name, source: config.priceSkill.source })
        : ingest.Adapters.stock(rawRecords, { skillName: config.stockSkill.name, source: config.stockSkill.source });
      const counts = db.tx(() => ingest.ingestStandard(db, runId, standard));
      const status = counts.invalid > 0 && counts.ok === 0 ? 'FAILED' : (counts.invalid > 0 ? 'PARTIAL' : 'COMPLETED');
      ingest.finishRun(db, runId, status, counts, null);
      db.save();
      sendJson(res, 200, { run_id: runId, status, counts });
    } catch (e) {
      ingest.finishRun(db, runId, 'FAILED', { total: 0, ok: 0, ambiguous: 0, invalid: 0 }, String(e.message));
      db.save();
      sendError(res, 500, 'Ingestion failed: ' + e.message, { run_id: runId });
    }
  });
  r.get('/api/ingest/runs', (req, res, p, q) => {
    sendJson(res, 200, db.all(`SELECT * FROM ingestion_runs ${q.data_type ? 'WHERE data_type=?' : ''} ORDER BY id DESC LIMIT 100`, q.data_type ? [q.data_type] : []));
  });
  r.get('/api/ingest/runs/:id', (req, res, p) => {
    const run = db.get('SELECT * FROM ingestion_runs WHERE id=?', [p.id]);
    if (!run) return sendError(res, 404, 'Not found');
    run.errors = db.all('SELECT * FROM ingestion_errors WHERE ingestion_run_id=?', [p.id]);
    run.records = db.all('SELECT * FROM ingestion_source_records WHERE ingestion_run_id=?', [p.id]);
    sendJson(res, 200, run);
  });
  r.get('/api/ingest/mapping-reviews', (req, res) => sendJson(res, 200, db.all(`SELECT * FROM mapping_reviews WHERE status='PENDING' ORDER BY id DESC`)));

  // ===== Import / Export =====
  r.get('/api/import/template', async (req, res, p, q) => {
    const header = ie.TEMPLATE_COLUMNS;
    if ((q.format || 'csv') === 'xlsx') {
      const buf = await ie.toXLSX([header, ['H9810001_S_33038-2', '4891234567890', '鈣思寶無糖豆奶250毫升24支', 'BEVERAGES', 'PT-BEVERAGE-SOY-MILK', 'PK-000003', '鈣思寶', '中國', '無糖', '250', 'ml', '24', '支', 'HKTVmall', '1']], 'Import Template');
      return sendBuffer(res, 200, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'import-template.xlsx');
    }
    const csv = header.join(',') + '\r\n' + 'H9810001_S_33038-2,4891234567890,鈣思寶無糖豆奶250毫升24支,BEVERAGES,PT-BEVERAGE-SOY-MILK,PK-000003,鈣思寶,中國,無糖,250,ml,24,支,HKTVmall,1';
    sendBuffer(res, 200, Buffer.from('\uFEFF' + csv, 'utf8'), 'text/csv; charset=utf-8', 'import-template.csv');
  });
  r.post('/api/import/validate', async (req, res) => {
    const body = await readJson(req);
    let objects = [];
    if (body.format === 'csv') objects = ie.rowsToObjects(ie.parseCSV(body.content));
    else if (body.format === 'json') objects = Array.isArray(body.rows) ? body.rows : [];
    else if (body.format === 'xlsx') objects = ie.rowsToObjects(await ie.parseXLSX(Buffer.from(body.content_base64, 'base64')));
    else if (Array.isArray(body.rows)) objects = body.rows;
    const result = ie.validateImportRows(db, objects);
    sendJson(res, 200, result);
  });
  r.post('/api/import/commit', async (req, res) => {
    const body = await readJson(req);
    const objects = Array.isArray(body.rows) ? body.rows : [];
    const v = ie.validateImportRows(db, objects);
    if (v.invalid.length && !body.importValidOnly) {
      return sendError(res, 422, 'Validation failed; no rows imported. Set importValidOnly to import valid rows only.', v);
    }
    const toImport = body.importValidOnly ? v.valid.map((x) => x.data) : objects;
    const results = [];
    db.tx(() => {
      for (const rec of toImport) {
        const cls = rec.raw_sku_name ? classify(db, rec.raw_sku_name, rec) : null;
        const up = repo.Skus.upsert(db, rec, cls);
        results.push({ id: up.id, created: up.created });
      }
    });
    db.save();
    sendJson(res, 201, { imported: results.length, skipped_invalid: v.invalid.length, results });
  });
  r.get('/api/export/skus', async (req, res, p, q) => {
    const rows = repo.Skus.list(db, { limit: 100000 });
    const header = ['id', 'external_sku_id', 'barcode', 'raw_sku_name', 'group_name', 'token_name', 'key_display', 'mapping_status', 'mapping_confidence', 'review_status'];
    const matrix = [header, ...rows.map((x) => [x.id, x.external_sku_id, x.barcode, x.raw_sku_name, x.group_name, x.token_name, x.key_display, x.mapping_status, x.mapping_confidence, x.review_status])];
    if (q.format === 'xlsx') return sendBuffer(res, 200, await ie.toXLSX(matrix, 'SKUs'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'skus.xlsx');
    if (q.format === 'json') return sendJson(res, 200, rows);
    sendBuffer(res, 200, Buffer.from('\uFEFF' + ie.toCSV(matrix), 'utf8'), 'text/csv; charset=utf-8', 'skus.csv');
  });
  r.get('/api/export/backup', (req, res) => {
    db.save();
    const buf = fs.readFileSync(db.filePath);
    sendBuffer(res, 200, buf, 'application/x-sqlite3', `product-token-library-backup-${Date.now()}.db`);
  });
  r.get('/api/export/taxonomy', (req, res) => {
    sendJson(res, 200, {
      large_groups: db.all('SELECT * FROM large_groups'),
      sub_categories: db.all('SELECT * FROM sub_categories'),
      product_tokens: db.all('SELECT * FROM product_tokens'),
      product_token_aliases: db.all('SELECT * FROM product_token_aliases'),
      product_keys: db.all('SELECT * FROM product_keys'),
      brands: db.all('SELECT * FROM brands'),
      origins: db.all('SELECT * FROM origins'),
    });
  });
  r.post('/api/restore/validate', async (req, res) => {
    const buf = await readBody(req);
    try {
      const tmp = path.join(require('os').tmpdir(), `ptl-restore-${Date.now()}.db`);
      fs.writeFileSync(tmp, buf);
      const test = await Database.open(tmp);
      const ok = test.get("SELECT name FROM sqlite_master WHERE type='table' AND name='large_groups'");
      const groups = test.get('SELECT COUNT(*) c FROM large_groups').c;
      test.close(); fs.unlinkSync(tmp);
      sendJson(res, 200, { valid: !!ok, large_groups: groups });
    } catch (e) { sendError(res, 400, 'Invalid backup file: ' + e.message); }
  });

  // ===== Audit =====
  r.get('/api/audit', (req, res, p, q) => sendJson(res, 200, repo.Audit.list(db, { entityType: q.entity_type, limit: parseInt(q.limit || '200', 10) })));

  // ===== Static SPA =====
  const server = http.createServer(async (req, res) => {
    try {
      const { pathname, query } = parseQuery(req.url);
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' }); return res.end(); }
      if (pathname.startsWith('/api/')) {
        const m = r.match(req.method, pathname);
        if (!m) return sendError(res, 404, 'Unknown API endpoint: ' + pathname);
        return await m.handler(req, res, m.params, query);
      }
      // static
      let fp = pathname === '/' ? '/index.html' : pathname;
      const abs = path.join(PUBLIC, path.normalize(fp).replace(/^([/\\])+/, ''));
      if (!abs.startsWith(PUBLIC) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
        // SPA fallback
        const idx = path.join(PUBLIC, 'index.html');
        if (fs.existsSync(idx)) return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }) && res.end(fs.readFileSync(idx));
        return sendError(res, 404, 'Not found');
      }
      const ext = path.extname(abs).toLowerCase();
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
      // Never cache the SPA shell or its JS/CSS — this is a local dev dashboard that
      // changes on every edit/recompile; stale app.compiled.js is a recurring bug source.
      res.writeHead(200, { 'Content-Type': (types[ext] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(abs));
    } catch (e) {
      sendError(res, 500, 'Server error: ' + e.message);
    }
  });

  return { server, db, router: r };
}

// ---- summary helpers ----
function keySummary(db, keyId) {
  const skus = db.all('SELECT id FROM sku_records WHERE product_key_id=?', [keyId]);
  const ids = skus.map((s) => s.id);
  if (!ids.length) return { sku_count: 0, price: null, stock: null };
  const placeholders = ids.map(() => '?').join(',');
  const prices = db.all(`SELECT DISTINCT effective_price_minor FROM v_latest_price WHERE sku_id IN (${placeholders})`, ids).map((x) => x.effective_price_minor).filter((v) => v != null);
  const stockRows = db.all(`SELECT stock_status FROM v_latest_stock WHERE sku_id IN (${placeholders})`, ids);
  const price = prices.length === 0 ? null : prices.length === 1
    ? { type: 'single', value: prices[0] / 100 }
    : { type: 'range', min: Math.min(...prices) / 100, max: Math.max(...prices) / 100 };
  const stock = summarizeStock(stockRows.map((x) => x.stock_status));
  return { sku_count: ids.length, price, stock };
}
function tokenSummary(db, tokenId) {
  const keys = db.all('SELECT id FROM product_keys WHERE token_id=?', [tokenId]);
  const skus = db.all('SELECT id FROM sku_records WHERE product_token_id=?', [tokenId]);
  const ids = skus.map((s) => s.id);
  let price = null;
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const prices = db.all(`SELECT DISTINCT effective_price_minor FROM v_latest_price WHERE sku_id IN (${ph})`, ids).map((x) => x.effective_price_minor).filter((v) => v != null);
    if (prices.length) price = { type: prices.length === 1 ? 'single' : 'range', value: prices.length === 1 ? prices[0] / 100 : undefined, min: Math.min(...prices) / 100, max: Math.max(...prices) / 100, across_keys: keys.length };
  }
  const stockRows = ids.length ? db.all(`SELECT stock_status FROM v_latest_stock WHERE sku_id IN (${ids.map(() => '?').join(',')})`, ids) : [];
  return { key_count: keys.length, sku_count: ids.length, price, stock: summarizeStock(stockRows.map((x) => x.stock_status)) };
}
function summarizeStock(statuses) {
  const c = { IN_STOCK: 0, LOW_STOCK: 0, OUT_OF_STOCK: 0, PREORDER: 0, DISCONTINUED: 0, UNKNOWN: 0 };
  statuses.forEach((s) => { c[s] = (c[s] || 0) + 1; });
  return c;
}
function priceStockOverview(db) {
  const skus = db.all('SELECT id FROM sku_records WHERE active=1');
  const ids = skus.map((s) => s.id);
  const empty = { in_stock: 0, low_stock: 0, out_of_stock: 0, unknown_stock: 0, active_promotions: 0, missing_price: 0, missing_stock: 0, stale_price: 0, stale_stock: 0, recent_price_changes: [] };
  if (!ids.length) return empty;
  const ph = ids.map(() => '?').join(',');
  const latestStock = db.all(`SELECT sku_id, stock_status, observed_at FROM v_latest_stock WHERE sku_id IN (${ph})`, ids);
  const latestPrice = db.all(`SELECT sku_id, effective_price_minor, promotional_price_minor, observed_at FROM v_latest_price WHERE sku_id IN (${ph})`, ids);
  const stockMap = {}; latestStock.forEach((x) => { stockMap[x.sku_id] = x; });
  const priceMap = {}; latestPrice.forEach((x) => { priceMap[x.sku_id] = x; });
  const out = { ...empty };
  ids.forEach((id) => {
    const st = stockMap[id]; const pr = priceMap[id];
    if (!st) out.missing_stock++; else if (st.stock_status === 'IN_STOCK') out.in_stock++;
    else if (st.stock_status === 'LOW_STOCK') out.low_stock++; else if (st.stock_status === 'OUT_OF_STOCK') out.out_of_stock++; else out.unknown_stock++;
    if (st && freshness(st.observed_at) === 'STALE') out.stale_stock++;
    if (!pr) out.missing_price++; else { if (pr.promotional_price_minor != null) out.active_promotions++; if (freshness(pr.observed_at) === 'STALE') out.stale_price++; }
  });
  return out;
}

async function start(port, dbFile) {
  const app = await createApp(dbFile);
  const p = (port !== undefined && port !== null) ? port : config.port;
  await new Promise((resolve) => app.server.listen(p, config.host, resolve));
  app.server.on('listening', () => {});
  console.log(`Product Token Library dashboard → http://${config.host}:${app.server.address().port}`);
  console.log(`DB: ${app.db.filePath}`);
  return app;
}

if (require.main === module) { start(); }

module.exports = { createApp, start, keySummary, tokenSummary, priceStockOverview, freshness };

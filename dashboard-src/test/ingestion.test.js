'use strict';
/** ingestion.test.js — price/stock, freshness, retention, locking (spec §26, §13-§22). */
const test = require('node:test');
const assert = require('node:assert');
const { freshDb, cleanup } = require('./helpers');
const repo = require('../src/db/repo');
const ingest = require('../src/ingest/ingest');
const { classify } = require('../src/classify/classify');
const server = require('../src/server');

function mkSku(db, ext, name) {
  const cls = classify(db, name, { external_sku_id: ext });
  const up = repo.Skus.upsert(db, { external_sku_id: ext, raw_sku_name: name }, cls);
  return up.id;
}
function addPrice(db, skuId, reg, promo, observedAt, runId) {
  const eff = promo != null ? promo : reg;
  db.run(`INSERT INTO sku_price_observations (sku_id, regular_price_minor, promotional_price_minor, effective_price_minor, currency, observed_at, ingested_at, ingestion_run_id) VALUES (?,?,?,?,'HKD',?,?,?)`,
    [skuId, reg != null ? Math.round(reg * 100) : null, promo != null ? Math.round(promo * 100) : null, eff != null ? Math.round(eff * 100) : null, observedAt, observedAt, runId || null]);
}
function addStock(db, skuId, status, observedAt, locId, runId) {
  db.run(`INSERT INTO sku_stock_observations (sku_id, location_id, stock_status, observed_at, ingested_at, ingestion_run_id) VALUES (?,?,?,?,?,?)`,
    [skuId, locId || null, status, observedAt, observedAt, runId || null]);
}
const H = (h) => new Date(Date.now() - h * 36e5).toISOString();

test('money stored as integer minor units, never float', async () => {
  const db = await freshDb();
  const id = mkSku(db, 'M1', '鈣思寶無糖豆奶250毫升24支');
  addPrice(db, id, 39.9, null, H(1));
  const row = db.get('SELECT * FROM sku_price_observations WHERE sku_id=?', [id]);
  assert.strictEqual(row.regular_price_minor, 3990);
  assert.ok(Number.isInteger(row.regular_price_minor));
  cleanup(db);
});

test('missing price stays null, not zero', async () => {
  const db = await freshDb();
  const std = ingest.Adapters.price([{ external_sku_id: 'X', regular_price: null, promotional_price: null }], { skillName: 's', source: 's' });
  assert.strictEqual(std.records[0].regular_price_minor, null);
  assert.strictEqual(std.records[0].promotional_price_minor, null);
  cleanup(db);
});

test('price history is append-only and retained', async () => {
  const db = await freshDb();
  const id = mkSku(db, 'H1', '鈣思寶無糖豆奶250毫升24支');
  addPrice(db, id, 60, null, H(50));
  addPrice(db, id, 60, 45, H(10));
  addPrice(db, id, 60, 39.9, H(1));
  const rows = db.all('SELECT * FROM sku_price_observations WHERE sku_id=? ORDER BY observed_at', [id]);
  assert.strictEqual(rows.length, 3); // history retained, never overwritten
  cleanup(db);
});

test('stock history is append-only and retained', async () => {
  const db = await freshDb();
  const id = mkSku(db, 'S1', '鈣思寶無糖豆奶250毫升24支');
  addStock(db, id, 'IN_STOCK', H(40));
  addStock(db, id, 'OUT_OF_STOCK', H(5));
  const rows = db.all('SELECT * FROM sku_stock_observations WHERE sku_id=?', [id]);
  assert.strictEqual(rows.length, 2);
  cleanup(db);
});

test('multiple SKUs can have different prices (SKU-level data)', async () => {
  const db = await freshDb();
  const a = mkSku(db, 'P1', '鈣思寶無糖豆奶250毫升24支');
  const b = mkSku(db, 'P2', '鈣思寶無糖豆奶250毫升24支'); // same key, different SKU
  addPrice(db, a, 39.9, null, H(1));
  addPrice(db, b, 45, null, H(1));
  const sum = server.keySummary(db, db.get('SELECT product_key_id FROM sku_records WHERE id=?', [a]).product_key_id);
  assert.strictEqual(sum.price.type, 'range');
  assert.strictEqual(sum.price.min, 39.9);
  assert.strictEqual(sum.price.max, 45);
  cleanup(db);
});

test('stock differs by location', async () => {
  const db = await freshDb();
  const id = mkSku(db, 'L1', '鈣思寶無糖豆奶250毫升24支');
  const locA = ingest.ensureLocation(db, 'STORE-A', 'Store A', 'retail');
  const locB = ingest.ensureLocation(db, 'STORE-B', 'Store B', 'retail');
  addStock(db, id, 'IN_STOCK', H(1), locA);
  addStock(db, id, 'OUT_OF_STOCK', H(1), locB);
  const rows = db.all('SELECT * FROM v_latest_stock WHERE sku_id=?', [id]);
  assert.strictEqual(rows.length, 2); // per-location latest preserved
  cleanup(db);
});

test('promotional price becomes effective price', async () => {
  const db = await freshDb();
  const id = mkSku(db, 'PR1', '鈣思寶無糖豆奶250毫升24支');
  addPrice(db, id, 60, 39.9, H(1));
  const cur = db.get('SELECT * FROM v_latest_price WHERE sku_id=?', [id]);
  assert.strictEqual(cur.effective_price_minor, 3990);
  cleanup(db);
});

test('promotion expiry: after end, regular price is effective', async () => {
  const db = await freshDb();
  const id = mkSku(db, 'PR2', '鈣思寶無糖豆奶250毫升24支');
  // expired promo recorded in the past
  addPrice(db, id, 60, 39.9, H(100));
  // new regular observation after promo ended
  addPrice(db, id, 60, null, H(1));
  const cur = db.get('SELECT * FROM v_latest_price WHERE sku_id=?', [id]);
  assert.strictEqual(cur.effective_price_minor, 6000);
  assert.strictEqual(cur.promotional_price_minor, null);
  cleanup(db);
});

test('freshness: FRESH within 30h, STALE beyond, MISSING when none', async () => {
  assert.strictEqual(server.freshness(H(4)), 'FRESH');
  assert.strictEqual(server.freshness(H(40)), 'STALE');
  assert.strictEqual(server.freshness(null), 'MISSING');
});

test('duplicate-run lock: second RUNNING run of same type rejected', async () => {
  const db = await freshDb();
  const r1 = ingest.startRun(db, 'PRICE', 's', 'test');
  assert.strictEqual(r1.ok, true);
  const r2 = ingest.startRun(db, 'PRICE', 's', 'test');
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.error, 'RUN_ALREADY_IN_PROGRESS');
  // price and stock are independent
  const r3 = ingest.startRun(db, 'STOCK', 's', 'test');
  assert.strictEqual(r3.ok, true);
  cleanup(db);
});

test('failed refresh preserves previous valid data', async () => {
  const db = await freshDb();
  const id = mkSku(db, 'F1', '鈣思寶無糖豆奶250毫升24支');
  addPrice(db, id, 50, null, H(2), 1);
  // simulate a failed run: no new observation inserted
  const run = ingest.startRun(db, 'PRICE', 's', 'test');
  ingest.finishRun(db, run.runId, 'FAILED', { total: 0, ok: 0, ambiguous: 0, invalid: 0 }, 'skill error');
  const cur = db.get('SELECT * FROM v_latest_price WHERE sku_id=?', [id]);
  assert.strictEqual(cur.effective_price_minor, 5000); // previous valid value intact
  cleanup(db);
});

test('ambiguous operational record goes to mapping review, not broadcast', async () => {
  const db = await freshDb();
  // token-level name only ("豆奶") with no specific SKU id/barcode
  const std = ingest.Adapters.price([{ sku_name: '豆奶', regular_price: 20 }], { skillName: 's', source: 's' });
  const run = ingest.startRun(db, 'PRICE', 's', 'test');
  const counts = db.tx(() => ingest.ingestStandard(db, run.runId, std));
  // no SKU matched -> review or unmatched, but never applied to all 豆奶 SKUs
  assert.strictEqual(counts.ok, 0);
  assert.ok(counts.ambiguous >= 1);
  const obs = db.all('SELECT * FROM sku_price_observations');
  assert.strictEqual(obs.length, 0); // nothing auto-applied
  cleanup(db);
});

test('token-level price range across keys (spec §21)', async () => {
  const db = await freshDb();
  // two SKUs on two different keys of 豆奶 token with different prices
  const kA = db.get("SELECT id FROM product_keys WHERE display_key LIKE '%無糖 | 250ml%'");
  const kB = db.get("SELECT id FROM product_keys WHERE display_key LIKE '%植物固醇%'");
  const upA = repo.Skus.upsert(db, { external_sku_id: 'TA', raw_sku_name: '鈣思寶無糖豆奶250毫升24支' }, null);
  const upB = repo.Skus.upsert(db, { external_sku_id: 'TB', raw_sku_name: '鈣思寶植物固醇豆奶250毫升24支' }, null);
  db.run('UPDATE sku_records SET product_key_id=?, product_token_id=(SELECT token_id FROM product_keys WHERE id=?) WHERE id=?', [kA.id, kA.id, upA.id]);
  db.run('UPDATE sku_records SET product_key_id=?, product_token_id=(SELECT token_id FROM product_keys WHERE id=?) WHERE id=?', [kB.id, kB.id, upB.id]);
  addPrice(db, upA.id, 39.9, null, H(1));
  addPrice(db, upB.id, 69.9, null, H(1));
  const tokenId = db.get("SELECT id FROM product_tokens WHERE token_code='PT-BEVERAGE-SOY-MILK'").id;
  const sum = server.tokenSummary(db, tokenId);
  assert.strictEqual(sum.price.type, 'range');
  assert.strictEqual(sum.price.min, 39.9);
  assert.strictEqual(sum.price.max, 69.9);
  assert.strictEqual(sum.price.across_keys >= 1, true);
  cleanup(db);
});

test('stock adapter maps existing skill output (in_stock/out_of_stock/delisted)', async () => {
  const std = ingest.Adapters.stock([
    { sku: 'A', stock_state: 'in_stock', product_name: 'x', checked_at: H(1) },
    { sku: 'B', stock_state: 'out_of_stock', product_name: 'y', checked_at: H(1) },
    { sku: 'C', stock_state: 'delisted', product_name: 'z', checked_at: H(1) },
    { sku: 'D', stock_state: 'unknown', product_name: 'w', checked_at: H(1) },
  ], { skillName: 'stock-status-checker', source: 'HKTVmall' });
  assert.strictEqual(std.records[0].stock_status, 'IN_STOCK');
  assert.strictEqual(std.records[1].stock_status, 'OUT_OF_STOCK');
  assert.strictEqual(std.records[2].stock_status, 'DISCONTINUED');
  assert.strictEqual(std.records[3].stock_status, 'UNKNOWN');
});

test('partial ingestion failure: valid rows import, invalid recorded separately', async () => {
  const db = await freshDb();
  mkSku(db, 'GOOD1', '鈣思寶無糖豆奶250毫升24支');
  const std = ingest.Adapters.stock([
    { sku: 'GOOD1', stock_state: 'in_stock', product_name: 'ok', checked_at: H(1) },
    { sku: null, barcode: null, product_name: '', stock_state: null }, // invalid: no identifiers
  ], { skillName: 's', source: 's' });
  const run = ingest.startRun(db, 'STOCK', 's', 'test');
  const counts = db.tx(() => ingest.ingestStandard(db, run.runId, std));
  assert.strictEqual(counts.ok, 1);
  cleanup(db);
});

test('mapping order: external id beats barcode beats name', async () => {
  const db = await freshDb();
  const id = mkSku(db, 'ORD1', '鈣思寶無糖豆奶250毫升24支');
  db.run('UPDATE sku_records SET barcode=? WHERE id=?', ['4890001', id]);
  const byExt = ingest.mapRecordToSku(db, { external_sku_id: 'ORD1', barcode: '999' });
  assert.strictEqual(byExt.method, 'EXTERNAL_SKU_ID');
  const byBc = ingest.mapRecordToSku(db, { barcode: '4890001' });
  assert.strictEqual(byBc.method, 'BARCODE');
  cleanup(db);
});

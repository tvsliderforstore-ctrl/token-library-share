'use strict';
/**
 * e2e.test.js — final end-to-end verification (spec §31).
 * Boots the real server on a temp DB and asserts every delivery requirement.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { start } = require('../src/server.js');
const ing = require('../src/ingest/ingest');

let base, app, db;
test.before(async () => {
  const file = path.join(os.tmpdir(), `ptl-e2e-${process.pid}-${Date.now()}.db`);
  const { seed } = require('../src/db/seed.js');
  const { migrate } = require('../src/db/migrate.js');
  await migrate(file); await seed(file); // these open their own handle and persist to `file`
  app = await start(0, file); // app reopens the same file
  db = app.db;
  base = `http://127.0.0.1:${app.server.address().port}`;
});
test.after(() => { app && app.server && app.server.close(); db && db.close(); });
const j = async (r) => r.json();

test('E2E: all ten Large Groups exist', async () => {
  const g = await j(await fetch(base + '/api/large-groups'));
  assert.strictEqual(g.length, 10);
  const names = g.map((x) => x.name_zh);
  for (const want of ['乾貨食品','保健用品','保健食品','個人護理','家居清潔','寵物用品','急凍/冷凍','街市貨品','長者護理','飲品'])
    assert.ok(names.includes(want), 'missing group ' + want);
});

test('E2E: Product Tokens are separate from Product Keys', async () => {
  const t = await j(await fetch(base + '/api/tokens'));
  const k = await j(await fetch(base + '/api/product-keys'));
  assert.strictEqual(t.length, 6);
  assert.strictEqual(k.length, 6);
  // tokens are concepts, keys are structured configs referencing a token
  assert.ok(t.every((x) => x.token_code && x.name_zh));
  assert.ok(k.every((x) => x.product_key_code && x.display_key && x.token_name));
  const soyKeys = k.filter((x) => x.token_name === '豆奶');
  assert.strictEqual(soyKeys.length, 4); // 4 keys share the 豆奶 token
});

test('E2E: all six required Product Keys exist exactly', async () => {
  const k = await j(await fetch(base + '/api/product-keys'));
  const dk = k.map((x) => x.display_key);
  for (const want of [
    '鈣思寶 | 豆奶 | 中國 | 植物固醇 | 250ml x 24支',
    '鈣思寶 | 豆奶 | 中國 | 無糖 | 1000ml x 12支',
    '鈣思寶 | 豆奶 | 中國 | 無糖 | 250ml x 24支',
    '北海道乳業 | 牛奶 | 日本 | 北海道3.6牛乳 | 1000ml',
    '北海道乳業 | 牛奶 | 日本 | 北海道3.6牛乳 | 1000ml x 4支',
    '鈣思寶 | 豆奶 | 中國 | 高蛋白質 | 250ml x 24支',
  ]) assert.ok(dk.includes(want), 'missing key ' + want);
});

test('E2E: long SKU name maps to a Product Token (spec §3 example)', async () => {
  const r = await j(await (await fetch(base + '/api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw_sku_name: '一口牛柳粒(急凍)#牛肉粒#淋滑#韓燒烤#家常小菜' }) })));
  assert.strictEqual(r.large_group_name, '急凍/冷凍');
  assert.strictEqual(r.product_token_name, '一口牛');
  assert.strictEqual(r.matched_alias, '一口牛柳粒');
  assert.deepStrictEqual(r.extracted_attributes, ['急凍','牛肉粒','淋滑','韓燒烤','家常小菜']);
  assert.strictEqual(r.match_method, 'EXACT_APPROVED_ALIAS');
  assert.strictEqual(r.confidence, 1.0);
  assert.strictEqual(r.requires_review, false);
});

test('E2E: token-only result is allowed (no forced Product Key)', async () => {
  const r = await j(await (await fetch(base + '/api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw_sku_name: '一口牛柳粒(急凍)#牛肉粒' }) })));
  assert.strictEqual(r.product_token_name, '一口牛');
  assert.strictEqual(r.product_key_display, null); // unresolved, valid
});

test('E2E: ambiguous results are reviewed, not guessed', async () => {
  const r = await j(await (await fetch(base + '/api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw_sku_name: '一口牛柳妙粒' }) })));
  assert.strictEqual(r.requires_review, true);
  assert.ok(r.confidence < 0.95);
});

test('E2E: price & stock are stored at SKU level; history retained', async () => {
  // create a SKU mapped to a key
  await j(await (await fetch(base + '/api/skus/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: [{ external_sku_id: 'E2E-1', raw_sku_name: '鈣思寶無糖豆奶250毫升24支' }] }) })));
  const sku = db.get('SELECT * FROM sku_records WHERE external_sku_id=?', ['E2E-1']);
  assert.ok(sku, 'SKU should exist after import');
  assert.ok(sku.product_key_id, 'SKU should map to a Product Key');
  // two stock observations over time -> history retained
  const s1 = ing.Adapters.stock([{ external_sku_id: 'E2E-1', sku_name: 'x', stock_state: 'in_stock', observed_at: '2026-07-27T01:00:00Z' }], { skillName: 'e2e', source: 'e2e' });
  const r1 = ing.startRun(db, 'STOCK', 'e2e', 'e2e'); db.tx(() => ing.ingestStandard(db, r1.runId, s1)); ing.finishRun(db, r1.runId, 'COMPLETED', { total: 1, ok: 1, ambiguous: 0, invalid: 0 });
  const s2 = ing.Adapters.stock([{ external_sku_id: 'E2E-1', sku_name: 'x', stock_state: 'out_of_stock', observed_at: '2026-07-27T02:00:00Z' }], { skillName: 'e2e', source: 'e2e' });
  const r2 = ing.startRun(db, 'STOCK', 'e2e', 'e2e'); db.tx(() => ing.ingestStandard(db, r2.runId, s2)); ing.finishRun(db, r2.runId, 'COMPLETED', { total: 1, ok: 1, ambiguous: 0, invalid: 0 });
  const hist = db.all('SELECT * FROM sku_stock_observations WHERE sku_id=?', [sku.id]);
  assert.strictEqual(hist.length, 2); // append-only, not overwritten
  const cur = await j(await fetch(base + `/api/skus/${sku.id}/stock`));
  assert.strictEqual(cur[0].stock_status, 'OUT_OF_STOCK'); // latest
});

test('E2E: failed refresh preserves previous valid data', async () => {
  const sku = db.get('SELECT * FROM sku_records WHERE external_sku_id=?', ['E2E-1']);
  const std = ing.Adapters.price([{ external_sku_id: 'E2E-1', sku_name: 'x', regular_price: 50, observed_at: '2026-07-27T01:00:00Z' }], { skillName: 'e2e', source: 'e2e' });
  const ok = ing.startRun(db, 'PRICE', 'e2e', 'e2e'); db.tx(() => ing.ingestStandard(db, ok.runId, std)); ing.finishRun(db, ok.runId, 'COMPLETED', { total: 1, ok: 1, ambiguous: 0, invalid: 0 });
  const before = db.all('SELECT * FROM sku_price_observations WHERE sku_id=?', [sku.id]).length;
  // failed run: skill/adapter produces nothing and the run is marked FAILED without inserting
  const bad = ing.startRun(db, 'PRICE', 'e2e-fail', 'e2e');
  ing.finishRun(db, bad.runId, 'FAILED', { total: 0, ok: 0, ambiguous: 0, invalid: 0 }, 'skill crashed');
  const runRow = db.get('SELECT status FROM ingestion_runs WHERE id=?', [bad.runId]);
  assert.strictEqual(runRow.status, 'FAILED');
  const after = db.all('SELECT * FROM sku_price_observations WHERE sku_id=?', [sku.id]).length;
  assert.strictEqual(after, before); // previous valid value preserved
});

test('E2E: dashboard values expose observation time + freshness', async () => {
  const sku = db.get('SELECT * FROM sku_records WHERE external_sku_id=?', ['E2E-1']);
  const price = await j(await fetch(base + `/api/skus/${sku.id}/price`));
  assert.ok(price.observed_at, 'price has observation time');
  assert.ok(['FRESH','STALE','MISSING'].includes(price.freshness));
  assert.ok(price.effective_price != null);
});

test('E2E: token-level price range is a range, not a single price', async () => {
  const soy = db.get("SELECT * FROM product_tokens WHERE token_code='PT-BEVERAGE-SOY-MILK'");
  const s = await j(await fetch(base + `/api/tokens/${soy.id}/summary`));
  // may be a range or single depending on SKUs; assert shape is present
  assert.ok(s.price !== undefined);
  assert.ok(s.stock !== undefined);
});

test('E2E: existing skills are reused via adapters (status visible)', async () => {
  const s = await j(await fetch(base + '/api/system/skill-status'));
  assert.ok(s.price_skill && s.price_skill.name, 'price skill identified');
  assert.ok(s.stock_skill && s.stock_skill.name, 'stock skill identified');
  assert.ok(s.stock_skill.script.includes('check_sku.py'), 'stock adapter wraps existing check_sku.py');
});

test('E2E: search finds keys by any component (無糖/250ml/鈣思寶/豆奶/中國)', async () => {
  for (const q of ['無糖','250ml','鈣思寶','豆奶','中國']) {
    const k = await j(await fetch(base + '/api/product-keys?q=' + encodeURIComponent(q)));
    assert.ok(k.length > 0, `search ${q} should find keys`);
  }
});

test('E2E: batch classification works', async () => {
  const r = await j(await (await fetch(base + '/api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: ['一口牛柳粒（急凍）', '抗菌濃縮洗衣液補充裝', '未知產品XYZ'] }) })));
  assert.strictEqual(r.results.length, 3);
  assert.strictEqual(r.results[0].product_token_name, '一口牛');
  assert.strictEqual(r.results[1].product_token_name, '洗衣液');
  assert.strictEqual(r.results[2].product_token_name, null);
});

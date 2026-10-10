'use strict';
/** classification.test.js — required classification + normalization cases (spec §26). */
const test = require('node:test');
const assert = require('node:assert');
const { freshDb, cleanup } = require('./helpers');
const { classify, classifyBatch } = require('../src/classify/classify');
const n = require('../src/lib/normalize');

test('seed: 10 large groups, 6 tokens, 6 product keys exist', async () => {
  const db = await freshDb();
  assert.strictEqual(db.get('SELECT COUNT(*) c FROM large_groups').c, 10);
  assert.strictEqual(db.get('SELECT COUNT(*) c FROM product_tokens').c, 6);
  assert.strictEqual(db.get('SELECT COUNT(*) c FROM product_keys').c, 6);
  cleanup(db);
});

test('required: long SKU name maps to token-only with extracted attributes', async () => {
  const db = await freshDb();
  const r = classify(db, '一口牛柳粒(急凍)#牛肉粒#淋滑#韓燒烤#家常小菜');
  assert.strictEqual(r.large_group_name, '急凍/冷凍');
  assert.strictEqual(r.product_token_name, '一口牛');
  assert.strictEqual(r.matched_alias, '一口牛柳粒');
  assert.strictEqual(r.match_method, 'EXACT_APPROVED_ALIAS');
  assert.strictEqual(r.confidence, 1.0);
  assert.strictEqual(r.requires_review, false);
  assert.deepStrictEqual(r.extracted_attributes, ['急凍', '牛肉粒', '淋滑', '韓燒烤', '家常小菜']);
  // attributes must not create new tokens
  assert.strictEqual(db.get("SELECT COUNT(*) c FROM product_tokens WHERE name_zh='牛肉粒'").c, 0);
  cleanup(db);
});

test('required: full-width brackets 一口牛柳粒（急凍）', async () => {
  const db = await freshDb();
  const r = classify(db, '一口牛柳粒（急凍）');
  assert.strictEqual(r.product_token_name, '一口牛');
  cleanup(db);
});

test('required: hashtag with spaces 一口牛柳粒 # 家常小菜', async () => {
  const db = await freshDb();
  const r = classify(db, '一口牛柳粒 # 家常小菜');
  assert.strictEqual(r.product_token_name, '一口牛');
  cleanup(db);
});

test('required: 鈣思寶無糖豆奶250毫升24支 -> token + full product key', async () => {
  const db = await freshDb();
  const r = classify(db, '鈣思寶無糖豆奶250毫升24支');
  assert.strictEqual(r.product_token_name, '豆奶');
  assert.strictEqual(r.product_key_display, '鈣思寶 | 豆奶 | 中國 | 無糖 | 250ml x 24支');
  cleanup(db);
});

test('required: 北海道乳業北海道3.6牛乳1000ml四支裝 -> token + key (4支裝)', async () => {
  const db = await freshDb();
  const r = classify(db, '北海道乳業北海道3.6牛乳1000ml四支裝');
  assert.strictEqual(r.product_token_name, '牛奶');
  assert.strictEqual(r.product_key_display, '北海道乳業 | 牛奶 | 日本 | 北海道3.6牛乳 | 1000ml x 4支');
  cleanup(db);
});

test('token identification without full key (spec §9)', async () => {
  const db = await freshDb();
  assert.strictEqual(classify(db, '柔軟加厚一次性潔面洗臉巾 80片').product_token_name, '洗臉巾');
  assert.strictEqual(classify(db, '抗菌濃縮洗衣液補充裝').product_token_name, '洗衣液');
  assert.strictEqual(classify(db, '三合一香味洗衣珠 30粒').product_token_name, '洗衣珠');
  cleanup(db);
});

test('longest-alias priority beats generic terms', async () => {
  const db = await freshDb();
  // 一口牛柳粒 (approved) must beat generic 牛肉粒 if both present
  const r = classify(db, '急凍一口牛柳粒 牛肉粒');
  assert.strictEqual(r.product_token_name, '一口牛');
  assert.strictEqual(r.matched_alias, '急凍一口牛柳粒'); // longest approved alias wins
  cleanup(db);
});

test('unknown product -> UNMATCHED, requires review, never guessed', async () => {
  const db = await freshDb();
  const r = classify(db, '某完全唔知咩產品XYZ999');
  assert.strictEqual(r.match_method, 'UNMATCHED');
  assert.strictEqual(r.confidence, 0);
  assert.strictEqual(r.requires_review, true);
  assert.strictEqual(r.product_token_name, null);
  cleanup(db);
});

test('ambiguous fuzzy match requires review (not auto-accepted)', async () => {
  const db = await freshDb();
  const r = classify(db, '一口牛柳妙粒'); // near-miss of 一口牛柳粒
  // fuzzy path must not reach auto-accept band
  assert.ok(r.confidence < 0.95, 'fuzzy must not auto-accept');
  assert.strictEqual(r.requires_review, true);
  cleanup(db);
});

test('normalization: full/half-width, x/X/×, ml/mL/ML/毫升', () => {
  assert.strictEqual(n.normalize('250ML X24'), '250ml x24');
  assert.strictEqual(n.normalize('２５０毫升×２４支'), '250mlx24支'); // spaces around x stripped by dedupePunctuation
  const p1 = n.parsePackSize('250ml x 24支');
  assert.deepStrictEqual([p1.unit_size, p1.unit_measurement, p1.pack_count, p1.pack_unit], [250, 'ml', 24, '支']);
  const p2 = n.parsePackSize('1000ml');
  assert.deepStrictEqual([p2.unit_size, p2.unit_measurement, p2.pack_count], [1000, 'ml', null]);
  const p3 = n.parsePackSize('1公升');
  assert.deepStrictEqual([p3.unit_size, p3.unit_measurement], [1, 'L']);
  const p4 = n.parsePackSize('1000ml x 4支');
  assert.deepStrictEqual([p4.unit_size, p4.pack_count], [1000, 4]);
});

test('pack-count from Chinese number 四支裝', () => {
  const p = n.parsePackSize('北海道3.6牛乳1000ml四支裝');
  assert.strictEqual(p.pack_count, 4);
  assert.strictEqual(p.pack_unit, '支');
});

test('numbers that are not sizes are not misread (dates/percentages)', () => {
  // 3.6牛乳 -> 3.6 is a percentage-like decimal, not ml; no unit -> no size
  const p = n.parsePackSize('北海道3.6牛乳');
  assert.strictEqual(p.unit_size, null);
});

test('Simplified and Traditional fingerprints dedupe the same key', () => {
  const trad = n.keyFingerprint({ brand: '鈣思寶', token: '豆奶', origin: '中國', variant: '無糖', unit_size: 250, unit_measurement: 'ml', pack_count: 24, pack_unit: '支' });
  const simp = n.keyFingerprint({ brand: '钙思宝', token: '豆奶', origin: '中国', variant: '无糖', unit_size: 250, unit_measurement: '毫升', pack_count: 24, pack_unit: '支' });
  assert.strictEqual(trad, simp);
});

test('mixed Chinese and English normalization preserves Chinese', () => {
  const out = n.normalize('Tempo 得寶 盒裝面紙 (無香) #家庭裝');
  assert.ok(out.includes('得寶'));
  assert.ok(out.includes('面紙'));
});

test('search forms generated without replacing display form', () => {
  const a = n.analyze('鈣思寶無糖豆奶');
  assert.strictEqual(a.base_title, '鈣思寶無糖豆奶'); // display preserved
  assert.strictEqual(a.search_simplified, '钙思宝无糖豆奶');
});

test('batch classification returns array of results', async () => {
  const db = await freshDb();
  const out = classifyBatch(db, ['一口牛柳粒（急凍）', '鈣思寶無糖豆奶250毫升24支']);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].product_token_name, '一口牛');
  assert.strictEqual(out[1].product_key_display, '鈣思寶 | 豆奶 | 中國 | 無糖 | 250ml x 24支');
  cleanup(db);
});

test('duplicate product key fingerprint rejected', async () => {
  const db = await freshDb();
  const repo = require('../src/db/repo');
  const token = db.get("SELECT id FROM product_tokens WHERE token_code='PT-BEVERAGE-SOY-MILK'");
  const brand = db.get("SELECT id FROM brands WHERE display_name='鈣思寶'");
  const origin = db.get("SELECT id FROM origins WHERE name_zh='中國'");
  assert.throws(() => repo.Keys.create(db, { token_id: token.id, brand_id: brand.id, origin_id: origin.id, variant: '無糖', unit_size: 250, unit_measurement: 'ml', pack_count: 24, pack_unit: '支' }), /DUPLICATE_PRODUCT_KEY/);
  cleanup(db);
});

test('token-only result allowed when brand/pack missing (spec §3)', async () => {
  const db = await freshDb();
  const r = classify(db, '一口牛柳粒(急凍)#牛肉粒');
  assert.strictEqual(r.product_token_name, '一口牛');
  assert.strictEqual(r.product_key_display, null); // unresolved key is valid
  cleanup(db);
});

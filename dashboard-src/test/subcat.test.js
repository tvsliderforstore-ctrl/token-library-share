'use strict';
/**
 * subcat.test.js — automated tests for the hierarchical Sub Cat browsing feature.
 * Runs against a throwaway copy of the real DB (never touches live). Plain Node script
 * (no test framework on this host). Exit 0 on all-pass.
 *
 *   node test/subcat.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Database } = require('../src/db/db');
const repo = require('../src/db/repo');
const { migrate } = require('../src/db/migrate');
const seed = require('../src/db/seed_subcategories');
const config = require('../src/config');

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) { passed++; console.log('  ✓', name); } else { failed++; console.log('  ✗ FAIL:', name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), `${name} (got ${JSON.stringify(a)})`); }

(async () => {
  // build a fresh test DB from the live file
  const src = config.dbFile;
  const tmp = path.join(os.tmpdir(), `ptl-subcat-test-${Date.now()}.db`);
  fs.copyFileSync(src, tmp);
  await migrate(tmp);
  await seed.run(tmp);
  const db = await Database.open(tmp);

  console.log('\n[1] All 10 Main Cats display');
  const mains = repo.Categories.mainList(db);
  eq(mains.length, 10, 'ten main cats');
  eq(mains.map(m => m.name), ['乾貨食品','保健用品','保健食品','個人護理','家居清潔','寵物用品','急凍/冷凍','街市貨品','長者護理','飲品'], 'approved order');

  console.log('\n[2/3] Clicking a Main Cat shows only its Sub Cats (no unrelated)');
  const bev = repo.Categories.subList(db, 'BEVERAGES');
  eq(bev.sub_cats.map(s => s.name), ['水/汽水','沖調飲品','豆奶/奶類','果汁/能量飲品/電解質水','茶/咖啡'], 'beverage subcats only');
  ok(!bev.sub_cats.some(s => s.name === '魚'), 'no 魚 under 飲品');
  const froz = repo.Categories.subList(db, 'FROZEN');
  ok(froz.sub_cats.some(s => s.name === '魚'), '魚 present under 急凍/冷凍');

  console.log('\n[4/5/6/7] Sub Cat -> SKU list, default 30/page, page 2, last page');
  const p1 = repo.Categories.skusInSub(db, 'BEV_SOY_DAIRY', {});
  eq(p1.pagination.page_size, 30, 'default page size 30');
  eq(p1.rows.length, 30, 'page 1 has 30 rows');
  eq(p1.pagination.total_rows, 41, 'total 41');
  eq(p1.pagination.total_pages, 2, 'total 2 pages');
  const p2 = repo.Categories.skusInSub(db, 'BEV_SOY_DAIRY', { page: 2 });
  eq(p2.rows.length, 11, 'last page has 11 (<30)');
  ok(p1.rows[0].sku_id !== p2.rows[0].sku_id, 'page 2 differs from page 1');

  console.log('\n[8] Filters reset to page 1 (query returns pagination.page=1)');
  const f1 = repo.Categories.skusInSub(db, 'BEV_SOY_DAIRY', { keyword: '高蛋白' });
  eq(f1.pagination.page, 1, 'filtered query page=1');
  ok(f1.pagination.total_rows < 41, 'keyword narrows result');

  console.log('\n[9] Search works inside selected Sub Cat');
  const kw = repo.Categories.skusInSub(db, 'BEV_SOY_DAIRY', { keyword: '高蛋白' });
  ok(kw.rows.every(r => r.product_name.includes('高蛋白')), 'all rows match keyword');

  console.log('\n[10] Brand filter only lists brands present in Sub Cat');
  const brands = repo.Categories.brandsInSub(db, 'BEV_SOY_DAIRY');
  eq(brands, ['鈣思寶'], 'only 鈣思寶 in 豆奶/奶類');

  console.log('\n[11/12] Main/Sub relationship validation + invalid assignment rejected');
  const fishSub = db.get("SELECT id FROM sub_categories WHERE sub_cat_code='FRZ_FISH'");
  const bevSku = db.get("SELECT s.id FROM sku_records s JOIN large_groups g ON g.id=s.large_group_id WHERE g.group_code='BEVERAGES' LIMIT 1");
  let rejected = false;
  try { db.run('UPDATE sku_records SET sub_category_id=? WHERE id=?', [fishSub.id, bevSku.id]); }
  catch (e) { rejected = /SUBCAT_GROUP_MISMATCH/.test(e.message); }
  ok(rejected, 'cross-group (飲品+魚) rejected');

  console.log('\n[13] Empty Sub Cat state (0 SKUs)');
  const empty = repo.Categories.skusInSub(db, 'BEV_TEA_COFFEE', {});
  eq(empty.pagination.total_rows, 0, 'empty subcat total 0');
  eq(empty.rows.length, 0, 'empty subcat no rows');

  console.log('\n[16] page_size cap at 100');
  const cap = repo.Categories.skusInSub(db, 'BEV_SOY_DAIRY', { page_size: 500 });
  eq(cap.pagination.page_size, 100, 'page_size capped at 100');

  console.log('\n[17] Server-side pagination (LIMIT/OFFSET) — page param validated >=1');
  const pneg = repo.Categories.skusInSub(db, 'BEV_SOY_DAIRY', { page: -5 });
  eq(pneg.pagination.page, 1, 'page<1 coerced to 1');

  console.log('\n[19/20] Inactive Sub Cats hidden from browsing, visible with includeInactive');
  db.run("UPDATE sub_categories SET active=0 WHERE sub_cat_code='BEV_TEA_COFFEE'");
  const norm = repo.Categories.subList(db, 'BEVERAGES');
  ok(!norm.sub_cats.some(s => s.code === 'BEV_TEA_COFFEE'), 'inactive hidden by default');
  const withIn = repo.Categories.subList(db, 'BEVERAGES', { includeInactive: true });
  ok(withIn.sub_cats.some(s => s.code === 'BEV_TEA_COFFEE'), 'inactive visible to authorized');
  db.run("UPDATE sub_categories SET active=1 WHERE sub_cat_code='BEV_TEA_COFFEE'");

  console.log('\n[21] Category counts update after reclassification');
  const before = repo.Categories.getSub(db, 'BEV_SOY_DAIRY');
  const cntBefore = repo.Categories.subList(db, 'BEVERAGES').sub_cats.find(s => s.code === 'BEV_SOY_DAIRY').sku_count;
  const oneSku = db.get('SELECT id FROM sku_records WHERE sub_category_id=? LIMIT 1', [before.id]);
  const waterSub = db.get("SELECT id FROM sub_categories WHERE sub_cat_code='BEV_WATER_SODA'");
  db.run('UPDATE sku_records SET sub_category_id=? WHERE id=?', [waterSub.id, oneSku.id]);
  const cntAfter = repo.Categories.subList(db, 'BEVERAGES').sub_cats.find(s => s.code === 'BEV_SOY_DAIRY').sku_count;
  eq(cntAfter, cntBefore - 1, 'count decremented after move');
  db.run('UPDATE sku_records SET sub_category_id=? WHERE id=?', [before.id, oneSku.id]); // restore

  console.log('\n[22] Missing Sub Cat records enter review queue');
  const skuNoSub = db.get('SELECT id FROM sku_records LIMIT 1');
  db.run('UPDATE sku_records SET sub_category_id=NULL, review_status=? WHERE id=?', ['PENDING', skuNoSub.id]);
  const ov = repo.Categories.subcatOverview(db);
  ok(ov.skus_missing_subcat >= 1, 'missing subcat counted');
  ok(ov.subcats_requiring_review >= 0, 'review metric present');
  db.run('UPDATE sku_records SET sub_category_id=?, review_status=? WHERE id=?', [before.id, 'NONE', skuNoSub.id]); // restore

  console.log('\n[extra] no generic fallback values used for subcat names');
  const allSubs = db.all('SELECT name_zh FROM sub_categories');
  ok(!allSubs.some(s => ['其他','未知','待定','Misc','Unknown'].includes(s.name_zh)), 'no 其他/未知/待定/Misc/Unknown subcats');

  db.close();
  fs.unlinkSync(tmp);
  console.log(`\n===== ${passed} passed, ${failed} failed =====`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(1); });

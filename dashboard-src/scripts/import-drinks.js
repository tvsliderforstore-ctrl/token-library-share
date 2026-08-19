'use strict';
/**
 * import-drinks.js — import the drink SKU workbook (Downloads/db test (drink).xlsx)
 * into the Product Token Library.
 *
 * Logic (per user direction: "follow your own logic"):
 *  - Token derived from the SKU NAME (not the file's empty token column):
 *      contains 杏仁奶 / 杏仁         → 杏仁奶 (new token, PT-BEVERAGE-ALMOND-MILK)
 *      contains 豆奶 / 大豆           → 豆奶   (existing)
 *      contains 牛乳 / 牛奶           → 牛奶   (existing)
 *  - Product Key fields parsed from the file's `group_key`
 *      品牌 | token | 產地 | variant | pack
 *    but the token segment is overridden by the name-derived token above, and the
 *    pack spec is parsed from `packing_spec` (more reliable than the free-text key).
 *  - Missing Product Keys are created via repo.Keys.create (fingerprint dedupes).
 *  - Each SKU is upserted with an exact product_key mapping (confidence 1.0, no review).
 *  - `Today selling price` is stored as an append-only price observation.
 *
 * Usage:
 *   node scripts/import-drinks.js "C:/Users/chlam/Downloads/db test (drink).xlsx"
 */
const path = require('path');
const os = require('os');
const ExcelJS = require('exceljs');

const ROOT = path.join(__dirname, '..');
const { Database } = require(path.join(ROOT, 'src', 'db', 'db.js'));
const { migrate } = require(path.join(ROOT, 'src', 'db', 'migrate.js'));
const { seed } = require(path.join(ROOT, 'src', 'db', 'seed.js'));
const repo = require(path.join(ROOT, 'src', 'db', 'repo.js'));
const { analyze, keyFingerprint } = require(path.join(ROOT, 'src', 'lib', 'normalize.js'));
const config = require(path.join(ROOT, 'src', 'config.js'));

const NOW = () => new Date().toISOString();
const cents = (v) => {
  if (v == null || v === '' || isNaN(Number(v))) return null;
  return Math.round(Number(v) * 100);
};
// build "250ml x 24支" style pack text (mirrors repo packFormat)
function packFormat(unitSize, unitMeasurement, packCount, packUnit) {
  if (unitSize == null) return null;
  let s = `${unitSize}${unitMeasurement || ''}`.trim();
  if (packCount != null) s += ` x ${packCount}${packUnit || ''}`.trim();
  return s;
}

// ---- token derivation from name ----
function deriveToken(name) {
  const n = String(name || '');
  if (/杏仁/.test(n)) return { code: 'PT-BEVERAGE-ALMOND-MILK', zh: '杏仁奶' };
  if (/豆奶|大豆|植物奶|soya|soy/i.test(n)) return { code: 'PT-BEVERAGE-SOY-MILK', zh: '豆奶' };
  if (/牛乳|牛奶|milk/i.test(n)) return { code: 'PT-BEVERAGE-MILK', zh: '牛奶' };
  return { code: 'PT-BEVERAGE-SOY-MILK', zh: '豆奶' }; // workbook is a 豆奶 category; safe default
}

// ---- pack parsing from packing_spec ----
function parsePack(spec) {
  if (!spec) return { unit_size: null, unit_measurement: null, pack_count: null, pack_unit: null };
  let s = String(spec).replace(/×/g, 'x').replace(/X/g, 'x').replace(/\*/g, 'x').replace(/\s+/g, '');
  const unit = (u) => {
    if (!u) return null;
    const m = u.toLowerCase();
    if (['ml', '毫升', '亳升'].includes(m)) return 'ml';
    if (['l', '公升', '升'].includes(m)) return 'L';
    if (['g', '克'].includes(m)) return 'g';
    if (['kg', '公斤'].includes(m)) return 'kg';
    return m;
  };
  // 250ml x 24支 | 250mlx24 | 1000ml x 6支 | 250ml x 6支
  let m = s.match(/(\d+(?:\.\d+)?)(ml|毫升|亳升|l|公升|升|g|克|kg|公斤)x(\d+)(支|粒|片|包|盒|個|件)?/i);
  if (m) return { unit_size: +m[1], unit_measurement: unit(m[2]), pack_count: +m[3], pack_unit: m[4] || '支' };
  // bare 1000ml / 250ml
  m = s.match(/(\d+(?:\.\d+)?)(ml|毫升|亳升|l|公升|升|g|克|kg|公斤)/i);
  if (m) return { unit_size: +m[1], unit_measurement: unit(m[2]), pack_count: null, pack_unit: null };
  return { unit_size: null, unit_measurement: null, pack_count: null, pack_unit: null };
}

// ---- group_key split ----
function splitGroupKey(gk) {
  const parts = String(gk || '').split('|').map((x) => x.trim());
  return {
    brand: parts[0] || null,
    origin: parts[2] || null,
    variant: parts[3] || null,
  };
}

// normalize a couple of messy variants to keep keys clean & deduped
function cleanVariant(v, name) {
  if (!v) return null;
  let x = v.replace(/\s+/g, '');
  if (x === '無糖原味' || x === '高鈣無糖') x = '無糖';
  return x;
}
// normalize origin text to the controlled set 中國 / 香港 / 日本
function cleanOrigin(o) {
  if (!o) return '中國';
  if (/香港|中國香港|HK/i.test(o)) return '香港';
  if (/日本|JP/i.test(o)) return '日本';
  return '中國';
}

function ensureToken(db, code, zh) {
  let t = repo.Tokens.byCode(db, code);
  if (t) return t;
  // create under 飲品
  const bev = repo.Groups.byCode(db, 'BEVERAGES');
  const now = NOW();
  db.run(`INSERT INTO product_tokens (token_code, name_zh, name_en, large_group_id, description, priority, active, taxonomy_version, created_at, updated_at)
          VALUES (?,?,?,?,?,0,1,?,?,?)`, [code, zh, null, bev.id, `${zh}（由飲品匯入建立）`, config.taxonomyVersion, now, now]);
  return repo.Tokens.byCode(db, code);
}
function ensureBrand(db, name) {
  if (!name) return null;
  let b = db.get('SELECT * FROM brands WHERE display_name=?', [name]);
  if (b) return b;
  const now = NOW();
  db.run('INSERT INTO brands (brand_code, display_name, active, created_at, updated_at) VALUES (?,?,1,?,?)',
    ['BR-' + name, name, now, now]);
  return db.get('SELECT * FROM brands WHERE display_name=?', [name]);
}
function ensureOrigin(db, nameZh) {
  if (!nameZh) return null;
  let o = db.get('SELECT * FROM origins WHERE name_zh=?', [nameZh]);
  if (o) return o;
  const now = NOW();
  db.run('INSERT INTO origins (origin_code, name_zh, active, created_at) VALUES (?,?,1,?)',
    ['ORIGIN-' + nameZh, nameZh, now]);
  return db.get('SELECT * FROM origins WHERE name_zh=?', [nameZh]);
}

async function main() {
  const file = process.argv[2] || path.join(os.homedir(), 'Downloads', 'db test (drink).xlsx');
  await migrate(config.dbFile);    // ensure schema exists (opens+closes its own handle)
  await seed(config.dbFile);       // ensure base taxonomy (idempotent)
  const db = await Database.open(config.dbFile);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const header = [];
  ws.getRow(1).eachCell((c) => header.push(String(c.value || '').trim()));
  const col = (name) => header.indexOf(name) + 1;

  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const get = (name) => { const i = col(name); return i > 0 ? row.getCell(i).value : null; };
    rows.push({
      external_sku_id: get('sku id'),
      raw_sku_name: get('sku name'),
      brand: get('brand name'),
      packing_spec: get('packing_spec'),
      manu_country: get('manu_country'),
      group_key: get('group_key'),
      price: get('Today selling price'),
      sub_cate: get('Lite apps sub cate'),
      main_cate: get('Lite apps main cate'),
    });
  });

  const runAt = NOW();
  const stats = { rows: 0, keysCreated: 0, keysReused: 0, skusCreated: 0, skusUpdated: 0, prices: 0, tokens: new Set() };

  db.tx(() => {
    for (const r of rows) {
      if (!r.external_sku_id || !r.raw_sku_name) continue;
      stats.rows++;

      const tok = deriveToken(r.raw_sku_name);
      const token = ensureToken(db, tok.code, tok.zh);
      const gk = splitGroupKey(r.group_key);
      const brand = ensureBrand(db, r.brand || gk.brand);
      const origin = ensureOrigin(db, cleanOrigin(r.manu_country || gk.origin));
      const variant = cleanVariant(gk.variant, r.raw_sku_name);
      const pack = parsePack(r.packing_spec);

      // find-or-create Product Key
      const fields = {
        token_id: token.id,
        brand_id: brand ? brand.id : null,
        origin_id: origin ? origin.id : null,
        variant,
        unit_size: pack.unit_size,
        unit_measurement: pack.unit_measurement,
        pack_count: pack.pack_count,
        pack_unit: pack.pack_unit,
      };
      const displayKey = [brand && brand.display_name, token.name_zh, origin && origin.name_zh, variant,
        packFormat(pack.unit_size, pack.unit_measurement, pack.pack_count, pack.pack_unit)]
        .filter(Boolean).join(' | ');
      let key;
      const fp = keyFingerprint({
        brand: brand && brand.display_name, token: token.name_zh, origin: origin && origin.name_zh,
        variant, unit_size: pack.unit_size, unit_measurement: pack.unit_measurement,
        pack_count: pack.pack_count, pack_unit: pack.pack_unit,
      });
      const existingKey = repo.Keys.byFingerprint(db, fp);
      if (existingKey) { key = repo.Keys.get(db, existingKey.id); stats.keysReused++; }
      else {
        key = repo.Keys.create(db, { ...fields, display_key: displayKey }, 'import-drinks');
        stats.keysCreated++;
      }

      // upsert SKU mapped exactly to this key
      const classification = {
        large_group_id: token.large_group_id,
        product_token_id: token.id,
        product_key_id: key.id,
        confidence: 1.0,
        match_method: 'EXACT_IMPORT',
        requires_review: false,
      };
      const up = repo.Skus.upsert(db, {
        external_sku_id: String(r.external_sku_id),
        raw_sku_name: String(r.raw_sku_name),
        sales_channel: 'HKTVmall',
        variant_metadata: { sub_cate: r.sub_cate, main_cate: r.main_cate, packing_spec: r.packing_spec },
      }, classification);
      if (up.created) stats.skusCreated++; else stats.skusUpdated++;
      stats.tokens.add(token.name_zh);

      // price observation (append-only)
      const eff = cents(r.price);
      if (eff != null) {
        db.run(`INSERT INTO sku_price_observations
          (sku_id, regular_price_minor, promotional_price_minor, effective_price_minor, currency,
           promotion_name, sales_channel, source_skill, source, observed_at, ingested_at, ingestion_run_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [up.id, eff, null, eff, 'HKD', null, 'HKTVmall', 'manual-import', 'db test (drink).xlsx', runAt, runAt, null]);
        stats.prices++;
      }
    }
  });
  db.save();

  console.log(JSON.stringify({
    file,
    rows_processed: stats.rows,
    tokens_used: [...stats.tokens],
    product_keys_created: stats.keysCreated,
    product_keys_reused: stats.keysReused,
    skus_created: stats.skusCreated,
    skus_updated: stats.skusUpdated,
    price_observations: stats.prices,
  }, null, 2));
  db.save();  // ensure synchronous flush to disk before exit
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

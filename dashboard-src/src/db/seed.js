'use strict';
/** seed.js — idempotent seed of required taxonomy (spec §2, §25). */
const { Database } = require('./db');
const { migrate } = require('./migrate');
const config = require('../config');
const { keyFingerprint } = require('../lib/normalize');

const NOW = () => new Date().toISOString();

const LARGE_GROUPS = [
  ['DRY_FOOD', '乾貨食品', 'Dry Food', 1],
  ['HEALTH_SUPPLIES', '保健用品', 'Health Supplies', 2],
  ['HEALTH_FOOD', '保健食品', 'Health Food', 3],
  ['PERSONAL_CARE', '個人護理', 'Personal Care', 4],
  ['HOME_CLEANING', '家居清潔', 'Home Cleaning', 5],
  ['PET_SUPPLIES', '寵物用品', 'Pet Supplies', 6],
  ['FROZEN', '急凍/冷凍', 'Frozen', 7],
  ['MARKET_PRODUCTS', '街市貨品', 'Market Products', 8],
  ['ELDERLY_CARE', '長者護理', 'Elderly Care', 9],
  ['BEVERAGES', '飲品', 'Beverages', 10],
];

const TOKENS = [
  // [token_code, name_zh, name_en, group_code, priority]
  ['PT-PERSONAL-CARE-FACE-TOWEL', '洗臉巾', 'Face Towel', 'PERSONAL_CARE', 10],
  ['PT-HOME-CLEANING-LAUNDRY-LIQUID', '洗衣液', 'Laundry Liquid', 'HOME_CLEANING', 10],
  ['PT-HOME-CLEANING-LAUNDRY-PODS', '洗衣珠', 'Laundry Pods', 'HOME_CLEANING', 10],
  ['PT-BEVERAGE-SOY-MILK', '豆奶', 'Soy Milk', 'BEVERAGES', 10],
  ['PT-BEVERAGE-MILK', '牛奶', 'Milk', 'BEVERAGES', 10],
  ['PT-FROZEN-BEEF-BITE', '一口牛', 'Beef Bite', 'FROZEN', 10],
];

const TOKEN_ALIASES = {
  'PT-FROZEN-BEEF-BITE': ['一口牛', '一口牛柳粒', '一口牛肉粒', '急凍一口牛柳粒'],
  'PT-BEVERAGE-SOY-MILK': ['豆奶', '豆漿'],
  'PT-BEVERAGE-MILK': ['牛奶', '牛乳', '鮮奶'],
  'PT-PERSONAL-CARE-FACE-TOWEL': ['洗臉巾', '潔面巾', '洗面巾', '一次性洗臉巾', '潔面洗臉巾'],
  'PT-HOME-CLEANING-LAUNDRY-LIQUID': ['洗衣液', '洗衣劑', '濃縮洗衣液'],
  'PT-HOME-CLEANING-LAUNDRY-PODS': ['洗衣珠', '洗衣凝珠', '洗衣球'],
};

const BRANDS = [
  ['BRAND-CALCIUM-PLUS', '鈣思寶', 'Calcium Plus'],
  ['BRAND-HOKKAIDO-DAIRY', '北海道乳業', 'Hokkaido Dairy'],
];

const BRAND_ALIASES = {
  '鈣思寶': ['鈣思寶', '钙思宝'],
  '北海道乳業': ['北海道乳業', '北海道'],
};

const ORIGINS = [
  ['ORIGIN-CN', '中國', 'China'],
  ['ORIGIN-JP', '日本', 'Japan'],
];

const PRODUCT_KEYS = [
  // [brand, token_code, origin, variant, unit_size, unit, pack_count, pack_unit]
  ['鈣思寶', 'PT-BEVERAGE-SOY-MILK', '中國', '植物固醇', 250, 'ml', 24, '支'],
  ['鈣思寶', 'PT-BEVERAGE-SOY-MILK', '中國', '無糖', 1000, 'ml', 12, '支'],
  ['鈣思寶', 'PT-BEVERAGE-SOY-MILK', '中國', '無糖', 250, 'ml', 24, '支'],
  ['北海道乳業', 'PT-BEVERAGE-MILK', '日本', '北海道3.6牛乳', 1000, 'ml', null, null],
  ['北海道乳業', 'PT-BEVERAGE-MILK', '日本', '北海道3.6牛乳', 1000, 'ml', 4, '支'],
  ['鈣思寶', 'PT-BEVERAGE-SOY-MILK', '中國', '高蛋白質', 250, 'ml', 24, '支'],
];

function trimNum(n) { return Number.isInteger(n) ? String(n) : String(n).replace(/\.?0+$/, ''); }
function packFormat(unit_size, unit, pack_count, pack_unit) {
  const size = unit_size != null && unit ? `${trimNum(unit_size)}${unit}` : null;
  const pack = pack_count != null ? `${pack_count}${pack_unit || ''}`.trim() : null;
  if (size && pack) return `${size} x ${pack}`;
  return size || pack || null;
}

async function seed(dbFile) {
  const file = dbFile || config.dbFile;
  await migrate(file);
  const db = await Database.open(file);
  const now = NOW();

  db.tx(() => {
    // Large groups
    for (const [code, zh, en, ord] of LARGE_GROUPS) {
      db.run(
        `INSERT INTO large_groups (group_code, name_zh, name_en, display_order, active, created_at, updated_at)
         VALUES (?,?,?,?,1,?,?)
         ON CONFLICT(group_code) DO UPDATE SET name_zh=excluded.name_zh, name_en=excluded.name_en, display_order=excluded.display_order`,
        [code, zh, en, ord, now, now]
      );
    }

    // Brands + aliases
    for (const [code, display, en] of BRANDS) {
      db.run(
        `INSERT INTO brands (brand_code, display_name, name_en, active, created_at, updated_at)
         VALUES (?,?,?,1,?,?)
         ON CONFLICT(display_name) DO UPDATE SET brand_code=excluded.brand_code, name_en=excluded.name_en`,
        [code, display, en, now, now]
      );
    }
    for (const [display, aliases] of Object.entries(BRAND_ALIASES)) {
      const b = db.get('SELECT id FROM brands WHERE display_name=?', [display]);
      if (!b) continue;
      for (const a of aliases) {
        db.run(
          `INSERT INTO brand_aliases (brand_id, alias, normalized, active, created_at)
           VALUES (?,?,?,1,?) ON CONFLICT(brand_id, normalized) DO NOTHING`,
          [b.id, a, a.toLowerCase(), now]
        );
      }
    }

    // Origins
    for (const [code, zh, en] of ORIGINS) {
      db.run(
        `INSERT INTO origins (origin_code, name_zh, name_en, active, created_at)
         VALUES (?,?,?,1,?) ON CONFLICT(name_zh) DO UPDATE SET origin_code=excluded.origin_code`,
        [code, zh, en, now]
      );
    }

    // Tokens
    for (const [code, zh, en, gcode, prio] of TOKENS) {
      const g = db.get('SELECT id FROM large_groups WHERE group_code=?', [gcode]);
      db.run(
        `INSERT INTO product_tokens (token_code, name_zh, name_en, large_group_id, priority, active, taxonomy_version, created_at, updated_at)
         VALUES (?,?,?,?,?,1,?,?,?)
         ON CONFLICT(token_code) DO UPDATE SET name_zh=excluded.name_zh, name_en=excluded.name_en, large_group_id=excluded.large_group_id`,
        [code, zh, en, g.id, prio, config.taxonomyVersion, now, now]
      );
    }

    // Token aliases (APPROVED so they are automatic matching rules)
    const { matchKey } = require('../lib/normalize');
    for (const [tcode, aliases] of Object.entries(TOKEN_ALIASES)) {
      const t = db.get('SELECT id FROM product_tokens WHERE token_code=?', [tcode]);
      if (!t) continue;
      for (const a of aliases) {
        db.run(
          `INSERT INTO product_token_aliases (token_id, alias, normalized, status, created_at, updated_at)
           VALUES (?,?,?,'APPROVED',?,?) ON CONFLICT(token_id, normalized) DO NOTHING`,
          [t.id, a, matchKey(a), now, now]
        );
      }
    }

    // Product Keys (exactly the six required; structured fields + fingerprint)
    let keySeq = 1;
    for (const [brand, tcode, origin, variant, usize, umeas, pcount, punit] of PRODUCT_KEYS) {
      const b = db.get('SELECT id FROM brands WHERE display_name=?', [brand]);
      const t = db.get('SELECT id FROM product_tokens WHERE token_code=?', [tcode]);
      const o = db.get('SELECT id FROM origins WHERE name_zh=?', [origin]);
      const tokenName = db.get('SELECT name_zh FROM product_tokens WHERE id=?', [t.id]).name_zh;
      const fmt = packFormat(usize, umeas, pcount, punit);
      const displayKey = [brand, tokenName, origin, variant, fmt].filter(Boolean).join(' | ');
      const fp = keyFingerprint({ brand, token: tokenName, origin, variant, unit_size: usize, unit_measurement: umeas, pack_count: pcount, pack_unit: punit });
      const existing = db.get('SELECT id FROM product_keys WHERE fingerprint=?', [fp]);
      if (!existing) {
        const code = `PK-${String(keySeq).padStart(6, '0')}`;
        // ensure unique code
        let finalCode = code; let n = keySeq;
        while (db.get('SELECT id FROM product_keys WHERE product_key_code=?', [finalCode])) { n++; finalCode = `PK-${String(n).padStart(6, '0')}`; }
        db.run(
          `INSERT INTO product_keys
            (product_key_code, brand_id, token_id, origin_id, variant, unit_size, unit_measurement,
             pack_count, pack_unit, display_pack_format, display_key, fingerprint, active, taxonomy_version, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
          [finalCode, b ? b.id : null, t.id, o ? o.id : null, variant, usize, umeas, pcount, punit, fmt, displayKey, fp, config.taxonomyVersion, now, now]
        );
        keySeq = n + 1;
      }
    }

    // Taxonomy version row
    db.run(
      `INSERT INTO taxonomy_versions (version, note, created_at) VALUES (?,?,?) ON CONFLICT(version) DO NOTHING`,
      [config.taxonomyVersion, 'Initial seed: 10 groups, 6 tokens, 6 product keys', now]
    );
  });

  db.save();
  const counts = {
    large_groups: db.get('SELECT COUNT(*) c FROM large_groups').c,
    product_tokens: db.get('SELECT COUNT(*) c FROM product_tokens').c,
    product_keys: db.get('SELECT COUNT(*) c FROM product_keys').c,
    brands: db.get('SELECT COUNT(*) c FROM brands').c,
    aliases: db.get('SELECT COUNT(*) c FROM product_token_aliases').c,
  };
  db.close();
  return { file, counts };
}

if (require.main === module) {
  seed().then((r) => {
    console.log('Seed complete:', r.file);
    console.log(JSON.stringify(r.counts, null, 2));
  }).catch((e) => { console.error('Seed failed:', e); process.exit(1); });
}

module.exports = { seed };

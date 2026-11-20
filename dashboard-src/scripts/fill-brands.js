#!/usr/bin/env node
/**
 * fill-brands.js — populate brand for all SKUs from the authoritative v2.xlsx.
 *
 * Mechanism (matches the dashboard's brand pipeline exactly):
 *   brands (upsert by display_name)
 *   product_keys (Keys.create — dedupes by fingerprint)
 *   sku_records.product_key_id  (Skus.update)
 *
 * Origin rule (per user): origin is part of the product key ONLY for the
 * FROZEN group (急凍/冷凍, id=7). For every other group origin_id = NULL.
 *
 * Usage:
 *   node scripts/fill-brands.js --xlsx "C:\Users\chlam\Downloads\v2.xlsx" --dry-run
 *   node scripts/fill-brands.js --xlsx "C:\Users\chlam\Downloads\v2.xlsx"
 *
 * The dashboard server MUST be stopped first (it holds the DB in memory and
 * would overwrite this file on flush).
 */
const path = require('path');
const fs = require('fs');
const { Database } = require('../src/db/db.js');
const repo = require('../src/db/repo.js');
const config = require('../src/config.js');

const FROZEN_GROUP_ID = 7; // 急凍/冷凍 — origin matters here only

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : def;
}
const JSON_PATH = arg('--json', path.join(__dirname, '_brands_v2.json'));
const DRY = process.argv.includes('--dry-run');

// ---- ISO-2 origin code -> {code, name_zh} for frozen-group keys ----
const ORIGIN_ZH = {
  CN:'中國', JP:'日本', HK:'香港', US:'美國', TH:'泰國', TW:'台灣', KR:'韓國',
  AU:'澳大利亞', NZ:'紐西蘭', IT:'意大利', FR:'法國', MY:'馬來西亞', DE:'德國',
  UK:'英國', ES:'西班牙', VN:'越南', NL:'荷蘭', NO:'挪威', CH:'瑞士', BR:'巴西',
  IN:'印度', ID:'印尼', DK:'丹麥', SE:'瑞典', AT:'奧地利', BE:'比利時', ZA:'南非',
  CA:'加拿大', EU:'歐盟', CZ:'捷克共和國', LK:'斯里蘭卡', PH:'菲律賓', PK:'巴基斯坦',
  PT:'葡萄牙', TR:'土耳其',
};

// Parse a packing_spec string like "250ml x 24支" / "5公斤" / "27卷" into
// (unit_size, unit_measurement, pack_count, pack_unit) best-effort.
function parsePack(spec) {
  if (!spec) return {};
  const s = String(spec).trim();
  // "250ml x 24支" / "1升 x 3"
  let m = s.match(/^([\d.]+)\s*(毫升|ml|mL|升|l|L|克|g|公斤|kg|KG|毫升|ML)\s*[xX×]\s*(\d+)\s*(支|包|罐|卷|件|粒|盒|袋|排|個|个|瓶)?/);
  if (m) return { unit_size: parseFloat(m[1]), unit_measurement: m[2], pack_count: parseInt(m[3], 10), pack_unit: m[4] || null };
  // "5公斤" / "250ml" single
  m = s.match(/^([\d.]+)\s*(毫升|ml|mL|升|l|L|克|g|公斤|kg|KG|ML)$/);
  if (m) return { unit_size: parseFloat(m[1]), unit_measurement: m[2] };
  // "27卷" / "24支" count only
  m = s.match(/^(\d+)\s*(支|包|罐|卷|件|粒|盒|袋|排|個|个|瓶)$/);
  if (m) return { pack_count: parseInt(m[1], 10), pack_unit: m[2] };
  return { display_pack_format: s }; // unparseable -> keep raw as display format
}

(async () => {
  if (!fs.existsSync(JSON_PATH)) { console.error('json not found:', JSON_PATH); process.exit(1); }
  const db = await Database.open(config.dbFile);
  const NOW = () => new Date().toISOString();

  // ---- read brand rows (pre-extracted from v2.xlsx) ----
  const rows = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const excel = new Map(); // extSku -> {brand, originCode, pack}
  for (const r of rows) {
    if (!r.sku) continue;
    excel.set(r.sku, { brand: r.brand || null, originCode: r.origin || null, pack: r.pack || null });
  }
  console.log(`brand rows w/ sku: ${excel.size}`);

  // ---- load db skus ----
  const skus = db.all('SELECT id, external_sku_id, product_token_id, product_key_id, large_group_id FROM sku_records WHERE active=1');
  console.log(`db active skus: ${skus.length}`);

  // ---- ensure origin lookup (only used for FROZEN) ----
  const originIdByCode = new Map();
  const getOriginId = (iso2) => {
    if (!iso2) return null;
    const z = ORIGIN_ZH[iso2.toUpperCase()];
    if (!z) return null;
    if (originIdByCode.has(iso2)) return originIdByCode.get(iso2);
    let row = db.get('SELECT id FROM origins WHERE name_zh=?', [z]);
    if (!row) {
      if (DRY) { originIdByCode.set(iso2, -1 * (originIdByCode.size + 1)); return originIdByCode.get(iso2); }
      let code = 'ORIGIN-' + iso2.toUpperCase();
      if (db.get('SELECT id FROM origins WHERE origin_code=?', [code])) code = code + '-' + z;
      db.run('INSERT INTO origins (origin_code, name_zh, active, created_at) VALUES (?,?,1,?) ON CONFLICT(name_zh) DO NOTHING', [code, z, NOW()]);
      row = db.get('SELECT id FROM origins WHERE name_zh=?', [z]);
    }
    originIdByCode.set(iso2, row ? row.id : null);
    return originIdByCode.get(iso2);
  };

  // ---- brand upsert helper ----
  const brandIdByName = new Map();
  for (const b of db.all('SELECT id, display_name FROM brands')) brandIdByName.set(b.display_name, b.id);
  const usedCodes = new Set(db.all('SELECT brand_code FROM brands WHERE brand_code IS NOT NULL').map(r => r.brand_code));
  let brandSeq = db.get('SELECT COUNT(*) c FROM brands').c;
  const getBrandId = (name) => {
    if (brandIdByName.has(name)) return brandIdByName.get(name);
    if (DRY) { const id = -1 * (brandIdByName.size + 1); brandIdByName.set(name, id); return id; }
    // unique, collision-proof brand_code
    let code;
    do { brandSeq++; code = 'BRAND-AUTO-' + String(brandSeq).padStart(5, '0'); } while (usedCodes.has(code));
    usedCodes.add(code);
    db.run('INSERT INTO brands (brand_code, display_name, active, created_at, updated_at) VALUES (?,?,1,?,?) ON CONFLICT(display_name) DO NOTHING', [code, name, NOW(), NOW()]);
    const row = db.get('SELECT id FROM brands WHERE display_name=?', [name]);
    brandIdByName.set(name, row.id);
    return row.id;
  };

  // ---- main loop ----
  let stats = { matched: 0, noExcel: 0, noBrand: 0, noToken: 0, keyCreated: 0, keyReused: 0, skuLinked: 0, already: 0, err: 0 };
  const errors = [];
  if (!DRY) db.run('BEGIN');
  try {
    for (const s of skus) {
      const ex = excel.get(s.external_sku_id);
      if (!ex) { stats.noExcel++; continue; }
      stats.matched++;
      if (!ex.brand) { stats.noBrand++; continue; }
      if (!s.product_token_id) { stats.noToken++; continue; }

      const brandId = getBrandId(ex.brand);
      const isFrozen = s.large_group_id === FROZEN_GROUP_ID;
      const originId = isFrozen ? getOriginId(ex.originCode) : null;
      const pk = parsePack(ex.pack);

      const fields = {
        token_id: s.product_token_id,
        brand_id: brandId,
        origin_id: originId,
        variant: null,
        unit_size: pk.unit_size != null ? pk.unit_size : null,
        unit_measurement: pk.unit_measurement || null,
        pack_count: pk.pack_count != null ? pk.pack_count : null,
        pack_unit: pk.pack_unit || null,
        display_pack_format: pk.display_pack_format || null,
        reason: 'brand fill from v2.xlsx',
      };

      let keyId;
      if (DRY) {
        // approximate reuse detection by attempting create is not possible w/o writes;
        // count as would-create.
        stats.keyCreated++;
        keyId = null;
      } else {
        try {
          const k = repo.Keys.create(db, fields, 'brand-fill');
          keyId = k.id;
          stats.keyCreated++;
        } catch (e) {
          if (String(e.message).includes('DUPLICATE_PRODUCT_KEY')) {
            // find existing by recomputing fingerprint via a fresh create attempt is
            // awkward; instead look it up through the fingerprint the repo uses.
            const fp = computeFp(db, fields);
            const existing = db.get('SELECT id FROM product_keys WHERE fingerprint=?', [fp]);
            keyId = existing ? existing.id : null;
            stats.keyReused++;
          } else { stats.err++; errors.push(s.external_sku_id + ': ' + e.message); continue; }
        }
        if (keyId && s.product_key_id !== keyId) {
          db.run('UPDATE sku_records SET product_key_id=?, updated_at=? WHERE id=?', [keyId, NOW(), s.id]);
          stats.skuLinked++;
        } else if (keyId) { stats.already++; }
      }
    }
    if (!DRY) db.run('COMMIT');
  } catch (e) {
    if (!DRY) db.run('ROLLBACK');
    console.error('FATAL, rolled back:', e.message);
    process.exit(1);
  }

  console.log('\n=== ' + (DRY ? 'DRY RUN' : 'APPLIED') + ' ===');
  console.log(JSON.stringify(stats, null, 2));
  if (errors.length) { console.log('first errors:'); errors.slice(0, 10).forEach(e => console.log('  ' + e)); }
  db.save && db.save();
  process.exit(0);
})();

// Recompute the repo fingerprint for a fields object (mirror of Keys.create internals).
function computeFp(db, fields) {
  const { keyFingerprint } = require('../src/lib/normalize.js');
  const token = db.get('SELECT * FROM product_tokens WHERE id=?', [fields.token_id]);
  const brand = fields.brand_id ? db.get('SELECT * FROM brands WHERE id=?', [fields.brand_id]) : null;
  const origin = fields.origin_id ? db.get('SELECT * FROM origins WHERE id=?', [fields.origin_id]) : null;
  return keyFingerprint({
    brand: brand && brand.display_name, token: token && token.name_zh, origin: origin && origin.name_zh,
    variant: fields.variant, unit_size: fields.unit_size, unit_measurement: fields.unit_measurement,
    pack_count: fields.pack_count, pack_unit: fields.pack_unit,
  });
}

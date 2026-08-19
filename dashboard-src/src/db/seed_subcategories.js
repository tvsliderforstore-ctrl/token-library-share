'use strict';
/**
 * seed_subcategories.js — seed approved Sub Cats and migrate existing SKUs onto them.
 *
 * Idempotent. Run after `node src/db/migrate.js` (which applies 0002_sub_categories.sql).
 *
 *   node src/db/seed_subcategories.js            # seed + migrate, print summary
 *   node src/db/seed_subcategories.js --dry-run   # report only, no writes
 *
 * Assignment rule per SKU (in priority order):
 *   1. product_token -> TOKEN_TO_SUBCAT
 *   2. keyword match on normalized SKU name (KEYWORD_RULES)
 *   3. otherwise -> sub_category_id = NULL and the SKU is queued for review
 *      (review_status='PENDING'); never a generic fallback like 其他/未知.
 */
const path = require('path');
const { Database } = require('./db');
const config = require('../config');
const { SUB_CATS, TOKEN_TO_SUBCAT, KEYWORD_RULES } = require('./taxonomy_subcat');

const now = () => new Date().toISOString();

function norm(s) { return (s || '').replace(/\s+/g, ''); }

function classifySkuName(name) {
  const n = norm(name);
  for (const [code, kws] of KEYWORD_RULES) {
    for (const kw of kws) if (n.includes(kw)) return code;
  }
  return null;
}

async function run(dbFile, { dryRun = false } = {}) {
  const db = await Database.open(dbFile || config.dbFile);
  const summary = { subcats_seeded: 0, tokens_linked: 0, skus_assigned: 0, skus_review: 0, by_subcat: {} };

  db.tx(() => {
    const groupIdByCode = {};
    for (const g of db.all('SELECT id, group_code FROM large_groups')) groupIdByCode[g.group_code] = g.id;

    // ---- seed sub_categories ----
    const subIdByCode = {};
    for (const [gcode, list] of Object.entries(SUB_CATS)) {
      const gid = groupIdByCode[gcode];
      if (!gid) throw new Error('Main Cat missing for group_code ' + gcode);
      list.forEach((sc, i) => {
        const existing = db.get('SELECT id FROM sub_categories WHERE sub_cat_code=?', [sc.code]);
        if (existing) {
          subIdByCode[sc.code] = existing.id;
          if (!dryRun) db.run(
            'UPDATE sub_categories SET name_zh=?, large_group_id=?, display_order=?, updated_at=? WHERE id=?',
            [sc.name, gid, i + 1, now(), existing.id]);
        } else {
          if (!dryRun) {
            const r = db.run(
              'INSERT INTO sub_categories (sub_cat_code,name_zh,large_group_id,display_order,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)',
              [sc.code, sc.name, gid, i + 1, now(), now()]);
            subIdByCode[sc.code] = r.lastId;
          }
          summary.subcats_seeded++;
        }
      });
    }
    // reload map in case we were dry-run (ids come from SELECT)
    for (const row of db.all('SELECT id, sub_cat_code FROM sub_categories')) subIdByCode[row.sub_cat_code] = row.id;

    // ---- link product_tokens to a Sub Cat (informational default) ----
    for (const t of db.all('SELECT id, name_zh FROM product_tokens')) {
      const code = TOKEN_TO_SUBCAT[t.name_zh];
      if (code && subIdByCode[code]) {
        if (!dryRun) db.run('UPDATE product_tokens SET sub_category_id=? WHERE id=?', [subIdByCode[code], t.id]);
        summary.tokens_linked++;
      }
    }

    // ---- migrate SKUs ----
    const skus = db.all(`SELECT s.id, s.raw_sku_name, s.large_group_id, s.review_status,
                                t.name_zh AS token_name
                         FROM sku_records s LEFT JOIN product_tokens t ON t.id = s.product_token_id`);
    for (const s of skus) {
      let code = (s.token_name && TOKEN_TO_SUBCAT[s.token_name]) || classifySkuName(s.raw_sku_name);
      if (code && subIdByCode[code]) {
        const subId = subIdByCode[code];
        const gid = db.get('SELECT large_group_id FROM sub_categories WHERE id=?', [subId]).large_group_id;
        if (!dryRun) db.run('UPDATE sku_records SET sub_category_id=?, large_group_id=?, updated_at=? WHERE id=?',
          [subId, gid, now(), s.id]);
        summary.skus_assigned++;
        summary.by_subcat[code] = (summary.by_subcat[code] || 0) + 1;
      } else {
        // uncertain -> review queue; leave sub_category_id NULL, no generic fallback
        if (!dryRun) db.run("UPDATE sku_records SET review_status='PENDING', updated_at=? WHERE id=?", [now(), s.id]);
        summary.skus_review++;
      }
    }
  });

  db.save();
  db.close();
  return summary;
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  run(config.dbFile, { dryRun }).then((s) => {
    console.log(dryRun ? 'DRY RUN — no writes' : 'Sub Cat seed + SKU migration complete');
    console.log('  sub cats seeded:', s.subcats_seeded);
    console.log('  tokens linked:', s.tokens_linked);
    console.log('  SKUs assigned:', s.skus_assigned);
    console.log('  SKUs -> review:', s.skus_review);
    console.log('  by sub cat:', JSON.stringify(s.by_subcat));
  }).catch((e) => { console.error('FAILED:', e); process.exit(1); });
}

module.exports = { run };

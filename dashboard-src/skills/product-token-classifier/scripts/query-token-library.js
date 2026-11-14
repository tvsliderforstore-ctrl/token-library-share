#!/usr/bin/env node
'use strict';
/**
 * query-token-library.js — read the latest taxonomy from the dashboard (source of truth).
 * Always reads the live library + current taxonomy version; never uses cached/memory data.
 *
 * Usage:
 *   node query-token-library.js                 # full taxonomy summary
 *   node query-token-library.js --groups
 *   node query-token-library.js --tokens [--group BEVERAGES]
 *   node query-token-library.js --keys [--q 無糖]
 *   node query-token-library.js --version
 */
const API = process.env.PTL_API || 'http://127.0.0.1:4310';
async function get(p) { const r = await fetch(API + p); if (!r.ok) throw new Error(`API ${r.status}`); return r.json(); }

(async () => {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(n);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  try {
    if (flag('--version')) return console.log(JSON.stringify(await get('/api/system/taxonomy-version')));
    if (flag('--groups')) return console.log(JSON.stringify(await get('/api/large-groups')));
    if (flag('--tokens')) {
      let q = '/api/tokens'; const g = opt('--group'); if (g) q += `?group_id=${g}`;
      return console.log(JSON.stringify(await get(q)));
    }
    if (flag('--keys')) { let q = '/api/product-keys'; const s = opt('--q'); if (s) q += `?q=${encodeURIComponent(s)}`; return console.log(JSON.stringify(await get(q))); }
    const [version, groups, overview] = await Promise.all([get('/api/system/taxonomy-version'), get('/api/large-groups'), get('/api/overview')]);
    console.log(JSON.stringify({ taxonomy_version: version.version, large_groups: groups.length, tokens: overview.product_tokens, product_keys: overview.product_keys, skus: overview.skus, groups: groups.map((g) => ({ code: g.group_code, name: g.name_zh, tokens: g.token_count })) }, null, 2));
  } catch (e) {
    console.error(JSON.stringify({ error: String(e.message), hint: 'Start dashboard: node src/server.js' }));
    process.exit(1);
  }
})();

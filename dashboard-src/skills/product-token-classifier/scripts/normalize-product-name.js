#!/usr/bin/env node
'use strict';
/**
 * normalize-product-name.js — show the deterministic normalization of a SKU name.
 * Delegates to the dashboard's classification tester so output always matches
 * the live library's normalization pipeline.
 *
 * Usage: node normalize-product-name.js "一口牛柳粒(急凍)#牛肉粒"
 */
const API = process.env.PTL_API || 'http://127.0.0.1:4310';
(async () => {
  const name = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ');
  if (!name) { console.error('Usage: normalize-product-name.js "<name>"'); process.exit(2); }
  const r = await fetch(API + '/api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw_sku_name: name }) });
  if (!r.ok) { console.error(JSON.stringify({ error: 'API ' + r.status })); process.exit(1); }
  const j = await r.json();
  console.log(JSON.stringify({
    raw_sku_name: j.raw_sku_name,
    normalized_sku_name: j.normalized_sku_name,
    base_title: j.base_title,
    extracted_hashtags: j.extracted_hashtags,
    extracted_brackets: j.extracted_brackets,
    extracted_attributes: j.extracted_attributes,
  }, null, 2));
})();

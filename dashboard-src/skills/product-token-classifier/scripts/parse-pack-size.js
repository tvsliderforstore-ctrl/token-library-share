#!/usr/bin/env node
'use strict';
/**
 * parse-pack-size.js — extract structured pack data from a SKU name / spec string.
 * Usage: node parse-pack-size.js "250毫升×24支"
 */
const API = process.env.PTL_API || 'http://127.0.0.1:4310';
(async () => {
  const text = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ');
  if (!text) { console.error('Usage: parse-pack-size.js "<text>"'); process.exit(2); }
  // Reuse the dashboard normalization by classifying (pack lives in normalization);
  // for a pure pack read we hit the tester and surface pack info if present.
  const r = await fetch(API + '/api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw_sku_name: text }) });
  if (!r.ok) { console.error(JSON.stringify({ error: 'API ' + r.status })); process.exit(1); }
  const j = await r.json();
  console.log(JSON.stringify({ input: text, normalized: j.normalized_sku_name, note: 'Pack data is embedded in the normalization pipeline; see product_key_display when matched.', product_key_display: j.product_key_display }, null, 2));
})();

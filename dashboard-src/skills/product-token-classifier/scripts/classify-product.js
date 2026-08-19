#!/usr/bin/env node
'use strict';
/**
 * classify-product.js — classify one or more SKU names against the dashboard
 * taxonomy via the local API. The dashboard is the source of truth; this script
 * never relies on model memory and never mutates taxonomy.
 *
 * Usage:
 *   node classify-product.js "一口牛柳粒(急凍)#牛肉粒"
 *   node classify-product.js --batch names.txt
 *   echo '["a","b"]' | node classify-product.js --stdin
 *   PTL_API=http://127.0.0.1:4310 node classify-product.js "..." --pretty
 */
const API = process.env.PTL_API || 'http://127.0.0.1:4310';

async function post(path, body) {
  const res = await fetch(API + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

function shape(r) {
  return {
    raw_sku_name: r.raw_sku_name,
    normalized_sku_name: r.normalized_sku_name,
    base_title: r.base_title,
    large_group_code: r.large_group_code,
    large_group_name: r.large_group_name,
    product_token_code: r.product_token_code,
    product_token_name: r.product_token_name,
    product_key_code: r.product_key_code,
    product_key_display: r.product_key_display,
    matched_alias: r.matched_alias,
    extracted_attributes: r.extracted_attributes,
    match_method: r.match_method,
    confidence: r.confidence,
    requires_review: r.requires_review,
    alternative_candidates: r.alternative_candidates,
    explanation: r.explanation,
  };
}

(async () => {
  const args = process.argv.slice(2);
  const pretty = args.includes('--pretty');
  const stdinMode = args.includes('--stdin');
  const bi = args.indexOf('--batch');
  const names = args.filter((a) => !a.startsWith('--'));

  let items = [];
  if (stdinMode) {
    const buf = await new Promise((r) => { let d = ''; process.stdin.on('data', (c) => d += c).on('end', () => r(d)); });
    const t = buf.trim();
    items = t.startsWith('[') ? JSON.parse(t) : t.split('\n').map((x) => x.trim()).filter(Boolean);
  } else if (bi >= 0 && args[bi + 1]) {
    const fs = require('fs');
    items = fs.readFileSync(args[bi + 1], 'utf8').split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'));
  } else if (names.length) {
    items = [names.join(' ')];
  } else {
    console.error('Usage: classify-product.js "<name>" | --batch file.txt | --stdin');
    process.exit(2);
  }

  try {
    const out = items.length === 1
      ? shape(await post('/api/classify', { raw_sku_name: items[0] }))
      : (await post('/api/classify', { items })).results.map(shape);
    console.log(JSON.stringify(out, null, pretty ? 2 : 0));
  } catch (e) {
    console.error(JSON.stringify({ error: String(e.message), hint: 'Is the dashboard running? Start with: node src/server.js' }));
    process.exit(1);
  }
})();

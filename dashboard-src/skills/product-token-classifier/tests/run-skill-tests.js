#!/usr/bin/env node
'use strict';
/**
 * run-skill-tests.js — validate the product-token-classifier skill scripts against
 * golden-cases.json + pack-size-cases.json via the live dashboard API.
 * Usage: node run-skill-tests.js   (dashboard must be running; set PTL_API to override)
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const API = process.env.PTL_API || 'http://127.0.0.1:4310';
const SCRIPTS = path.join(__dirname, '..', 'scripts');
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-cases.json'), 'utf8'));
const packs = JSON.parse(fs.readFileSync(path.join(__dirname, 'pack-size-cases.json'), 'utf8'));

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { pass++; } else { fail++; fails.push(`${name}: ${detail}`); }
}
function run(script, arg) {
  const out = execFileSync('node', [path.join(SCRIPTS, script), arg], { env: { ...process.env, PTL_API: API }, encoding: 'utf8' });
  return JSON.parse(out);
}

// Golden classification cases via the classify-product.js script.
for (const g of golden) {
  let r;
  try { r = run('classify-product.js', g.input); } catch (e) { check(g.input, false, 'script error ' + e.message); continue; }
  const e = g.expected;
  if (e.large_group_name !== undefined) check(g.input + ' group', r.large_group_name === e.large_group_name, `group=${r.large_group_name}`);
  if (e.product_token_name !== undefined) check(g.input + ' token', r.product_token_name === e.product_token_name, `token=${r.product_token_name}`);
  if (e.matched_alias !== undefined) check(g.input + ' alias', r.matched_alias === e.matched_alias, `alias=${r.matched_alias}`);
  if (e.product_key_display !== undefined) check(g.input + ' key', r.product_key_display === e.product_key_display, `key=${r.product_key_display}`);
  if (e.match_method !== undefined) check(g.input + ' method', r.match_method === e.match_method, `method=${r.match_method}`);
  if (e.requires_review !== undefined) check(g.input + ' review', r.requires_review === e.requires_review, `review=${r.requires_review} conf=${r.confidence}`);
  if (e.extracted_attributes !== undefined) check(g.input + ' attrs', JSON.stringify(r.extracted_attributes) === JSON.stringify(e.extracted_attributes), `attrs=${JSON.stringify(r.extracted_attributes)}`);
}

// Pack-size cases via the app's normalization (classify surfaces normalized text; the
// engine's parsePackSize is validated directly in the app test-suite). Here we sanity-check
// that normalization + classification stay consistent for pack-bearing inputs.
const { parsePackSize } = require('./packsize.js'); // self-contained within the skill
for (const p of packs) {
  const got = parsePackSize(p.input);
  if (p.unit_size !== undefined) check('pack ' + p.input + ' size', got.unit_size === p.unit_size, `size=${got.unit_size}`);
  if (p.unit_measurement !== undefined) check('pack ' + p.input + ' unit', got.unit_measurement === p.unit_measurement, `unit=${got.unit_measurement}`);
  if (p.pack_count !== undefined) check('pack ' + p.input + ' count', got.pack_count === p.pack_count, `count=${got.pack_count}`);
  if (p.pack_unit !== undefined) check('pack ' + p.input + ' punit', got.pack_unit === p.pack_unit, `punit=${got.pack_unit}`);
}

console.log(`\nSkill tests: ${pass} pass, ${fail} fail`);
if (fails.length) { console.log('FAILURES:\n' + fails.join('\n')); process.exit(1); }

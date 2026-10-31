#!/usr/bin/env node
'use strict';
/**
 * submit-review.js — submit an ambiguous record or a human decision to the dashboard
 * review queue. Never auto-converts an unreviewed suggestion into an alias.
 *
 * Usage:
 *   node submit-review.js --sku 12 --action CONFIRM --token 5 [--key 3] [--note "..."]
 *   node submit-review.js --sku 12 --action MARK_UNMATCHED --note "not a real product"
 */
const API = process.env.PTL_API || 'http://127.0.0.1:4310';
(async () => {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  const sku = opt('--sku');
  if (!sku) { console.error('Usage: submit-review.js --sku <id> --action <ACT> [--token id] [--key id] [--note str]'); process.exit(2); }
  const body = {
    sku_id: +sku,
    action: opt('--action') || 'CONFIRM',
    product_token_id: opt('--token') ? +opt('--token') : undefined,
    product_key_id: opt('--key') ? +opt('--key') : undefined,
    reason: opt('--note') || 'submitted via product-token-classifier skill',
    reviewer: opt('--reviewer') || 'hermes-skill',
  };
  const r = await fetch(API + '/api/review/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) { console.error(JSON.stringify({ error: j.error })); process.exit(1); }
  console.log(JSON.stringify({ ok: true, submitted: body }));
})();

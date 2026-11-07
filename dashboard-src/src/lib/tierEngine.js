'use strict';
/**
 * tierEngine.js — compute the proposed Current Status (tier per facing id) and the
 * diff vs the persisted baseline (Action to be Processed). Read-only on the live
 * tables; it never mutates sku_records / observations. The baseline (tier_status)
 * is only written by applyTiers (the Done button).
 *
 * Rules (locked with user 2026-08-21):
 *  - Scope: only facing ids in each sub-cat's top-100 GMV (sku_gmv) are tiered,
 *    plus the 101st-GMV supplement pulled in as Tier 3.
 *  - Per facing id, its candidate SKU = cheapest SKU that is online + visible + in-stock.
 *  - Tier 1: that candidate exists AND is the group's absolute cheapest.
 *  - Tier 2: candidate exists but is NOT the absolute cheapest (cheapest is offline/
 *            invisible/OOS) — i.e. a valid supplement already inside the top 100.
 *  - Tier 3: a facing id in the top 100 whose cheapest is unavailable AND has no
 *            tier-2 supplement → pull the sub-cat's next (101st+) GMV product that is
 *            online+visible+in-stock as the Tier-3 supplement.
 *  - "available" = stock_status IN_STOCK or LOW_STOCK, AND current_is_invisible=0 (visible),
 *    AND the SKU is online (visible ⇒ online; is_invisible is the visibility source).
 */

const AVAIL_STOCK = "('IN_STOCK','LOW_STOCK')";

// Load every active SKU with the fields the engine needs, keyed by facing id.
function loadRows(db) {
  return db.all(`
    SELECT s.id, s.external_sku_id AS sku_id, s.product_key_id AS key_id, s.sub_category_id,
           lp.effective_price_minor AS price_minor, ls.stock_status,
           COALESCE(soc.current_is_invisible, 0) AS is_invisible,
           COALESCE(g.gmv, 0) AS gmv
    FROM sku_records s
    LEFT JOIN (
      SELECT sku_id, effective_price_minor FROM (
        SELECT sku_id, effective_price_minor, ROW_NUMBER() OVER (PARTITION BY sku_id ORDER BY observed_at DESC, id DESC) rn
        FROM sku_price_observations
      ) WHERE rn=1
    ) lp ON lp.sku_id = s.id
    LEFT JOIN (
      SELECT sku_id, stock_status FROM (
        SELECT sku_id, stock_status, ROW_NUMBER() OVER (PARTITION BY sku_id ORDER BY observed_at DESC, id DESC) rn
        FROM sku_stock_observations
      ) WHERE rn=1
    ) ls ON ls.sku_id = s.id
    LEFT JOIN sku_operational_current soc ON soc.sku_id = s.external_sku_id
    LEFT JOIN sku_gmv g ON g.external_sku_id = s.external_sku_id
    WHERE s.active=1 AND s.product_key_id IS NOT NULL AND s.sub_category_id IS NOT NULL
  `, []);
}

const isAvail = (r) => (r.stock_status === 'IN_STOCK' || r.stock_status === 'LOW_STOCK') && r.is_invisible === 0;
const price = (r) => (r.price_minor == null ? Infinity : r.price_minor);

// Compute the proposed tier assignment: { key_id -> {tier, sku_id, sub_category_id, gmv} }
function computeProposed(db) {
  const rows = loadRows(db);
  // group by sub-cat, then by facing id
  const bySub = {};
  for (const r of rows) (bySub[r.sub_category_id] = bySub[r.sub_category_id] || []).push(r);

  const proposed = {};
  for (const subId of Object.keys(bySub)) {
    const subRows = bySub[subId];
    // group SKUs by facing id
    const byKey = {};
    for (const r of subRows) (byKey[r.key_id] = byKey[r.key_id] || []).push(r);
    // facing-id GMV = max SKU gmv within the key
    const keyGmv = {};
    for (const kid of Object.keys(byKey)) keyGmv[kid] = Math.max(...byKey[kid].map((x) => x.gmv || 0));
    // top-100 facing ids by GMV
    const ranked = Object.keys(byKey).sort((a, b) => (keyGmv[b] - keyGmv[a]));
    const topKeys = ranked.slice(0, 100);
    const topSet = new Set(topKeys.map(String));

    const gapKeys = []; // top-100 keys needing a tier-3 supplement
    for (const kid of topKeys) {
      const members = byKey[kid];
      const cheapest = members.slice().sort((a, b) => price(a) - price(b))[0]; // absolute cheapest (any status)
      const candidate = members.filter(isAvail).sort((a, b) => price(a) - price(b))[0]; // cheapest available
      if (!candidate) { gapKeys.push(kid); continue; } // nobody available in this key -> gap
      const candIsCheapest = cheapest && candidate.sku_id === cheapest.sku_id;
      if (candIsCheapest) {
        proposed[kid] = { tier: 1, sku_id: candidate.sku_id, sub_category_id: Number(subId), gmv: keyGmv[kid] };
      } else {
        // cheapest is unavailable; this available candidate is the supplement (tier 2)
        proposed[kid] = { tier: 2, sku_id: candidate.sku_id, sub_category_id: Number(subId), gmv: keyGmv[kid] };
      }
    }

    // Tier 3: for each gap key, pull the next (101st+) GMV available product in the sub-cat.
    if (gapKeys.length) {
      // candidate supplements = facing ids OUTSIDE the top 100 (or unassigned), with an available SKU,
      // ordered by GMV desc. We take the next-best available ones not already tiered.
      const candidatePool = ranked.slice(100) // 101st onward
        .filter((kid) => !proposed[kid])
        .map((kid) => ({ kid, gmv: keyGmv[kid], best: byKey[kid].filter(isAvail).sort((a, b) => price(a) - price(b))[0] }))
        .filter((x) => x.best);
      let ci = 0;
      for (const gapKid of gapKeys) {
        if (ci >= candidatePool.length) break; // no supplement available in this sub-cat
        const supp = candidatePool[ci++];
        proposed[supp.kid] = { tier: 3, sku_id: supp.best.sku_id, sub_category_id: Number(subId), gmv: supp.gmv, fills_gap_key: Number(gapKid) };
      }
    }
  }
  return proposed;
}

// Diff proposed vs the persisted baseline (tier_status).
// Returns { add:{1:[],2:[],3:[]}, remove:{...}, outcome:{...}, baselineEmpty, proposed, baseline }
function diffTiers(db, proposed) {
  const baseline = {};
  for (const r of db.all('SELECT product_key_id AS kid, tier, representative_sku_id AS sku_id, sub_category_id, gmv FROM tier_status')) baseline[r.kid] = r;
  const baselineEmpty = db.get('SELECT COUNT(*) c FROM tier_status').c === 0;

  const empty = () => ({ 1: [], 2: [], 3: [] });
  const add = empty(), remove = empty(), change = empty();

  const allKeys = new Set([...Object.keys(proposed), ...Object.keys(baseline)]);
  for (const kid of allKeys) {
    const p = proposed[kid]; const b = baseline[kid];
    if (p && !b) add[p.tier].push(rowOut(p, kid));
    else if (!p && b) remove[b.tier].push(rowOut(b, kid, true));
    else if (p && b && p.tier !== b.tier) {
      remove[b.tier].push(rowOut(b, kid, true));
      add[p.tier].push(rowOut(p, kid));
    }
  }
  // outcome = net count per tier (baseline count -> proposed count)
  const countBy = (map) => { const o = { 1: 0, 2: 0, 3: 0 }; for (const k of Object.keys(map)) o[map[k].tier]++; return o; };
  const outcome = { from: countBy(baseline), to: countBy(proposed) };
  return { add, remove, outcome, baselineEmpty, proposedCount: countBy(proposed), baselineCount: countBy(baseline) };
}

function rowOut(r, kid, isBaseline) {
  return {
    product_key_id: Number(kid), tier: r.tier, sku_id: r.representative_sku_id || r.sku_id,
    sub_category_id: r.sub_category_id, gmv: r.gmv,
  };
}

// Apply the proposed set as the new baseline (the Done button). Replaces tier_status.
function applyTiers(db, proposed) {
  const now = new Date().toISOString();
  db.run('DELETE FROM tier_status');
  const ins = db.run.bind(db);
  for (const kid of Object.keys(proposed)) {
    const p = proposed[kid];
    db.run('INSERT INTO tier_status (product_key_id, tier, representative_sku_id, sub_category_id, gmv, applied_at) VALUES (?,?,?,?,?,?)',
      [Number(kid), p.tier, p.sku_id, p.sub_category_id, p.gmv || 0, now]);
  }
  return { applied: Object.keys(proposed).length, applied_at: now };
}

module.exports = { computeProposed, diffTiers, applyTiers };

'use strict';
/**
 * classify.js — deterministic classification engine (spec §8, §9, §10).
 *
 * Matching order (deterministic before fuzzy):
 *   1. Confirmed external SKU-ID mapping
 *   2. Confirmed barcode mapping
 *   3. Confirmed exact normalized SKU-name mapping
 *   4. Confirmed exact Product Key alias
 *   5. Exact approved Product Token alias
 *   6. Longest approved Product Token alias in the base title
 *   7. Approved brand + Product Key component matching
 *   8. Approved regular-expression rule
 *   9. Group-constrained candidate scoring
 *  10. Fuzzy candidate requiring human review
 *  11. Unmatched
 *
 * Token-only results are allowed when Product Key evidence is incomplete (spec §9).
 * Ambiguous results are routed to review, never silently guessed (spec §10).
 */

const { analyze, matchKey, normalize } = require('../lib/normalize');
const config = require('../config');

const METHOD = {
  SKU_ID: 'CONFIRMED_SKU_ID',
  BARCODE: 'CONFIRMED_BARCODE',
  EXACT_SKU_NAME: 'CONFIRMED_EXACT_SKU_NAME',
  PKEY_ALIAS: 'CONFIRMED_PRODUCT_KEY_ALIAS',
  TOKEN_ALIAS_EXACT: 'EXACT_APPROVED_ALIAS',
  TOKEN_ALIAS_LONGEST: 'LONGEST_APPROVED_ALIAS',
  COMPONENT: 'BRAND_KEY_COMPONENT',
  REGEX: 'APPROVED_REGEX',
  GROUP_SCORE: 'GROUP_CONSTRAINED_SCORING',
  FUZZY: 'FUZZY_CANDIDATE',
  UNMATCHED: 'UNMATCHED',
};

/** Load active taxonomy into memory for matching. */
function loadTaxonomy(db) {
  const groups = db.all('SELECT * FROM large_groups WHERE active=1');
  const tokens = db.all(`
    SELECT t.*, g.group_code, g.name_zh AS group_name
    FROM product_tokens t JOIN large_groups g ON g.id=t.large_group_id
    WHERE t.active=1`);
  const aliases = db.all(`
    SELECT a.*, t.token_code, t.name_zh AS token_name, t.large_group_id, t.id AS token_id
    FROM product_token_aliases a JOIN product_tokens t ON t.id=a.token_id
    WHERE a.status='APPROVED' AND t.active=1`);
  const negatives = db.all(`
    SELECT n.*, t.id AS token_id FROM product_token_negative_aliases n
    JOIN product_tokens t ON t.id=n.token_id WHERE t.active=1`);
  const patterns = db.all(`
    SELECT p.*, t.id AS token_id, t.name_zh AS token_name, t.large_group_id
    FROM product_token_patterns p JOIN product_tokens t ON t.id=p.token_id
    WHERE p.status='APPROVED' AND t.active=1`);
  const brands = db.all('SELECT * FROM brands WHERE active=1');
  const brandAliases = db.all('SELECT * FROM brand_aliases WHERE active=1');
  const origins = db.all('SELECT * FROM origins WHERE active=1');
  const keys = db.all(`
    SELECT k.*, b.display_name AS brand_name, o.name_zh AS origin_name, t.name_zh AS token_name, t.large_group_id
    FROM product_keys k
    LEFT JOIN brands b ON b.id=k.brand_id
    LEFT JOIN origins o ON o.id=k.origin_id
    JOIN product_tokens t ON t.id=k.token_id
    WHERE k.active=1`);
  const keyAliases = db.all(`SELECT * FROM product_key_aliases WHERE status='APPROVED'`);
  return { groups, tokens, aliases, negatives, patterns, brands, brandAliases, origins, keys, keyAliases };
}

/** Step 6 helper: longest approved alias found in base title (specific beats generic). */
function longestAliasMatch(baseTitleKey, aliases) {
  let best = null;
  for (const a of aliases) {
    const norm = a.normalized;
    if (!norm) continue;
    if (baseTitleKey.includes(norm)) {
      if (!best || norm.length > best.normalized.length) best = a;
    }
  }
  return best;
}

/**
 * Try to resolve a Product Key from structured components found in text.
 * Requires token already known; matches brand + variant + pack against keys of that token.
 * Returns {key, score, matchedComponents} or null.
 */
function resolveProductKey(text, token, tax) {
  const textKey = matchKey(text);
  const candKeys = tax.keys.filter((k) => k.token_id === token.id);
  if (!candKeys.length) return null;

  // Detect brand present in text.
  let brand = null;
  for (const b of tax.brands) {
    const names = [b.display_name, ...tax.brandAliases.filter((x) => x.brand_id === b.id).map((x) => x.alias)];
    if (names.some((n) => n && textKey.includes(matchKey(n)))) { brand = b; break; }
  }

  const pack = analyze(text).pack;

  let best = null;
  for (const k of candKeys) {
    let score = 0;
    const matched = [];
    // Brand match
    if (brand && k.brand_id === brand.id) { score += 3; matched.push('brand'); }
    else if (brand && k.brand_id !== brand.id) { continue; } // conflicting brand -> skip
    // Variant match
    if (k.variant && textKey.includes(matchKey(k.variant))) { score += 2; matched.push('variant'); }
    else if (k.variant && !textKey.includes(matchKey(k.variant))) {
      // variant required by key but absent in text: weak; only allow if nothing better
    }
    // Pack match
    if (k.unit_size != null && pack.unit_size != null && Number(k.unit_size) === Number(pack.unit_size)
        && String(k.unit_measurement).toLowerCase() === String(pack.unit_measurement).toLowerCase()) {
      score += 2; matched.push('unit_size');
    }
    if (k.pack_count != null && pack.pack_count != null && Number(k.pack_count) === Number(pack.pack_count)) {
      score += 2; matched.push('pack_count');
    }
    if (score > 0 && (!best || score > best.score)) best = { key: k, score, matchedComponents: matched };
  }
  // Require at least brand + (variant or a pack component) to claim a key with confidence.
  if (best && best.matchedComponents.includes('brand') && best.matchedComponents.length >= 2) return best;
  return null;
}

/**
 * Classify a single input (raw SKU name string, optionally with external ids).
 * ctx: {external_sku_id, barcode}
 * Returns a structured classification result (never throws on ambiguity).
 */
function classify(db, rawName, ctx = {}) {
  const tax = loadTaxonomy(db);
  const a = analyze(rawName);
  const baseKey = matchKey(a.base_title);
  const fullKey = matchKey(a.normalized_sku_name);
  const candidates = [];
  const explanation = [];

  const result = {
    raw_sku_name: a.raw_sku_name,
    normalized_sku_name: a.normalized_sku_name,
    base_title: a.base_title,
    extracted_hashtags: a.hashtags,
    extracted_brackets: a.brackets,
    extracted_attributes: a.extracted_attributes,
    large_group_code: null,
    large_group_name: null,
    product_token_code: null,
    product_token_name: null,
    product_key_code: null,
    product_key_display: null,
    matched_alias: null,
    match_method: METHOD.UNMATCHED,
    confidence: 0,
    requires_review: true,
    alternative_candidates: candidates,
    explanation: '',
  };

  function applyToken(tokenRow, method, confidence, matchedAlias, why) {
    const g = tax.groups.find((x) => x.id === tokenRow.large_group_id);
    result.product_token_id = tokenRow.id;
    result.product_token_code = tokenRow.token_code;
    result.product_token_name = tokenRow.name_zh;
    result.large_group_id = tokenRow.large_group_id;
    result.large_group_code = g ? g.group_code : null;
    result.large_group_name = g ? g.name_zh : null;
    result.match_method = method;
    result.confidence = confidence;
    result.matched_alias = matchedAlias || null;
    explanation.push(why);
  }

  function finalize() {
    result.alternative_candidates = candidates;
    result.explanation = explanation.join(' ');
    const auto = config.confidence.autoAccept;
    const floor = config.confidence.reviewFloor;
    if (result.confidence >= auto) result.requires_review = false;
    else if (result.confidence >= floor) result.requires_review = true;
    else { result.requires_review = true; }
    // Unmatched guard
    if (result.match_method === METHOD.UNMATCHED) {
      result.confidence = 0; result.requires_review = true;
    }
    // Persist classification result + candidates.
    const now = new Date().toISOString();
    const ins = db.run(
      `INSERT INTO classification_results
        (sku_id, raw_input, normalized_input, base_title, large_group_id, product_token_id, product_key_id,
         matched_alias, match_method, confidence, extracted_attributes, explanation, requires_review, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PROPOSED',?)`,
      [ctx.sku_id || null, a.raw_sku_name, a.normalized_sku_name, a.base_title,
       result.large_group_id || null, result.product_token_id || null, result.product_key_id || null,
       result.matched_alias, result.match_method, result.confidence,
       JSON.stringify(a.extracted_attributes), result.explanation, result.requires_review ? 1 : 0, now]
    );
    result.result_id = ins.lastId;
    for (const c of candidates) {
      db.run(
        `INSERT INTO classification_candidates (result_id, product_token_id, product_key_id, score, reason) VALUES (?,?,?,?,?)`,
        [ins.lastId, c.token_id || null, c.key_id || null, c.score, c.reason]
      );
    }
    return result;
  }

  // ---- Step 1: external SKU-ID mapping ----
  if (ctx.external_sku_id) {
    const sku = db.get(
      `SELECT s.*, t.token_code, t.name_zh token_name, t.large_group_id, k.product_key_code, k.display_key
       FROM sku_records s
       LEFT JOIN product_tokens t ON t.id=s.product_token_id
       LEFT JOIN product_keys k ON k.id=s.product_key_id
       WHERE s.external_sku_id=? AND s.mapping_status IN ('MAPPED','TOKEN_ONLY') AND s.review_status='CONFIRMED'`,
      [ctx.external_sku_id]);
    if (sku && sku.product_token_id) {
      applyToken({ id: sku.product_token_id, token_code: sku.token_code, name_zh: sku.token_name, large_group_id: sku.large_group_id },
        METHOD.SKU_ID, 1.0, null, `外部 SKU ID「${ctx.external_sku_id}」已確認映射。`);
      if (sku.product_key_id) {
        result.product_key_id = sku.product_key_id;
        result.product_key_code = sku.product_key_code;
        result.product_key_display = sku.display_key;
      }
      return finalize();
    }
  }

  // ---- Step 2: barcode mapping ----
  if (ctx.barcode) {
    const sku = db.get(
      `SELECT s.*, t.token_code, t.name_zh token_name, t.large_group_id, k.product_key_code, k.display_key
       FROM sku_records s
       LEFT JOIN product_tokens t ON t.id=s.product_token_id
       LEFT JOIN product_keys k ON k.id=s.product_key_id
       WHERE s.barcode=? AND s.mapping_status IN ('MAPPED','TOKEN_ONLY') AND s.review_status='CONFIRMED'`,
      [ctx.barcode]);
    if (sku && sku.product_token_id) {
      applyToken({ id: sku.product_token_id, token_code: sku.token_code, name_zh: sku.token_name, large_group_id: sku.large_group_id },
        METHOD.BARCODE, 1.0, null, `條碼「${ctx.barcode}」已確認映射。`);
      if (sku.product_key_id) {
        result.product_key_id = sku.product_key_id;
        result.product_key_code = sku.product_key_code;
        result.product_key_display = sku.display_key;
      }
      return finalize();
    }
  }

  // ---- Step 3: exact normalized SKU-name mapping (confirmed) ----
  {
    const sku = db.get(
      `SELECT s.*, t.token_code, t.name_zh token_name, t.large_group_id, k.product_key_code, k.display_key
       FROM sku_records s
       LEFT JOIN product_tokens t ON t.id=s.product_token_id
       LEFT JOIN product_keys k ON k.id=s.product_key_id
       WHERE s.normalized_sku_name=? AND s.mapping_status IN ('MAPPED','TOKEN_ONLY') AND s.review_status='CONFIRMED'`,
      [a.normalized_sku_name]);
    if (sku && sku.product_token_id) {
      applyToken({ id: sku.product_token_id, token_code: sku.token_code, name_zh: sku.token_name, large_group_id: sku.large_group_id },
        METHOD.EXACT_SKU_NAME, 1.0, null, `完全相同的已確認 SKU 名稱。`);
      if (sku.product_key_id) {
        result.product_key_id = sku.product_key_id;
        result.product_key_code = sku.product_key_code;
        result.product_key_display = sku.display_key;
      }
      return finalize();
    }
  }

  // ---- Step 4: exact Product Key alias ----
  {
    const hit = tax.keyAliases.find((ka) => matchKey(ka.normalized) === fullKey || matchKey(ka.alias) === fullKey);
    if (hit) {
      const k = tax.keys.find((x) => x.id === hit.product_key_id);
      if (k) {
        const tokenRow = tax.tokens.find((t) => t.id === k.token_id);
        applyToken(tokenRow, METHOD.PKEY_ALIAS, 1.0, hit.alias, `命中已確認 Product Key 別名「${hit.alias}」。`);
        result.product_key_id = k.id;
        result.product_key_code = k.product_key_code;
        result.product_key_display = k.display_key;
        return finalize();
      }
    }
  }

  // ---- Step 5: exact approved token alias (whole base title equals an alias) ----
  {
    const hit = tax.aliases.find((al) => al.normalized === baseKey);
    if (hit) {
      const tokenRow = tax.tokens.find((t) => t.id === hit.token_id);
      applyToken(tokenRow, METHOD.TOKEN_ALIAS_EXACT, 1.0, hit.alias, `完全命中已核准別名「${hit.alias}」。`);
      // attempt product key resolution
      const pk = resolveProductKey(a.normalized_sku_name, tokenRow, tax);
      if (pk) {
        result.product_key_id = pk.key.id;
        result.product_key_code = pk.key.product_key_code;
        result.product_key_display = pk.key.display_key;
        explanation.push(`由品牌+規格組件識別 Product Key（${pk.matchedComponents.join('/')}）。`);
      } else {
        explanation.push('品牌或規格不足以確定 Product Key，保留 token-only 結果。');
      }
      return finalize();
    }
  }

  // ---- Step 6: longest approved alias inside base title ----
  {
    // negative alias veto first
    const negHit = tax.negatives.find((n) => baseKey.includes(n.normalized));
    const best = longestAliasMatch(baseKey, tax.aliases);
    if (best && !(negHit && negHit.token_id === best.token_id && negHit.normalized.length >= best.normalized.length)) {
      const tokenRow = tax.tokens.find((t) => t.id === best.token_id);
      // Longer, more specific alias => higher confidence. Base 0.90 with a long
      // plateau (+0.03 per char past 3), scaled by coverage of the base title.
      // Substring matches are capped just below the auto-accept band so a short
      // generic alias on a long title can never auto-approve (spec §8: specific
      // beats generic; near-misses route to review).
      const aliasLen = best.normalized.length;
      const coverage = aliasLen / Math.max(baseKey.length, 1);
      const base = 0.90 + Math.min(0.05, Math.max(0, aliasLen - 3) * 0.03);
      let conf = Math.min(config.confidence.autoAccept - 0.001, base * (0.5 + coverage / 2));
      applyToken(tokenRow, METHOD.TOKEN_ALIAS_LONGEST, conf, best.alias,
        `基本標題內命中最長已核准別名「${best.alias}」（優先於一般詞）。`);
      // record other matching aliases as candidates
      for (const al of tax.aliases) {
        if (al.id !== best.id && baseKey.includes(al.normalized)) {
          candidates.push({ token_id: al.token_id, token_name: al.token_name, score: al.normalized.length, reason: `較短別名「${al.alias}」亦命中，但較不具體` });
        }
      }
      const pk = resolveProductKey(a.normalized_sku_name, tokenRow, tax);
      if (pk) {
        result.product_key_id = pk.key.id;
        result.product_key_code = pk.key.product_key_code;
        result.product_key_display = pk.key.display_key;
        // A strong structured Product Key match (brand + variant + pack) is
        // decisive: lift confidence into the auto-accept band.
        result.confidence = Math.min(1.0, 0.95 + pk.matchedComponents.length * 0.01);
        explanation.push(`由品牌+規格組件識別 Product Key（${pk.matchedComponents.join('/')}）。`);
      } else {
        // token-only: coverage-scaled, capped below auto-accept so generic short
        // aliases on long titles route to review.
        result.confidence = conf;
        explanation.push('品牌或規格不足以確定 Product Key，保留 token-only 結果。');
      }
      return finalize();
    }
  }

  // ---- Step 7: brand + Product Key component matching (no alias hit) ----
  {
    // try each token: if its canonical name appears in text, attempt key resolution
    for (const tokenRow of tax.tokens) {
      if (baseKey.includes(matchKey(tokenRow.name_zh))) {
        const pk = resolveProductKey(a.normalized_sku_name, tokenRow, tax);
        if (pk) {
          applyToken(tokenRow, METHOD.COMPONENT, 0.9, tokenRow.name_zh, `以品牌 + Product Key 組件匹配。`);
          result.product_key_id = pk.key.id;
          result.product_key_code = pk.key.product_key_code;
          result.product_key_display = pk.key.display_key;
          return finalize();
        }
      }
    }
  }

  // ---- Step 8: approved regex rules ----
  {
    for (const p of tax.patterns.sort((x, y) => y.priority - x.priority)) {
      let re;
      try { re = new RegExp(p.pattern, p.flags || 'i'); } catch (_) { continue; }
      if (re.test(a.normalized_sku_name)) {
        const tokenRow = tax.tokens.find((t) => t.id === p.token_id);
        applyToken(tokenRow, METHOD.REGEX, 0.85, null, `命中已核准規則 /${p.pattern}/。`);
        const pk = resolveProductKey(a.normalized_sku_name, tokenRow, tax);
        if (pk) {
          result.product_key_id = pk.key.id;
          result.product_key_code = pk.key.product_key_code;
          result.product_key_display = pk.key.display_key;
        }
        return finalize();
      }
    }
  }

  // ---- Step 9: group-constrained candidate scoring (token name substring) ----
  {
    for (const tokenRow of tax.tokens) {
      const key = matchKey(tokenRow.name_zh);
      if (key && baseKey.includes(key)) {
        candidates.push({ token_id: tokenRow.id, token_name: tokenRow.name_zh, score: key.length, reason: `含「${tokenRow.name_zh}」字樣` });
      }
    }
    if (candidates.length === 1) {
      const tokenRow = tax.tokens.find((t) => t.id === candidates[0].token_id);
      applyToken(tokenRow, METHOD.GROUP_SCORE, 0.8, tokenRow.name_zh, `群組約束評分選出唯一候選。`);
      return finalize();
    }
    if (candidates.length > 1) {
      // ambiguous between multiple tokens -> review
      const top = candidates.slice().sort((x, y) => y.score - x.score)[0];
      const tokenRow = tax.tokens.find((t) => t.id === top.token_id);
      applyToken(tokenRow, METHOD.GROUP_SCORE, 0.76, tokenRow.name_zh, `多個候選，需人工覆核。`);
      result.requires_review = true;
      return finalize();
    }
  }

  // ---- Step 10: fuzzy (very light: shared substring ratio over aliases) ----
  {
    let bestFuzzy = null;
    for (const al of tax.aliases) {
      const norm = al.normalized;
      if (!norm || norm.length < 2) continue;
      // longest common substring length / alias length
      const lcs = longestCommonSubstring(baseKey, norm);
      const ratio = lcs / norm.length;
      if (ratio >= 0.6 && (!bestFuzzy || ratio > bestFuzzy.ratio)) bestFuzzy = { al, ratio };
    }
    if (bestFuzzy) {
      const tokenRow = tax.tokens.find((t) => t.id === bestFuzzy.al.token_id);
      applyToken(tokenRow, METHOD.FUZZY, 0.6, bestFuzzy.al.alias,
        `模糊匹配「${bestFuzzy.al.alias}」（相似度 ${bestFuzzy.ratio.toFixed(2)}），必須人工覆核，不得自動通過。`);
      result.requires_review = true;
      return finalize();
    }
  }

  // ---- Step 11: unmatched ----
  explanation.push('無法識別，已標記為未匹配並進入覆核。');
  return finalize();
}

function longestCommonSubstring(s1, s2) {
  if (!s1 || !s2) return 0;
  const m = s1.length, n = s2.length;
  let max = 0;
  const dp = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    let prev = 0;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      if (s1[i - 1] === s2[j - 1]) { dp[j] = prev + 1; if (dp[j] > max) max = dp[j]; }
      else dp[j] = 0;
      prev = tmp;
    }
  }
  return max;
}

/** Batch classify. */
function classifyBatch(db, inputs) {
  return inputs.map((item) => {
    const raw = typeof item === 'string' ? item : item.raw_sku_name;
    const ctx = typeof item === 'string' ? {} : item;
    return classify(db, raw, ctx);
  });
}

module.exports = { classify, classifyBatch, loadTaxonomy, METHOD };

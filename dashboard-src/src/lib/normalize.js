'use strict';
/**
 * normalize.js — deterministic product-name normalization pipeline (spec §7).
 *
 * Always produces raw + normalized forms; never destroys the source string.
 * Handles full/half-width, casing, spaces, brackets, separators, x/X/×,
 * measurement units, duplicated punctuation, bracket & hashtag extraction,
 * pack-size parsing, and Traditional/Simplified search-form generation.
 */

const OpenCC = require('opencc-js');

const toSimplified = OpenCC.Converter({ from: 'hk', to: 'cn' });
const toTraditional = OpenCC.Converter({ from: 'cn', to: 'hk' });

// Full-width ASCII -> half-width, plus ideographic space.
function widthFold(s) {
  return s
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

// Normalize various brackets to a canonical half-width form for matching.
function normalizeBrackets(s) {
  return s
    .replace(/[（(〔［【]/g, '(')
    .replace(/[）)〕］】]/g, ')');
}

// Normalize multiplication signs used in pack sizes.
function normalizeTimes(s) {
  return s.replace(/[×✕✖＊*]/g, 'x').replace(/[X]/g, 'x');
}

function normalizeSeparators(s) {
  return s
    .replace(/[｜│¦]/g, '|')
    .replace(/[、・]/g, ' ')
    .replace(/[／]/g, '/')
    .replace(/[＃]/g, '#')
    .replace(/[—–−]/g, '-');
}

function collapseSpaces(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function dedupePunctuation(s) {
  return s
    .replace(/([#|(),/\-])\1+/g, '$1')
    .replace(/\s*([#|(),/\-])\s*/g, '$1');
}

// Unit normalization: ml/mL/ML/毫升 -> ml ; L/公升/升 -> L ; g/克 -> g ; kg/公斤 -> kg.
function normalizeUnits(s) {
  return s
    .replace(/毫升/g, 'ml')
    .replace(/公升/g, 'L')
    .replace(/(?<![A-Za-z])mL(?![A-Za-z])/g, 'ml')
    .replace(/(?<![A-Za-z])ML(?![A-Za-z])/g, 'ml')
    .replace(/(?<![A-Za-z])Ml(?![A-Za-z])/g, 'ml')
    .replace(/(?<![A-Za-z])克/g, 'g')
    .replace(/(?<![A-Za-z])公斤/g, 'kg');
}

/** Master normalization for matching. Display forms are kept separately. */
function normalize(raw) {
  if (raw == null) return '';
  let s = String(raw);
  s = s.normalize('NFKC');            // Unicode normalization (also folds some width)
  s = widthFold(s);
  s = normalizeBrackets(s);
  s = normalizeSeparators(s);
  s = normalizeUnits(s);
  s = normalizeTimes(s);
  s = dedupePunctuation(s);
  s = collapseSpaces(s);
  return s;
}

/** Lowercased matching key (English case-insensitive). */
function matchKey(raw) {
  return normalize(raw).toLowerCase();
}

/** Extract bracket contents: returns {base, brackets[]}. */
function extractBrackets(s) {
  const brackets = [];
  const base = String(s).replace(/\(([^()]*)\)/g, (m, inner) => {
    if (inner && inner.trim()) brackets.push(inner.trim());
    return ' ';
  });
  return { base: collapseSpaces(base), brackets };
}

/** Extract hashtag segments: returns {base, hashtags[]}. */
function extractHashtags(s) {
  const hashtags = [];
  const base = String(s).replace(/#([^#]+)/g, (m, inner) => {
    if (inner && inner.trim()) hashtags.push(inner.trim());
    return ' ';
  });
  return { base: collapseSpaces(base), hashtags };
}

// Chinese number words used for pack counts (四支裝 -> 4).
const CN_NUM = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/**
 * Parse pack-size from text into structured data.
 * Recognizes: "250ml x 24支", "250ML X24", "250毫升×24支", "250 ml x 24",
 *             "1000ml", "1L", "1公升", "1000ml x 4支", "四支裝".
 * Guards: does NOT treat years (19xx/20xx), percentages, or bare model numbers as sizes.
 * Returns {unit_size, unit_measurement, pack_count, pack_unit, display_pack_format} or nulls.
 */
function parsePackSize(rawText) {
  if (!rawText) return emptyPack();
  const text = normalize(rawText);
  const out = emptyPack();

  // Guard: strip obvious non-size numbers (dates like 2024, percentages like 3.6%).
  // We work on a copy; size extraction uses explicit unit-anchored patterns only.

  // Pattern A: "<num><unit> x <num><packUnit?>"  e.g. 250ml x 24支 / 250ML X24 / 250毫升×24支
  let m = text.match(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg)\s*x\s*(\d+)\s*(支|粒|片|包|盒|樽|罐|個|件|裝)?/i);
  if (m) {
    out.unit_size = parseFloat(m[1]);
    out.unit_measurement = normalizeUnitName(m[2]);
    out.pack_count = parseInt(m[3], 10);
    out.pack_unit = m[4] && m[4] !== '裝' ? m[4] : (m[4] === '裝' ? null : null);
    out.display_pack_format = buildPackFormat(out);
    return out;
  }

  // Pattern A2: "<num><unit><num><packUnit>" with no separator, e.g. 250毫升24支 / 1000ml4支
  m = text.match(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg)\s*(\d+)\s*(支|粒|片|包|盒|樽|罐|個|件)/i);
  if (m) {
    out.unit_size = parseFloat(m[1]);
    out.unit_measurement = normalizeUnitName(m[2]);
    out.pack_count = parseInt(m[3], 10);
    out.pack_unit = m[4];
    out.display_pack_format = buildPackFormat(out);
    return out;
  }

  // Pattern B: "<num><unit>" only, e.g. 1000ml / 1L / 1公升 (no pack count)
  m = text.match(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg)\b/i);
  if (m) {
    out.unit_size = parseFloat(m[1]);
    out.unit_measurement = normalizeUnitName(m[2]);
    out.display_pack_format = buildPackFormat(out);
    // Fallthrough: also try to capture a Chinese-number pack like 四支裝 elsewhere.
    const cn = text.match(/([一二兩三四五六七八九十])\s*(支|粒|片|包|盒|樽|罐|個|件)\s*裝/);
    if (cn) {
      out.pack_count = CN_NUM[cn[1]] || null;
      out.pack_unit = cn[2];
      out.display_pack_format = buildPackFormat(out);
    }
    return out;
  }

  // Pattern C: Chinese-number pack only, e.g. "四支裝" / "24支"
  m = text.match(/([一二兩三四五六七八九十]|\d+)\s*(支|粒|片|包|盒|樽|罐|個|件)\s*裝?/);
  if (m) {
    out.pack_count = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : (CN_NUM[m[1]] || null);
    out.pack_unit = m[2];
    out.display_pack_format = buildPackFormat(out);
    return out;
  }

  return out;
}

function emptyPack() {
  return { unit_size: null, unit_measurement: null, pack_count: null, pack_unit: null, display_pack_format: null };
}

function normalizeUnitName(u) {
  const x = String(u).toLowerCase();
  if (x === 'l') return 'L';
  if (x === 'ml') return 'ml';
  if (x === 'g') return 'g';
  if (x === 'kg') return 'kg';
  return x;
}

function buildPackFormat(p) {
  const sizePart = p.unit_size != null && p.unit_measurement
    ? `${trimNum(p.unit_size)}${p.unit_measurement}` : null;
  const packPart = p.pack_count != null ? `${p.pack_count}${p.pack_unit || ''}`.trim() : null;
  if (sizePart && packPart) return `${sizePart} x ${packPart}`;
  if (sizePart) return sizePart;
  if (packPart) return packPart;
  return null;
}

function trimNum(n) {
  return Number.isInteger(n) ? String(n) : String(n).replace(/\.?0+$/, '');
}

/** Generate Traditional + Simplified search forms (display form untouched). */
function searchForms(raw) {
  const t = toTraditional(String(raw));
  const s = toSimplified(String(raw));
  return { traditional: t, simplified: s };
}

/**
 * Full normalization record for a raw SKU name (spec §7 + §3 example).
 * Returns raw + normalized + base_title + bracket/hashtag attributes + pack data.
 */
function analyze(rawName) {
  const raw = String(rawName == null ? '' : rawName);
  const normalized = normalize(raw);
  const afterHash = extractHashtags(normalized);
  const afterBrackets = extractBrackets(afterHash.base);
  const baseTitle = collapseSpaces(afterBrackets.base);
  const pack = parsePackSize(normalized);
  const forms = searchForms(baseTitle);
  // Attributes: bracket contents first, then hashtags (spec §3 order: 急凍 then 牛肉粒...).
  const attributes = [...afterBrackets.brackets, ...afterHash.hashtags];
  return {
    raw_sku_name: raw,
    normalized_sku_name: normalized,
    base_title: baseTitle,
    hashtags: afterHash.hashtags,
    brackets: afterBrackets.brackets,
    extracted_attributes: attributes,
    pack,
    search_traditional: forms.traditional,
    search_simplified: forms.simplified,
  };
}

/**
 * Normalized fingerprint for Product Key dedupe (spec §2 Level 3).
 * Normalizes case, width, x/X/×, whitespace, ml/mL/ML/毫升, punctuation,
 * and produces a simplified-chinese matching form so 无糖 == 無糖.
 */
function keyFingerprint(parts) {
  const joined = [
    parts.brand || '',
    parts.token || '',
    parts.origin || '',
    parts.variant || '',
    parts.unit_size != null ? trimNum(Number(parts.unit_size)) : '',
    parts.unit_measurement ? normalizeUnitName(parts.unit_measurement) : '',
    parts.pack_count != null ? String(parts.pack_count) : '',
    parts.pack_unit || '',
  ].join('|');
  const folded = toSimplified(normalize(joined)).toLowerCase().replace(/\s+/g, '');
  return folded;
}

module.exports = {
  normalize,
  matchKey,
  widthFold,
  extractBrackets,
  extractHashtags,
  parsePackSize,
  analyze,
  keyFingerprint,
  searchForms,
  toSimplified,
  toTraditional,
  buildPackFormat,
  CN_NUM,
};

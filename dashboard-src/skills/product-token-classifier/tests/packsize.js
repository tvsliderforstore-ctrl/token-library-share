'use strict';
/**
 * packsize.js — self-contained pack-size parser for the skill's tests.
 * Mirrors the dashboard's src/lib/normalize.js parsePackSize so the skill can
 * validate pack-size golden cases standalone (no dependency on the app source).
 * Keep in sync with the dashboard implementation.
 */

const CN_NUM = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const PACK_UNITS = '(支|粒|片|包|盒|樽|罐|個|件|裝|袋|set|pcs|pc)';

function toHalfWidth(s) {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
}
function normUnit(u) {
  if (!u) return null;
  const m = String(u).toLowerCase();
  if (['ml', '毫升'].includes(m)) return 'ml';
  if (['l', '公升', '升'].includes(m)) return 'L';
  if (['g', '克'].includes(m)) return 'g';
  if (['kg', '公斤', '千克'].includes(m)) return 'kg';
  return m;
}
function cnToInt(ch) { return CN_NUM[ch] != null ? CN_NUM[ch] : null; }

/** Parse a pack size from free text into structured fields. Null fields when absent. */
function parsePackSize(input) {
  if (!input) return { unit_size: null, unit_measurement: null, pack_count: null, pack_unit: null };
  let s = toHalfWidth(String(input)).replace(/×/g, 'x').replace(/X/g, 'x');
  const out = { unit_size: null, unit_measurement: null, pack_count: null, pack_unit: null };

  // "<num><unit> x <num><packUnit?>"  e.g. 250ml x 24支 / 250毫升×24支 / 250 ml x 24
  let m = s.match(/(\d+(?:\.\d+)?)\s*(ml|毫升|l|公升|升|g|克|kg|公斤|千克)\s*x\s*(\d+)\s*([^\s\d]*)/i);
  if (m) {
    out.unit_size = parseFloat(m[1]);
    out.unit_measurement = normUnit(m[2]);
    out.pack_count = parseInt(m[3], 10);
    out.pack_unit = m[4] || null;
    return out;
  }
  // "<num><unit><num><packUnit>" with no x, e.g. 250毫升24支
  m = s.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*(ml|毫升|l|公升|升|g|克|kg|公斤|千克)\\s*(\\d+)\\s*' + PACK_UNITS, 'i'));
  if (m) {
    out.unit_size = parseFloat(m[1]);
    out.unit_measurement = normUnit(m[2]);
    out.pack_count = parseInt(m[3], 10);
    out.pack_unit = m[4] || null;
    return out;
  }
  // "<num><unit>" + Chinese-number pack, e.g. 1000ml四支裝
  m = s.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*(ml|毫升|l|公升|升|g|克|kg|公斤|千克)\\s*([一二兩三四五六七八九十])\\s*' + PACK_UNITS, 'i'));
  if (m) {
    out.unit_size = parseFloat(m[1]);
    out.unit_measurement = normUnit(m[2]);
    out.pack_count = cnToInt(m[3]);
    out.pack_unit = m[4] || null;
    return out;
  }
  // bare "<num><unit>" e.g. 1000ml / 1L / 1公升 / 500克 / 2公斤
  m = s.match(/(\d+(?:\.\d+)?)\s*(ml|毫升|l|公升|升|g|克|kg|公斤|千克)/i);
  if (m) {
    out.unit_size = parseFloat(m[1]);
    out.unit_measurement = normUnit(m[2]);
    return out;
  }
  return out;
}

module.exports = { parsePackSize };

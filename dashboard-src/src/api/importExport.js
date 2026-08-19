'use strict';
/**
 * importExport.js — CSV/XLSX/JSON import with validation + export (spec §27, §12.9).
 * Validates every row; no partial import unless `importValidOnly` is set.
 */
const ExcelJS = require('exceljs');
const { analyze } = require('../lib/normalize');

const TEMPLATE_COLUMNS = [
  'external_sku_id', 'barcode', 'raw_sku_name', 'large_group_code', 'product_token_code',
  'product_key_code', 'brand', 'origin', 'variant', 'unit_size', 'unit_measurement',
  'pack_count', 'pack_unit', 'sales_channel', 'active',
];

// ---------- CSV ----------
function parseCSV(text) {
  const rows = [];
  let cur = [''], inQ = false, r = 0;
  const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { cur[r] += '"'; i++; } else inQ = false; }
      else cur[r] += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { cur.push(''); r++; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      rows.push(cur); cur = ['']; r = 0;
    } else cur[r] += c;
  }
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  return rows.filter((row) => row.some((cell) => String(cell).trim() !== ''));
}

function toCSV(rows) {
  return rows.map((row) => row.map((cell) => {
    const v = cell == null ? '' : String(cell);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(',')).join('\r\n');
}

function rowsToObjects(matrix) {
  if (!matrix.length) return [];
  const header = matrix[0].map((h) => String(h).trim());
  return matrix.slice(1).map((row) => {
    const o = {};
    header.forEach((h, i) => { o[h] = row[i] !== undefined ? String(row[i]).trim() : ''; });
    return o;
  });
}

// ---------- XLSX ----------
async function parseXLSX(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const matrix = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = [];
    for (let i = 1; i <= row.cellCount; i++) {
      const v = row.getCell(i).value;
      vals.push(v == null ? '' : (typeof v === 'object' && v.text !== undefined ? v.text : v));
    }
    matrix.push(vals);
  });
  return matrix;
}

async function toXLSX(rows, sheetName) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName || 'Export');
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- Validation ----------
function validateImportRows(db, objects) {
  const groupCodes = new Set(db.all('SELECT group_code FROM large_groups').map((r) => r.group_code));
  const tokenCodes = new Set(db.all('SELECT token_code FROM product_tokens').map((r) => r.token_code));
  const keyCodes = new Set(db.all('SELECT product_key_code FROM product_keys').map((r) => r.product_key_code));
  const seenExt = new Set(); const seenBarcode = new Set(); const seenKeyFp = new Set();
  const valid = []; const invalid = []; const warnings = [];

  objects.forEach((o, idx) => {
    const rowNum = idx + 2; // header is row 1
    const errs = [];
    if (!o.raw_sku_name || !o.raw_sku_name.trim()) errs.push('缺少必填欄位 raw_sku_name');
    if (o.large_group_code && !groupCodes.has(o.large_group_code)) errs.push(`未知大類代碼 ${o.large_group_code}`);
    if (o.product_token_code && !tokenCodes.has(o.product_token_code)) errs.push(`未知產品符號代碼 ${o.product_token_code}`);
    if (o.product_key_code && !keyCodes.has(o.product_key_code)) errs.push(`未知 Product Key 代碼 ${o.product_key_code}`);
    if (o.external_sku_id) {
      if (seenExt.has(o.external_sku_id)) errs.push(`重複 external_sku_id ${o.external_sku_id}`);
      seenExt.add(o.external_sku_id);
      if (db.get('SELECT id FROM sku_records WHERE external_sku_id=?', [o.external_sku_id])) warnings.push({ row: rowNum, msg: `external_sku_id ${o.external_sku_id} 已存在（將更新）` });
    }
    if (o.barcode) {
      if (seenBarcode.has(o.barcode)) errs.push(`重複 barcode ${o.barcode}`);
      seenBarcode.add(o.barcode);
    }
    if (o.unit_size && isNaN(Number(o.unit_size))) errs.push(`unit_size 非數字 ${o.unit_size}`);
    if (o.pack_count && isNaN(parseInt(o.pack_count, 10))) errs.push(`pack_count 非整數 ${o.pack_count}`);
    if (errs.length) invalid.push({ row: rowNum, errors: errs, data: o });
    else valid.push({ row: rowNum, data: o });
  });
  return { valid, invalid, warnings, total: objects.length };
}

module.exports = { TEMPLATE_COLUMNS, parseCSV, toCSV, rowsToObjects, parseXLSX, toXLSX, validateImportRows };

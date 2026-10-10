'use strict';
/** config.js — environment-driven configuration. No secrets in source. */
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');

const config = {
  root: ROOT,
  // SQLite file location (overridable for tests via env).
  dbFile: process.env.PTL_DB_FILE || path.join(ROOT, 'data', 'product-token-library.db'),
  port: parseInt(process.env.PTL_PORT || '4310', 10),
  host: process.env.PTL_HOST || '127.0.0.1',
  // Existing-skill adapter settings (wrap; never re-implement collection).
  stockSkill: {
    name: process.env.PTL_STOCK_SKILL || 'stock-status-checker',
    // Where the skill actually lives (user-confirmed).
    script: process.env.PTL_STOCK_SCRIPT ||
      path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'profiles', 'app',
        'skills', 'productivity', 'stock-status-checker', 'scripts', 'check_sku.py'),
    python: process.env.PTL_PYTHON ||
      path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe'),
    source: 'HKTVmall',
  },
  priceSkill: {
    // Two candidates exist; the dashboard setting selects the active one.
    name: process.env.PTL_PRICE_SKILL || 'psos-discount-report-download',
    source: 'PSOS',
    candidates: ['psos-discount-report-download', 'promotional-catalog-xlsx'],
  },
  // Freshness thresholds (configurable; defaults per spec §20).
  freshness: {
    freshHours: parseFloat(process.env.PTL_FRESH_HOURS || '30'),
  },
  // Confidence bands (spec §10).
  confidence: {
    autoAccept: parseFloat(process.env.PTL_CONF_AUTO || '0.95'),
    reviewFloor: parseFloat(process.env.PTL_CONF_REVIEW || '0.75'),
  },
  timezone: process.env.PTL_TZ || 'Asia/Hong_Kong',
  currency: process.env.PTL_CURRENCY || 'HKD',
  taxonomyVersion: process.env.PTL_TAXONOMY_VERSION || '1.0.0',
};

module.exports = config;

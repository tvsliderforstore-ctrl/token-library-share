'use strict';
/** helpers.js — shared test fixtures: fresh seeded in-memory-ish DB per test file. */
const os = require('os');
const path = require('path');
const fs = require('fs');
const { Database } = require('../src/db/db');
const { seed } = require('../src/db/seed');

let counter = 0;
async function freshDb() {
  const file = path.join(os.tmpdir(), `ptl-test-${process.pid}-${Date.now()}-${counter++}.db`);
  await seed(file);
  const db = await Database.open(file);
  db._testFile = file;
  return db;
}
function cleanup(db) {
  try { db.close(); } catch (_) {}
  if (db._testFile && fs.existsSync(db._testFile)) { try { fs.unlinkSync(db._testFile); } catch (_) {} }
}
module.exports = { freshDb, cleanup };

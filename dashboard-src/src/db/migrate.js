'use strict';
/** migrate.js — apply migrations in order, tracked in a _migrations table. */
const fs = require('fs');
const path = require('path');
const { Database } = require('./db');
const config = require('../config');

async function migrate(dbFile) {
  const file = dbFile || config.dbFile;
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = await Database.open(file);
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  );`);
  const migDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(db.all('SELECT name FROM _migrations').map((r) => r.name));
  const now = new Date().toISOString();
  const ran = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(migDir, f), 'utf8');
    db.tx(() => {
      db.exec(sql);
      db.run('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)', [f, now]);
    });
    ran.push(f);
  }
  return { ran, total: files.length, file };
}

if (require.main === module) {
  migrate().then((r) => {
    console.log('Migrations applied:', r.ran.length ? r.ran.join(', ') : '(none — up to date)');
    console.log('DB file:', r.file);
  }).catch((e) => { console.error('Migration failed:', e); process.exit(1); });
}

module.exports = { migrate };

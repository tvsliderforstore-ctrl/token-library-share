/**
 * db.js — SQLite persistence layer backed by sql.js (WASM, pure JS, no native build).
 *
 * The whole database is held in memory and flushed to disk on change (debounced).
 * This gives us real SQLite semantics (constraints, FKs, indexes, transactions)
 * without a native module, which fails to build on this Windows host.
 *
 * Layout:
 *   - openDatabase(file) -> wraps sql.js Database, loads existing file if present
 *   - Prepared-statement helpers: run/get/all with positional params
 *   - tx(fn): explicit transaction with BEGIN IMMEDIATE / COMMIT / ROLLBACK
 *   - save(): persist to disk (atomic via tmp-file rename)
 */
'use strict';

const fs = require('fs');
const path = require('path');

let _SQL = null;
async function initSql() {
  if (_SQL) return _SQL;
  const initSqlJs = require('sql.js');
  // Locate the wasm file shipped with sql.js so it works from any CWD.
  const wasmPath = path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  _SQL = await initSqlJs({
    locateFile: (f) => (fs.existsSync(wasmPath) ? wasmPath : f),
  });
  return _SQL;
}

class Database {
  constructor(sqlDb, filePath) {
    this.db = sqlDb;
    this.filePath = filePath || null;
    this._dirty = false;
    this._saveTimer = null;
    this._saveDelayMs = 250;
    this._inTx = 0;
  }

  static async open(filePath) {
    const SQL = await initSql();
    let db;
    if (filePath && fs.existsSync(filePath)) {
      const buf = fs.readFileSync(filePath);
      db = new SQL.Database(new Uint8Array(buf));
    } else {
      db = new SQL.Database();
    }
    const wrapper = new Database(db, filePath);
    // Pragmas for integrity & FK enforcement.
    db.run('PRAGMA foreign_keys = ON;');
    db.run('PRAGMA journal_mode = MEMORY;'); // file persistence handled manually
    db.run('PRAGMA busy_timeout = 5000;');
    return wrapper;
  }

  /** Mark dirty and schedule a flush (unless inside a transaction). */
  _touch() {
    this._dirty = true;
    if (this._inTx === 0) this._scheduleSave();
  }

  _scheduleSave() {
    if (!this.filePath) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), this._saveDelayMs);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  /** Persist to disk atomically (write tmp then rename). */
  save() {
    if (!this.filePath) return;
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    const data = this.db.export();
    const buf = Buffer.from(data);
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, this.filePath);
    this._dirty = false;
  }

  /** Execute a statement (no rows returned). Returns {changes, lastId}. */
  run(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      stmt.step();
      stmt.free();
      this._touch();
      const changes = this.db.getRowsModified();
      const lastIdRow = this.db.exec("SELECT last_insert_rowid() AS id");
      const lastId = lastIdRow.length ? lastIdRow[0].values[0][0] : null;
      return { changes, lastId };
    } catch (e) {
      try { stmt.free(); } catch (_) {}
      throw e;
    }
  }

  /** Return first row as object or undefined. */
  get(sql, params = []) {
    const rows = this.all(sql, params);
    return rows.length ? rows[0] : undefined;
  }

  /** Return all rows as array of objects. */
  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    const out = [];
    try {
      stmt.bind(params);
      const cols = stmt.getColumnNames();
      while (stmt.step()) {
        const vals = stmt.get();
        const obj = {};
        for (let i = 0; i < cols.length; i++) obj[cols[i]] = vals[i];
        out.push(obj);
      }
      return out;
    } finally {
      stmt.free();
    }
  }

  /** Execute raw SQL (multiple statements). Marks dirty. */
  exec(sql) {
    this.db.run(sql);
    this._touch();
  }

  /**
   * Transaction wrapper. fn receives this Database. Nested calls flatten
   * (savepoints are overkill for this app; outer tx owns commit).
   */
  tx(fn) {
    const outer = this._inTx === 0;
    if (outer) this.db.run('BEGIN IMMEDIATE;');
    this._inTx++;
    try {
      const result = fn(this);
      this._inTx--;
      if (outer) {
        this.db.run('COMMIT;');
        this._touch();
        this.save();
      }
      return result;
    } catch (e) {
      this._inTx--;
      if (outer) {
        try { this.db.run('ROLLBACK;'); } catch (_) {}
      }
      throw e;
    }
  }

  close() {
    if (this._dirty) this.save();
    try { this.db.close(); } catch (_) {}
  }
}

module.exports = { Database, initSql };

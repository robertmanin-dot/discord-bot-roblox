// Thin wrapper around Node's built-in SQLite (node:sqlite, no native build needed).
// - Named parameters: use :name in SQL and pass { name } — unknown keys are ignored,
//   undefined becomes NULL, booleans become 0/1, objects/arrays become JSON.
// - db.tx(fn) runs fn synchronously in a transaction (nested calls use savepoints).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './paths.js';
import { MIGRATIONS } from './schema.js';

let current = null;

function normalizeValue(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

function wrap(raw, file) {
  const cache = new Map();
  let depth = 0;

  function prep(sql) {
    let entry = cache.get(sql);
    if (!entry) {
      const stmt = raw.prepare(sql);
      const names = [...new Set([...sql.matchAll(/(?<![:\w])[:@$]([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))];
      entry = { stmt, names };
      if (cache.size > 1000) cache.clear();
      cache.set(sql, entry);
    }
    return entry;
  }

  function bind(entry, params) {
    if (params === undefined || params === null) return [];
    if (Array.isArray(params)) return params.map(normalizeValue);
    if (typeof params === 'object') {
      const obj = {};
      for (const name of entry.names) obj[name] = normalizeValue(params[name]);
      return entry.names.length ? [obj] : [];
    }
    return [normalizeValue(params)];
  }

  const api = {
    raw,
    file,
    all(sql, params) {
      const e = prep(sql);
      return e.stmt.all(...bind(e, params));
    },
    get(sql, params) {
      const e = prep(sql);
      return e.stmt.get(...bind(e, params)) ?? null;
    },
    run(sql, params) {
      const e = prep(sql);
      const r = e.stmt.run(...bind(e, params));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    /** Value of the first column of the first row (or fallback). */
    value(sql, params, fallback = null) {
      const row = api.get(sql, params);
      if (!row) return fallback;
      const v = Object.values(row)[0];
      return v === undefined || v === null ? fallback : v;
    },
    exec(sql) {
      raw.exec(sql);
    },
    tx(fn) {
      const sp = `sp_${depth}`;
      if (depth === 0) raw.exec('BEGIN IMMEDIATE');
      else raw.exec(`SAVEPOINT ${sp}`);
      depth++;
      try {
        const result = fn(api);
        if (result && typeof result.then === 'function') {
          throw new Error('db.tx() callback must be synchronous');
        }
        depth--;
        if (depth === 0) raw.exec('COMMIT');
        else raw.exec(`RELEASE ${sp}`);
        return result;
      } catch (err) {
        depth--;
        if (depth === 0) raw.exec('ROLLBACK');
        else {
          raw.exec(`ROLLBACK TO ${sp}`);
          raw.exec(`RELEASE ${sp}`);
        }
        throw err;
      }
    },
    close() {
      cache.clear();
      raw.close();
      if (current === api) current = null;
    },
  };
  return api;
}

function migrate(db) {
  const version = db.value('PRAGMA user_version', null, 0);
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.tx(() => {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

/** Opens (and migrates) a database. Use ':memory:' in tests. Becomes the default database. */
export function openDb(file = path.join(DATA_DIR, 'radar.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode = WAL;');
  const db = wrap(raw, file);
  migrate(db);
  current = db;
  return db;
}

/** The default database (opened by openDb). */
export function getDb() {
  if (!current) throw new Error('Datenbank ist nicht geöffnet (openDb() fehlt).');
  return current;
}

export function setDb(db) {
  current = db;
}

export function closeDb() {
  if (current) current.close();
  current = null;
}

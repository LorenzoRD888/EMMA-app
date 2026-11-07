// Database layer. EMMA uses the SQLite engine built into Node.js (node:sqlite,
// Node 22.13+ / 23.4+ / 24): nothing to download or compile, so a fresh
// install cannot fail or crash because of a native library. If an older Node
// lacks node:sqlite, the optional better-sqlite3 package is used instead.
// The wrapper offers the small part of the better-sqlite3 API EMMA uses:
// prepare().run/get/all, exec, pragma, transaction, backup, close.

// node:sqlite prints an "experimental feature" warning on every start: hide only that one.
const emit = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const text = String(warning?.message || warning);
  if (/SQLite is an experimental feature/i.test(text)) return;
  return emit.call(process, warning, ...rest);
};

let Native = null;
try { ({ DatabaseSync: Native } = await import('node:sqlite')); } catch {}
let Legacy = null;
if (!Native) {
  try { Legacy = (await import('better-sqlite3')).default; }
  catch { throw new Error('EMMA needs Node.js 22.13 or later (or the better-sqlite3 package). Install a recent Node.js from nodejs.org.'); }
}

const plain = row => (row && typeof row === 'object' ? { ...row } : row);

class Statement {
  constructor(stmt) { this.stmt = stmt; }
  run(...args) { const r = this.stmt.run(...args); return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid }; }
  get(...args) { return plain(this.stmt.get(...args)); }
  all(...args) { return this.stmt.all(...args).map(plain); }
}

class NativeDatabase {
  constructor(filename) { this.db = new Native(filename); this.depth = 0; this.open = true; }
  prepare(sql) { return new Statement(this.db.prepare(sql)); }
  exec(sql) { this.db.exec(sql); return this; }
  pragma(text) { this.db.exec(`PRAGMA ${text}`); }
  // Same behaviour as better-sqlite3: commit on success, roll back on error; nested calls use savepoints.
  transaction(fn) {
    return (...args) => {
      const name = `emma_tx_${this.depth}`;
      const outer = this.depth === 0;
      this.db.exec(outer ? 'BEGIN' : `SAVEPOINT ${name}`);
      this.depth++;
      try {
        const result = fn(...args);
        this.depth--;
        this.db.exec(outer ? 'COMMIT' : `RELEASE ${name}`);
        return result;
      } catch (e) {
        this.depth--;
        try { this.db.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`); } catch {}
        throw e;
      }
    };
  }
  // Copy of the whole database in one file (used before importing data from an older EMMA).
  async backup(file) { this.db.exec(`VACUUM INTO '${String(file).replaceAll("'", "''")}'`); return file; }
  close() { if (this.open) { this.db.close(); this.open = false; } }
}

export default function openDatabase(filename) {
  return Native ? new NativeDatabase(filename) : new Legacy(filename);
}
export const engine = Native ? 'node:sqlite' : 'better-sqlite3';

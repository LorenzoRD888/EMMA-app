// Data from a previous EMMA: the user gives the folder of the old EMMA and
// EMMA brings its companies, news, people, notes and settings into this version.
// EMMA does not search the disk by itself (many computers block it).
// Works on macOS and Windows. The old folder is never modified (EMMA works on
// a temporary copy) and the current data is saved in data/backups first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import openDatabase from './db.js';
import { migrateIntel } from './intel/intel.js';
import { secretKeys } from './settings.js';

const fail = m => Object.assign(new Error(m), { public: true });
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const same = (a, b) => { const x = real(a), y = real(b); return process.platform === 'win32' || process.platform === 'darwin' ? x.toLowerCase() === y.toLowerCase() : x === y; };
const SETTING_KEYS = ['provider', 'localUrl', 'localModel', 'compatUrl', 'compatModel', 'searchProvider', 'searchFallback', ...secretKeys];
const blockedMessage = folder => process.platform === 'win32'
  ? `Windows does not let EMMA read ${folder}. Copy the old EMMA folder to Documents or to your user folder and try again.`
  : `macOS does not let EMMA read ${folder}. Move the old EMMA folder into your home folder, or allow access in System Settings → Privacy & Security → Files and Folders.`;

// Accepts what people paste: "~/Desktop/EMMA", "/Users/me/EMMA/", "C:\Users\me\EMMA",
// "\"C:\...\EMMA\"" (Windows "Copy as path"), "file:///Users/me/EMMA", the data folder
// or the market.sqlite file itself. Returns the EMMA folder.
export function emmaFolder(p, home = os.homedir()) {
  let d = String(p || '').trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!d) return null;
  if (/^file:\/\//i.test(d)) { try { d = fileURLToPath(d); } catch { return null; } }
  if (process.platform !== 'win32') d = d.replace(/\\ /g, ' ');   // macOS Terminal drag & drop: "My\ Folder"
  if (d === '~' || d.startsWith('~/') || d.startsWith('~\\')) d = path.join(home, d.slice(1));
  d = path.resolve(d);
  if (path.basename(d).toLowerCase() === 'market.sqlite') d = path.dirname(d);
  if (path.basename(d).toLowerCase() === 'data' && fs.existsSync(path.join(d, 'market.sqlite'))) d = path.dirname(d);
  if (path.basename(d).toLowerCase() === 'app' && fs.existsSync(path.join(path.dirname(d), 'data', 'market.sqlite'))) d = path.dirname(d);
  return d;
}

// Works on a copy so the old database (and its -wal journal) is never touched.
function copyDb(folder) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emma-import-'));
  for (const ext of ['', '-wal', '-shm']) { const f = path.join(folder, 'data', 'market.sqlite' + ext); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(tmp, 'market.sqlite' + ext)); }
  return { file: path.join(tmp, 'market.sqlite'), cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

function describe(folder) {
  const info = { path: folder, name: path.basename(folder) };
  try { info.version = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')).version || ''; } catch { info.version = ''; }
  info.modified = fs.statSync(path.join(folder, 'data', 'market.sqlite')).mtime.toISOString();
  const copy = copyDb(folder);
  try {
    const db = openDatabase(copy.file);
    const n = (sql) => { try { return db.prepare(sql).get().n; } catch { return 0; } };
    info.companies = n('SELECT COUNT(*) n FROM companies');
    info.news = n('SELECT COUNT(*) n FROM news');
    info.people = n('SELECT COUNT(*) n FROM people');
    try { info.lastUpdate = db.prepare('SELECT MAX(startedAt) d FROM runs').get().d || null; } catch { info.lastUpdate = null; }
    try { info.names = db.prepare('SELECT name FROM companies ORDER BY name LIMIT 6').all().map(r => r.name); } catch { info.names = []; }
    db.close();
  } finally { copy.cleanup(); }
  return info;
}

// What is inside the folder given by the user.
export function inspectFolder(input, { dataDir, home = os.homedir() } = {}) {
  const folder = emmaFolder(input, home);
  if (!folder) throw fail('Paste the path of the old EMMA folder.');
  if (!fs.existsSync(folder)) throw fail(`Folder not found: ${folder}`);
  const file = path.join(folder, 'data', 'market.sqlite');
  try { fs.accessSync(folder, fs.constants.R_OK); } catch { throw fail(blockedMessage(folder)); }
  if (!fs.existsSync(file)) throw fail(`No EMMA data in ${folder}: choose the EMMA folder that contains the "data" folder.`);
  if (same(path.join(folder, 'data'), dataDir)) throw fail('That is the folder of this EMMA.');
  try { return describe(folder); } catch (e) { throw fail(e.code === 'EPERM' || e.code === 'EACCES' ? blockedMessage(folder) : 'The old data could not be read.'); }
}

const readEnv = file => { const out = {}; try { for (const line of fs.readFileSync(file, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } } catch {} return out; };

export async function importPrevious({ db, settings, from, dataDir, home = os.homedir() }) {
  const folder = emmaFolder(from, home);
  if (!folder || !fs.existsSync(path.join(folder, 'data', 'market.sqlite'))) throw fail('No EMMA data found in that folder (it should contain data/market.sqlite).');
  if (same(path.join(folder, 'data'), dataDir)) throw fail('That is the folder of this EMMA.');
  let copy;
  try { copy = copyDb(folder); } catch (e) { throw fail(e.code === 'EPERM' || e.code === 'EACCES' ? blockedMessage(folder) : 'The old data could not be read.'); }
  try {
    // 1. Backup of the current data.
    const backups = path.join(dataDir, 'backups'); fs.mkdirSync(backups, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(backups, `before-import-${stamp}.sqlite`);
    await db.backup(backup);
    try { fs.copyFileSync(path.join(dataDir, 'settings.json'), path.join(backups, `settings-before-import-${stamp}.json`)); } catch {}

    // 2. Table by table, columns in common: the old database may lack the newest columns.
    db.exec(`ATTACH DATABASE '${copy.file.replace(/'/g, "''")}' AS old`);
    const tables = schema => db.prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'news_fts%'`).all().map(r => r.name);
    const cols = (schema, t) => db.prepare(`PRAGMA ${schema}.table_info("${t}")`).all().map(c => c.name);
    const mine = new Set(tables('main'));
    const copied = [];
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        if (mine.has('news')) { try { db.exec('DELETE FROM main.news_fts'); } catch {} }
        for (const t of tables('old')) {
          if (!mine.has(t)) continue;
          const own = new Set(cols('main', t)), common = cols('old', t).filter(c => own.has(c));
          if (!common.length) continue;
          const list = common.map(c => `"${c}"`).join(',');
          db.exec(`DELETE FROM main."${t}"`);
          try { db.exec(`INSERT INTO main."${t}"(${list}) SELECT ${list} FROM old."${t}"`); }
          catch (e) { throw fail(`The old table "${t}" could not be copied (${e.message}). Nothing was changed.`); }
          copied.push(t);
        }
      })();
    } finally { db.pragma('foreign_keys = ON'); db.exec('DETACH DATABASE old'); }
    // 3. Clean-ups added in newer versions run on the imported data.
    migrateIntel(db);

    // 4. Settings and keys (data/settings.json and the old .env).
    let settingsNote = '';
    try {
      const old = (() => { try { return JSON.parse(fs.readFileSync(path.join(folder, 'data', 'settings.json'), 'utf8')); } catch { return {}; } })();
      const env = { ...readEnv(path.join(folder, '.env')), ...readEnv(path.join(folder, 'app', '.env')), ...readEnv(path.join(folder, 'data', '.env')) };
      const body = {};
      for (const k of SETTING_KEYS) if (old[k] !== undefined && old[k] !== '') body[k] = old[k];
      for (const k of secretKeys) if (!body[k] && env[k]) body[k] = env[k];
      if (Object.keys(body).length) await settings.save(body);
    } catch { settingsNote = 'Settings were not copied: check them in Settings.'; }

    // 5. Saved reports (one JSON file each).
    let reports = 0;
    try { for (const f of fs.readdirSync(path.join(folder, 'data'))) if (/^[\da-f-]{36}\.json$/i.test(f) && !fs.existsSync(path.join(dataDir, f))) { fs.copyFileSync(path.join(folder, 'data', f), path.join(dataDir, f)); reports++; } } catch {}

    const n = t => { try { return db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; } catch { return 0; } };
    return { ok: true, from: folder, tables: copied.length, companies: n('companies'), news: n('news'), people: n('people'), reports, backup, settingsNote };
  } finally { copy.cleanup(); }
}

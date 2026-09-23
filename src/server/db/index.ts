import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs, { Database, SqlValue } from 'sql.js';
import { migrateFixturesTableIfNeeded } from './migrateFixtures';

function getModuleDir(): string {
  try {
    if (typeof __dirname !== 'undefined' && __dirname) {
      return __dirname;
    }
  } catch {}
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {}
  return process.cwd();
}

let dbInstance: Database | null = null;
const IS_HOSTED = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.K_SERVICE || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === 'production');
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
const DEFAULT_DATA_DIR = IS_HOSTED || IS_SERVERLESS ? '/tmp/data' : path.resolve(process.cwd(), 'data');
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'efootball.sqlite');
const SCHEMA_FILE = path.resolve(process.cwd(), 'src', 'server', 'db', 'schema.sql');

export function getDbFilePath(): string {
  return DB_FILE;
}

let isSaving = false;
let needsSave = false;

export function resolveSqlWasmPath(): string {
  const modDir = getModuleDir();
  const candidates = [
    // 1. In node_modules (local dev, tsx, standard node environment)
    path.resolve(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(modDir, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    // 2. In same directory as compiled serverless handler (e.g., /var/task/api/sql-wasm.wasm)
    path.join(modDir, 'sql-wasm.wasm'),
    // 3. In api/ folder relative to project root / task root
    path.resolve(process.cwd(), 'api', 'sql-wasm.wasm'),
    // 4. In parent directory (e.g. if modDir is /var/task/api, check /var/task/sql-wasm.wasm)
    path.join(modDir, '..', 'sql-wasm.wasm'),
    path.join(modDir, '..', 'api', 'sql-wasm.wasm'),
    path.resolve(process.cwd(), 'sql-wasm.wasm'),
    // 5. In dist/ folder
    path.resolve(process.cwd(), 'dist', 'sql-wasm.wasm'),
    path.join(modDir, '..', 'dist', 'sql-wasm.wasm'),
    // 6. In public/ folder
    path.resolve(process.cwd(), 'public', 'sql-wasm.wasm'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const stats = fs.statSync(candidate);
        if (stats.isFile() && stats.size > 10000) {
          return candidate;
        }
      }
    } catch {}
  }

  throw new Error(
    `[DB] Could not locate sql-wasm.wasm in any expected location. Checked:\n` +
      candidates.map((c) => ` - ${c}`).join('\n')
  );
}

function isValidSqliteHeader(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 100) return false;
  const headerString = buffer.subarray(0, 16).toString('utf-8');
  return headerString === 'SQLite format 3\0';
}

export function resolveBundledDbPath(): string | null {
  // A repository database is never runtime user data on any hosted platform.
  // Guard the resolver itself so every current/future fallback is covered.
  if (IS_HOSTED) return null;
  const modDir = getModuleDir();
  const candidates = [
    path.resolve(process.cwd(), 'data', 'efootball.sqlite'),
    path.join(modDir, 'data', 'efootball.sqlite'),
    path.join(modDir, '..', 'data', 'efootball.sqlite'),
    path.resolve(process.cwd(), 'api', 'data', 'efootball.sqlite'),
    path.resolve(process.cwd(), 'api', 'efootball.sqlite'),
    path.join(modDir, 'efootball.sqlite'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const stats = fs.statSync(candidate);
        if (stats.isFile() && stats.size > 1000) {
          const buf = fs.readFileSync(candidate);
          if (isValidSqliteHeader(buf)) {
            return candidate;
          }
        }
      }
    } catch {}
  }
  return null;
}

export async function initDatabase(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }
  if (IS_HOSTED && [path.resolve(process.cwd(), 'data/efootball.sqlite'), path.resolve(process.cwd(), 'api/data/efootball.sqlite')].includes(path.resolve(DB_FILE))) {
    throw new Error('BUNDLED_DATABASE_FORBIDDEN: configure a separate runtime DB_FILE or DATA_DIR');
  }

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn(` [DB] Could not create DATA_DIR ${DATA_DIR}, falling back to /tmp/data:`, err);
  }

  // If running on serverless and target DB_FILE does not exist in /tmp/data, copy pre-seeded SQLite from repo
  if (IS_SERVERLESS && !fs.existsSync(DB_FILE)) {
    const hosted = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL || process.env.K_SERVICE || process.env.AWS_LAMBDA_FUNCTION_NAME);
    const bundledDbPath = hosted ? null : resolveBundledDbPath();
    if (bundledDbPath && fs.existsSync(bundledDbPath)) {
      try {
        fs.copyFileSync(bundledDbPath, DB_FILE);
        console.log(` [DB] Copied bundled database from ${bundledDbPath} to serverless location: ${DB_FILE}`);
      } catch (err) {
        console.warn(' [DB] Could not copy bundled DB to serverless path:', err);
      }
    }
  }

  const wasmPath = resolveSqlWasmPath();
  let SQL: any;
  try {
    const wasmFileBuffer = fs.readFileSync(wasmPath);
    const wasmBinary = new Uint8Array(wasmFileBuffer);
    SQL = await initSqlJs({
      locateFile: () => wasmPath,
      wasmBinary,
    });
  } catch (err1) {
    try {
      SQL = await initSqlJs({
        locateFile: () => wasmPath,
      });
    } catch (err2) {
      SQL = await initSqlJs({});
    }
  }

  if (fs.existsSync(DB_FILE)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE);
      if (isValidSqliteHeader(fileBuffer)) {
        dbInstance = new SQL.Database(fileBuffer);
        // Test query to ensure DB is not malformed
        dbInstance.exec('SELECT 1');
        console.log(` [DB] path=${DB_FILE}`);
        console.log(' [DB] initialized=true (loaded from disk)');
      } else {
        throw new Error('INVALID_SQLITE_FILE: existing database preserved for recovery');
      }
    } catch (err) {
      dbInstance?.close();
      dbInstance = null;
      throw err;
    }
  } else {
    // If DB_FILE does not exist, check if bundled repo sqlite file can be loaded directly
    const bundledDbPath = resolveBundledDbPath();
    if (bundledDbPath && fs.existsSync(bundledDbPath)) {
      try {
        const fileBuffer = fs.readFileSync(bundledDbPath);
        if (isValidSqliteHeader(fileBuffer)) {
          dbInstance = new SQL.Database(fileBuffer);
          console.log(` [DB] Loaded bundled database from: ${bundledDbPath}`);
        } else {
          dbInstance = new SQL.Database();
        }
      } catch {
        dbInstance = new SQL.Database();
      }
    } else {
      console.log(` [DB] path=${DB_FILE}`);
      console.log(' [DB] initialized=true (new)');
      dbInstance = new SQL.Database();
    }
  }

  // Ensure tables and schemas are created
  if (fs.existsSync(SCHEMA_FILE)) {
    try {
      const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf-8');
      dbInstance.exec(schemaSql);
    } catch (err: any) {
      console.error(' [DB] Schema initialization failed; existing database preserved.');
      dbInstance.close();
      dbInstance = null;
      throw err;
    }
  }

  // Gracefully ensure snapshot columns exist on competition_participants if table already existed
  try {
    dbInstance.exec(`
      ALTER TABLE competition_participants ADD COLUMN season_id TEXT;
    `);
  } catch {}
  try {
    dbInstance.exec(`
      ALTER TABLE competition_participants ADD COLUMN owner_user_id TEXT;
    `);
  } catch {}
  try {
    dbInstance.exec(`
      ALTER TABLE competition_participants ADD COLUMN source_competition_id TEXT;
    `);
  } catch {}
  try {
    dbInstance.exec(`
      ALTER TABLE competition_participants ADD COLUMN source_position INTEGER;
    `);
  } catch {}
  try {
    dbInstance.exec(`
      ALTER TABLE competition_participants ADD COLUMN qualification_reason TEXT;
    `);
  } catch {}
  try {
    dbInstance.exec(`
      ALTER TABLE competition_participants ADD COLUMN qualification_timestamp TEXT;
    `);
  } catch {}
  // Ensure fixtures table supports nullable club IDs and source metadata columns safely and idempotently
  try {
    migrateFixturesTableIfNeeded(dbInstance);
  } catch (migErr) {
    console.error(' [DB] Error during fixtures table migration:', migErr);
    dbInstance.close();
    dbInstance = null;
    throw migErr;
  }

  try {
    dbInstance.exec(`
      ALTER TABLE fixtures ADD COLUMN fixture_source TEXT DEFAULT 'official_2026_27';
    `);
  } catch {}
  try {
    dbInstance.exec(`
      ALTER TABLE fixtures ADD COLUMN source_fixture_id TEXT;
    `);
  } catch {}
  try {
    dbInstance.exec(`
      ALTER TABLE fixtures ADD COLUMN source_winner_slot TEXT;
    `);
  } catch {}
  try {
    dbInstance.exec(`
      ALTER TABLE club_memberships ADD COLUMN updated_at TEXT;
    `);
  } catch {}
  try {
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS season_league_clubs (
        id TEXT PRIMARY KEY,
        season_id TEXT NOT NULL,
        league_id TEXT NOT NULL,
        club_id TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY(season_id) REFERENCES seasons(id),
        FOREIGN KEY(league_id) REFERENCES leagues(id),
        FOREIGN KEY(club_id) REFERENCES clubs(id),
        UNIQUE(season_id, club_id)
      );
    `);
  } catch {}
  try {
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS pending_mutations (
        mutation_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } catch {}
  try {
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS active_occupancies_cache (
        club_id TEXT NOT NULL,
        season_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT,
        display_name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (season_id, club_id)
      );
    `);
  } catch {}
  try {
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS competition_standings (
        competition_id TEXT NOT NULL,
        club_id TEXT NOT NULL,
        rank INTEGER NOT NULL,
        club_name TEXT NOT NULL,
        short_name TEXT NOT NULL,
        logo_url TEXT,
        played INTEGER NOT NULL DEFAULT 0,
        won INTEGER NOT NULL DEFAULT 0,
        drawn INTEGER NOT NULL DEFAULT 0,
        lost INTEGER NOT NULL DEFAULT 0,
        goals_for INTEGER NOT NULL DEFAULT 0,
        goals_against INTEGER NOT NULL DEFAULT 0,
        goal_difference INTEGER NOT NULL DEFAULT 0,
        points INTEGER NOT NULL DEFAULT 0,
        form_json TEXT,
        qualification_status TEXT,
        manager_username TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (competition_id, club_id)
      );
      CREATE INDEX IF NOT EXISTS idx_competition_standings_rank ON competition_standings(competition_id, rank);
    `);
  } catch {}

  try {
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS matchday_locks (
        id TEXT PRIMARY KEY,
        season_id TEXT NOT NULL,
        competition_id TEXT NOT NULL,
        matchday INTEGER NOT NULL,
        override_status TEXT NOT NULL,
        is_open INTEGER NOT NULL,
        is_locked INTEGER NOT NULL,
        duration_hours INTEGER,
        opened_at TEXT,
        locked_at TEXT,
        expires_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_matchday_locks_lookup
      ON matchday_locks(season_id, competition_id, matchday);
    `);
  } catch (err: any) {
    console.error(' [DB] Critical error ensuring matchday_locks table:', err);
    dbInstance.close();
    dbInstance = null;
    throw err;
  }

  // Verify matchday_locks table exists after initialization
  try {
    const tableCheck = dbInstance.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='matchday_locks';`);
    if (!tableCheck || tableCheck.length === 0 || tableCheck[0].values.length === 0) {
      const err = new Error('Database initialization failed: matchday_locks table does not exist');
      console.error(' [DB]', err.message);
      dbInstance.close();
      dbInstance = null;
      throw err;
    }
  } catch (verifyErr: any) {
    console.error(' [DB] matchday_locks table verification failed:', verifyErr);
    if (dbInstance) {
      dbInstance.close();
      dbInstance = null;
    }
    throw verifyErr;
  }

  saveDatabaseSync();
  return dbInstance;
}

export { migrateFixturesTableIfNeeded } from './migrateFixtures';

export function isDatabaseInitialized(): boolean {
  return dbInstance !== null;
}

export function getDb(): Database {
  if (!dbInstance) {
    throw new Error('Database is not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

export function saveDatabaseSync(): void {
  if (!dbInstance) return;
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    const targetDir = path.dirname(DB_FILE);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const tempFile = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, buffer);
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error(' [DB] Error saving SQLite database to disk:', err);
  }
}

export async function persistDatabase(): Promise<void> {
  if (isSaving) {
    needsSave = true;
    return;
  }

  isSaving = true;
  try {
    saveDatabaseSync();
  } finally {
    isSaving = false;
    if (needsSave) {
      needsSave = false;
      await persistDatabase();
    }
  }
}

export function queryGet<T = Record<string, any>>(sql: string, params: SqlValue[] = []): T | null {
  const db = getDb();
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, any>;
      return row as T;
    }
    return null;
  } finally {
    stmt.free();
  }
}

export function queryAll<T = Record<string, any>>(sql: string, params: SqlValue[] = []): T[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  const rows: T[] = [];
  try {
    stmt.bind(params);
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, any>;
      rows.push(row as T);
    }
    return rows;
  } finally {
    stmt.free();
  }
}

export function queryRun(sql: string, params: SqlValue[] = []): { changes: number } {
  const db = getDb();
  db.run(sql, params);
  const changes = db.getRowsModified();
  // Only persist to disk when not in an active transaction to prevent snapshot reset
  if (transactionDepth === 0) {
    saveDatabaseSync();
  }
  return { changes };
}

let transactionDepth = 0;

export function dbTransaction<T>(callback: () => T): T {
  const db = getDb();
  const isTopLevel = transactionDepth === 0;
  transactionDepth++;
  
  if (isTopLevel) {
    db.exec('BEGIN TRANSACTION;');
  } else {
    db.exec(`SAVEPOINT sp_${transactionDepth};`);
  }

  try {
    const result = callback();
    if (isTopLevel) {
      db.exec('COMMIT;');
      saveDatabaseSync();
    } else {
      db.exec(`RELEASE SAVEPOINT sp_${transactionDepth};`);
    }
    transactionDepth--;
    return result;
  } catch (error) {
    if (isTopLevel) {
      try {
        db.exec('ROLLBACK;');
      } catch {}
    } else {
      try {
        db.exec(`ROLLBACK TO SAVEPOINT sp_${transactionDepth};`);
      } catch {}
    }
    transactionDepth--;
    throw error;
  }
}

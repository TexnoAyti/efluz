var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/server/firebase/admin.ts
import { initializeApp, getApps, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";
function loadAppletConfig() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
  }
  return {};
}
function initializeFirebaseAdmin() {
  const isRealProduction = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME !== void 0 || process.env.NODE_ENV === "production";
  if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK === "true") {
    if (isRealProduction) {
      throw new Error("FATAL_SAFETY_VIOLATION: FIREBASE_FORCE_LOCAL_FALLBACK cannot be enabled in a production environment.");
    }
    if (!cachedDb || cachedInfo?.authMode !== "local_fallback") {
      const fallbackProjectId = "test-local-fallback";
      const fallbackDatabaseId = "test-local-db";
      const memoryDb = createMemoryFirestore();
      cachedDb = memoryDb;
      cachedInfo = {
        isConfigured: true,
        projectId: fallbackProjectId,
        databaseId: fallbackDatabaseId,
        authMode: "local_fallback"
      };
      console.log(`[FIREBASE AUTH] Using forced local in-memory fallback (FIREBASE_FORCE_LOCAL_FALLBACK=true): projectId=${fallbackProjectId}, databaseId=${fallbackDatabaseId}`);
    }
    return {
      db: cachedDb,
      info: cachedInfo
    };
  }
  if (cachedInfo?.authMode === "local_fallback") {
    cachedDb = null;
    cachedInfo = null;
  }
  if (cachedDb && cachedInfo && cachedInfo.isConfigured) {
    return {
      db: cachedDb,
      info: cachedInfo
    };
  }
  const appletConfig = loadAppletConfig();
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || appletConfig.projectId || "gen-lang-client-0195097895";
  const databaseId = process.env.FIRESTORE_DATABASE_ID || process.env.FIREBASE_DATABASE_ID || appletConfig.firestoreDatabaseId || "ai-studio-efluz-4c6c88a6-697e-4fdf-82ed-45fec68ca34d";
  let serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath.trim().startsWith("{")) {
      serviceAccountJson = credPath;
    } else if (fs.existsSync(credPath)) {
      try {
        serviceAccountJson = fs.readFileSync(credPath, "utf-8");
      } catch {
      }
    }
  }
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }
  const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME !== void 0;
  let app2;
  try {
    const apps = getApps();
    if (apps.length === 0) {
      if (serviceAccountJson) {
        const parsed = typeof serviceAccountJson === "string" ? JSON.parse(serviceAccountJson) : serviceAccountJson;
        app2 = initializeApp({
          credential: cert(parsed),
          projectId: parsed.project_id || projectId
        });
      } else if (clientEmail && privateKey) {
        app2 = initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey
          }),
          projectId
        });
      } else {
        try {
          app2 = initializeApp({
            credential: applicationDefault(),
            projectId
          });
        } catch (adcErr) {
          if (isProduction) {
            console.error("[CRITICAL] Production Firebase initialization failed. Service account credentials required.", adcErr);
            initError = adcErr.message || "Missing Firebase credentials in production";
            cachedInfo = {
              isConfigured: false,
              projectId,
              databaseId,
              authMode: "not_configured",
              error: initError
            };
            return {
              db: null,
              info: cachedInfo
            };
          }
          const memoryDb = createMemoryFirestore();
          cachedDb = memoryDb;
          cachedInfo = {
            isConfigured: true,
            projectId,
            databaseId,
            authMode: "local_fallback"
          };
          return {
            db: cachedDb,
            info: cachedInfo
          };
        }
      }
    } else {
      app2 = apps[0];
    }
    cachedDb = databaseId && databaseId !== "(default)" ? getFirestore(app2, databaseId) : getFirestore(app2);
    try {
      cachedDb.settings({ ignoreUndefinedProperties: true });
    } catch {
    }
    initError = null;
    cachedInfo = {
      isConfigured: true,
      projectId,
      databaseId,
      authMode: serviceAccountJson || clientEmail && privateKey ? "credentials" : "application_default"
    };
    console.log(`[FIREBASE AUTH] Initialized Firebase Admin successfully: projectId=${projectId}, databaseId=${databaseId}, authMode=${cachedInfo.authMode}`);
    return {
      db: cachedDb,
      info: cachedInfo
    };
  } catch (err) {
    initError = err.message || "Firebase Admin initialization failed";
    if (isProduction) {
      console.error("[CRITICAL] Firebase Admin production initialization failed:", err);
      cachedInfo = {
        isConfigured: false,
        projectId,
        databaseId,
        authMode: "not_configured",
        error: initError
      };
      return {
        db: null,
        info: cachedInfo
      };
    }
    const memoryDb = createMemoryFirestore();
    cachedDb = memoryDb;
    cachedInfo = {
      isConfigured: true,
      projectId,
      databaseId,
      authMode: "local_fallback",
      error: initError
    };
    return {
      db: cachedDb,
      info: cachedInfo
    };
  }
}
function getFirestoreDb() {
  const { db, info } = initializeFirebaseAdmin();
  if (!db) {
    throw new Error(
      `Firestore is not initialized. Please ensure Firebase environment variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) are configured. Details: ${info.error || "Unknown error"}`
    );
  }
  return db;
}
function getFirebaseStatus() {
  const { info } = initializeFirebaseAdmin();
  return info;
}
function createMemoryFirestore() {
  const store = {};
  let txQueue = Promise.resolve();
  function getCol(colName) {
    if (!store[colName]) store[colName] = {};
    return store[colName];
  }
  class MemDocRef {
    constructor(colName, docId) {
      this.colName = colName;
      this.docId = docId;
    }
    get id() {
      return this.docId;
    }
    async get() {
      const col = getCol(this.colName);
      const data = col[this.docId];
      return {
        id: this.docId,
        exists: data !== void 0,
        data: () => data !== void 0 ? JSON.parse(JSON.stringify(data)) : void 0
      };
    }
    async set(data, options) {
      const col = getCol(this.colName);
      if (options?.merge && col[this.docId]) {
        col[this.docId] = { ...col[this.docId], ...data };
      } else {
        col[this.docId] = JSON.parse(JSON.stringify(data));
      }
    }
    async update(data) {
      const col = getCol(this.colName);
      if (!col[this.docId]) {
        throw new Error(`NOT_FOUND: No document to update: ${this.colName}/${this.docId}`);
      }
      col[this.docId] = { ...col[this.docId], ...data };
    }
    async delete() {
      const col = getCol(this.colName);
      delete col[this.docId];
    }
  }
  class MemQuery {
    constructor(colName) {
      this.colName = colName;
      this.filters = [];
      this.orderBys = [];
      this.limitVal = null;
      this.cursorVal = null;
    }
    where(field, op, val) {
      const q = new MemQuery(this.colName);
      q.filters = [...this.filters, { field, op, val }];
      q.orderBys = [...this.orderBys];
      q.limitVal = this.limitVal;
      q.cursorVal = this.cursorVal;
      return q;
    }
    orderBy(field, dir = "asc") {
      const q = new MemQuery(this.colName);
      q.filters = [...this.filters];
      q.orderBys = [...this.orderBys, { field, dir }];
      q.limitVal = this.limitVal;
      q.cursorVal = this.cursorVal;
      return q;
    }
    startAfter(cursor) {
      const q = new MemQuery(this.colName);
      q.filters = [...this.filters];
      q.orderBys = [...this.orderBys];
      q.limitVal = this.limitVal;
      q.cursorVal = cursor;
      return q;
    }
    limit(n) {
      const q = new MemQuery(this.colName);
      q.filters = [...this.filters];
      q.orderBys = [...this.orderBys];
      q.limitVal = n;
      q.cursorVal = this.cursorVal;
      return q;
    }
    count() {
      return {
        get: async () => {
          const res = await this.get();
          return {
            data: () => ({ count: res.size })
          };
        }
      };
    }
    async get() {
      const col = getCol(this.colName);
      let docs = Object.entries(col).map(([id, data]) => ({
        id,
        ref: new MemDocRef(this.colName, id),
        exists: true,
        data: () => JSON.parse(JSON.stringify(data))
      }));
      for (const f of this.filters) {
        docs = docs.filter((d) => {
          const val = d.data()[f.field];
          if (f.op === "==" || f.op === "===") return val === f.val;
          if (f.op === "!=") return val !== f.val;
          if (f.op === ">") return val > f.val;
          if (f.op === ">=") return val >= f.val;
          if (f.op === "<") return val < f.val;
          if (f.op === "<=") return val <= f.val;
          if (f.op === "in") return Array.isArray(f.val) && f.val.includes(val);
          return true;
        });
      }
      for (const o of this.orderBys) {
        docs.sort((a, b) => {
          const isDocIdField = o.field === "__name__" || typeof o.field === "object" && o.field !== null || String(o.field).includes("documentId");
          const vA = isDocIdField ? a.id : a.data()[o.field];
          const vB = isDocIdField ? b.id : b.data()[o.field];
          if (vA < vB) return o.dir === "asc" ? -1 : 1;
          if (vA > vB) return o.dir === "asc" ? 1 : -1;
          return 0;
        });
      }
      if (this.cursorVal) {
        const idx = docs.findIndex((d) => d.id === this.cursorVal);
        if (idx !== -1) {
          docs = docs.slice(idx + 1);
        }
      }
      if (this.limitVal !== null) {
        docs = docs.slice(0, this.limitVal);
      }
      return {
        docs,
        size: docs.length,
        empty: docs.length === 0
      };
    }
  }
  class MemCollectionRef extends MemQuery {
    doc(id) {
      const docId = id || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      return new MemDocRef(this.colName, docId);
    }
    async add(data) {
      const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const docRef = new MemDocRef(this.colName, docId);
      await docRef.set(data);
      return docRef;
    }
  }
  class MemBatch {
    constructor() {
      this.operations = [];
    }
    create(docRef, data) {
      this.operations.push(async () => {
        if ((await docRef.get()).exists) throw new Error("ALREADY_EXISTS");
        await docRef.set(data);
      });
      return this;
    }
    set(docRef, data, options) {
      this.operations.push(() => docRef.set(data, options));
      return this;
    }
    update(docRef, data) {
      this.operations.push(() => docRef.update(data));
      return this;
    }
    delete(docRef) {
      this.operations.push(() => docRef.delete());
      return this;
    }
    async commit() {
      const commit = txQueue.then(async () => {
        const backup = JSON.parse(JSON.stringify(store));
        try {
          for (const op of this.operations) await op();
        } catch (error) {
          for (const key of Object.keys(store)) delete store[key];
          Object.assign(store, backup);
          throw error;
        }
      });
      txQueue = commit.catch(() => {
      });
      await commit;
    }
  }
  return {
    collection(name) {
      return new MemCollectionRef(name);
    },
    batch() {
      return new MemBatch();
    },
    async runTransaction(updateFunction) {
      return new Promise((resolve, reject) => {
        txQueue = txQueue.then(async () => {
          try {
            const writes = [];
            const tx = {
              async get(docRef) {
                return await docRef.get();
              },
              set(docRef, data, options) {
                writes.push(async () => {
                  await docRef.set(data, options);
                });
                return tx;
              },
              update(docRef, data) {
                writes.push(async () => {
                  await docRef.update(data);
                });
                return tx;
              },
              delete(docRef) {
                writes.push(async () => {
                  await docRef.delete();
                });
                return tx;
              }
            };
            const result = await updateFunction(tx);
            for (const write of writes) {
              await write();
            }
            resolve(result);
          } catch (err) {
            reject(err);
          }
        });
      });
    },
    async listCollections() {
      return Object.keys(store).map((name) => new MemCollectionRef(name));
    }
  };
}
var cachedDb, cachedInfo, initError;
var init_admin = __esm({
  "src/server/firebase/admin.ts"() {
    cachedDb = null;
    cachedInfo = null;
    initError = null;
  }
});

// src/server/firebase/collections.ts
var COLLECTIONS;
var init_collections = __esm({
  "src/server/firebase/collections.ts"() {
    COLLECTIONS = {
      USERS: "users",
      SEASONS: "seasons",
      LEAGUES: "leagues",
      CLUBS: "clubs",
      SEASON_LEAGUE_CLUBS: "season_league_clubs",
      CLUB_MEMBERSHIPS: "club_memberships",
      CLUB_OCCUPANCIES: "club_occupancies",
      USER_MEMBERSHIPS: "user_memberships",
      COMPETITIONS: "competitions",
      COMPETITION_PARTICIPANTS: "competition_participants",
      FIXTURES: "fixtures",
      RESULT_SUBMISSIONS: "result_submissions",
      DISPUTES: "disputes",
      STANDINGS: "standings",
      NOTIFICATIONS: "notifications",
      AUDIT_LOGS: "audit_logs",
      MATCHDAY_LOCKS: "matchday_locks"
    };
  }
});

// src/server/db/migrateFixtures.ts
function migrateFixturesTableIfNeeded(db) {
  const ddl = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='fixtures'")[0]?.values[0]?.[0];
  if (!ddl) return { migrated: false, recordsPreserved: 0, reason: "fixtures table does not exist" };
  const columns = db.exec("PRAGMA table_xinfo(fixtures)")[0].values;
  const names = columns.map((c) => String(c[1]));
  const metadata = ["source_fixture_id", "source_winner_slot", "home_source_fixture_id", "away_source_fixture_id", "home_source_winner_slot", "away_source_winner_slot"];
  const missing = metadata.filter((name) => !names.includes(name));
  const needsNullable = columns.some((c) => ["home_club_id", "away_club_id"].includes(String(c[1])) && Number(c[3]) === 1);
  const scalar = (sql) => Number(db.exec(sql)[0]?.values[0]?.[0] || 0);
  const dirty = scalar("SELECT count(*) FROM fixtures WHERE home_club_id IN ('TBD','') OR away_club_id IN ('TBD','')");
  if (!needsNullable && !missing.length && !dirty) return { migrated: false, recordsPreserved: 0, reason: "already up-to-date" };
  const count = scalar("SELECT count(*) FROM fixtures");
  const fk = scalar("PRAGMA foreign_keys");
  const quote = (name) => '"' + name.replace(/"/g, '""') + '"';
  const schemaObjects = db.exec("SELECT sql FROM sqlite_master WHERE tbl_name='fixtures' AND type IN ('index','trigger') AND sql IS NOT NULL")[0]?.values || [];
  const originalViolations = JSON.stringify(db.exec("PRAGMA foreign_key_check"));
  let transaction = false;
  try {
    db.run("PRAGMA foreign_keys=OFF");
    db.run("BEGIN IMMEDIATE");
    transaction = true;
    if (needsNullable) {
      let replacement = String(ddl).replace(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"fixtures"|`fixtures`|\[fixtures\]|fixtures)/i, "CREATE TABLE fixtures_migration_temp");
      for (const name of ["home_club_id", "away_club_id"]) {
        const pattern = new RegExp('((?:"' + name + '"|`' + name + "`|\\[" + name + "\\]|\\b" + name + "\\b)[^,]*?)\\s+NOT\\s+NULL(?:\\s+ON\\s+CONFLICT\\s+\\w+)?", "i");
        replacement = replacement.replace(pattern, "$1");
      }
      if (replacement === String(ddl)) throw new Error("Unrecognized fixtures schema");
      db.run(replacement);
      const tempCols = db.exec("PRAGMA table_xinfo(fixtures_migration_temp)")[0].values;
      if (tempCols.some((c) => ["home_club_id", "away_club_id"].includes(String(c[1])) && Number(c[3]) === 1)) throw new Error("Nullable migration could not preserve schema");
      const writable = columns.filter((c) => Number(c[6]) === 0).map((c) => String(c[1]));
      const projection = writable.map((name) => ["home_club_id", "away_club_id"].includes(name) ? `CASE WHEN ${quote(name)} IN ('TBD','') THEN NULL ELSE ${quote(name)} END` : quote(name)).join(",");
      const fields = writable.map(quote).join(",");
      db.run(`INSERT INTO fixtures_migration_temp (${fields}) SELECT ${projection} FROM fixtures`);
      if (scalar("SELECT count(*) FROM fixtures_migration_temp") !== count || db.exec(`SELECT ${projection} FROM fixtures EXCEPT SELECT ${fields} FROM fixtures_migration_temp`).length) throw new Error("Fixture data preservation check failed");
      db.run("DROP TABLE fixtures");
      db.run("ALTER TABLE fixtures_migration_temp RENAME TO fixtures");
      for (const [sql] of schemaObjects) db.run(String(sql));
    } else if (dirty) {
      db.run("UPDATE fixtures SET home_club_id = CASE WHEN home_club_id IN ('TBD','') THEN NULL ELSE home_club_id END, away_club_id = CASE WHEN away_club_id IN ('TBD','') THEN NULL ELSE away_club_id END WHERE home_club_id IN ('TBD','') OR away_club_id IN ('TBD','')");
    }
    for (const name of missing) db.run(`ALTER TABLE fixtures ADD COLUMN ${quote(name)} TEXT`);
    if (JSON.stringify(db.exec("PRAGMA foreign_key_check")) !== originalViolations) throw new Error("Migration changed foreign key integrity");
    db.run("COMMIT");
    transaction = false;
    return { migrated: true, recordsPreserved: count };
  } catch (error) {
    if (transaction) db.run("ROLLBACK");
    throw error;
  } finally {
    db.run(`PRAGMA foreign_keys=${fk}`);
  }
}
var init_migrateFixtures = __esm({
  "src/server/db/migrateFixtures.ts"() {
  }
});

// src/server/db/index.ts
import fs2 from "fs";
import path2 from "path";
import { fileURLToPath } from "url";
import initSqlJs from "sql.js";
function getModuleDir() {
  try {
    if (typeof __dirname !== "undefined" && __dirname) {
      return __dirname;
    }
  } catch {
  }
  try {
    if (typeof import.meta !== "undefined" && import.meta.url) {
      return path2.dirname(fileURLToPath(import.meta.url));
    }
  } catch {
  }
  return process.cwd();
}
function getDbFilePath() {
  return DB_FILE;
}
function resolveSqlWasmPath() {
  const modDir = getModuleDir();
  const candidates = [
    // 1. In node_modules (local dev, tsx, standard node environment)
    path2.resolve(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    path2.join(modDir, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    // 2. In same directory as compiled serverless handler (e.g., /var/task/api/sql-wasm.wasm)
    path2.join(modDir, "sql-wasm.wasm"),
    // 3. In api/ folder relative to project root / task root
    path2.resolve(process.cwd(), "api", "sql-wasm.wasm"),
    // 4. In parent directory (e.g. if modDir is /var/task/api, check /var/task/sql-wasm.wasm)
    path2.join(modDir, "..", "sql-wasm.wasm"),
    path2.join(modDir, "..", "api", "sql-wasm.wasm"),
    path2.resolve(process.cwd(), "sql-wasm.wasm"),
    // 5. In dist/ folder
    path2.resolve(process.cwd(), "dist", "sql-wasm.wasm"),
    path2.join(modDir, "..", "dist", "sql-wasm.wasm"),
    // 6. In public/ folder
    path2.resolve(process.cwd(), "public", "sql-wasm.wasm")
  ];
  for (const candidate of candidates) {
    try {
      if (fs2.existsSync(candidate)) {
        const stats = fs2.statSync(candidate);
        if (stats.isFile() && stats.size > 1e4) {
          return candidate;
        }
      }
    } catch {
    }
  }
  throw new Error(
    `[DB] Could not locate sql-wasm.wasm in any expected location. Checked:
` + candidates.map((c) => ` - ${c}`).join("\n")
  );
}
function isValidSqliteHeader(buffer) {
  if (!buffer || buffer.length < 100) return false;
  const headerString = buffer.subarray(0, 16).toString("utf-8");
  return headerString === "SQLite format 3\0";
}
function resolveBundledDbPath() {
  const modDir = getModuleDir();
  const candidates = [
    path2.resolve(process.cwd(), "data", "efootball.sqlite"),
    path2.join(modDir, "data", "efootball.sqlite"),
    path2.join(modDir, "..", "data", "efootball.sqlite"),
    path2.resolve(process.cwd(), "api", "data", "efootball.sqlite"),
    path2.resolve(process.cwd(), "api", "efootball.sqlite"),
    path2.join(modDir, "efootball.sqlite")
  ];
  for (const candidate of candidates) {
    try {
      if (fs2.existsSync(candidate)) {
        const stats = fs2.statSync(candidate);
        if (stats.isFile() && stats.size > 1e3) {
          const buf = fs2.readFileSync(candidate);
          if (isValidSqliteHeader(buf)) {
            return candidate;
          }
        }
      }
    } catch {
    }
  }
  return null;
}
async function initDatabase() {
  if (dbInstance) {
    return dbInstance;
  }
  try {
    if (!fs2.existsSync(DATA_DIR)) {
      fs2.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn(` [DB] Could not create DATA_DIR ${DATA_DIR}, falling back to /tmp/data:`, err);
  }
  if (IS_SERVERLESS && !fs2.existsSync(DB_FILE)) {
    const hosted = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL || process.env.K_SERVICE || process.env.AWS_LAMBDA_FUNCTION_NAME);
    const bundledDbPath = hosted ? null : resolveBundledDbPath();
    if (bundledDbPath && fs2.existsSync(bundledDbPath)) {
      try {
        fs2.copyFileSync(bundledDbPath, DB_FILE);
        console.log(` [DB] Copied bundled database from ${bundledDbPath} to serverless location: ${DB_FILE}`);
      } catch (err) {
        console.warn(" [DB] Could not copy bundled DB to serverless path:", err);
      }
    }
  }
  const wasmPath = resolveSqlWasmPath();
  let SQL;
  try {
    const wasmFileBuffer = fs2.readFileSync(wasmPath);
    const wasmBinary = new Uint8Array(wasmFileBuffer);
    SQL = await initSqlJs({
      locateFile: () => wasmPath,
      wasmBinary
    });
  } catch (err1) {
    try {
      SQL = await initSqlJs({
        locateFile: () => wasmPath
      });
    } catch (err2) {
      SQL = await initSqlJs({});
    }
  }
  if (fs2.existsSync(DB_FILE)) {
    try {
      const fileBuffer = fs2.readFileSync(DB_FILE);
      if (isValidSqliteHeader(fileBuffer)) {
        dbInstance = new SQL.Database(fileBuffer);
        dbInstance.exec("SELECT 1");
        console.log(` [DB] path=${DB_FILE}`);
        console.log(" [DB] initialized=true (loaded from disk)");
      } else {
        throw new Error("INVALID_SQLITE_FILE: existing database preserved for recovery");
      }
    } catch (err) {
      dbInstance?.close();
      dbInstance = null;
      throw err;
    }
  } else {
    const bundledDbPath = resolveBundledDbPath();
    if (bundledDbPath && fs2.existsSync(bundledDbPath)) {
      try {
        const fileBuffer = fs2.readFileSync(bundledDbPath);
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
      console.log(" [DB] initialized=true (new)");
      dbInstance = new SQL.Database();
    }
  }
  if (fs2.existsSync(SCHEMA_FILE)) {
    try {
      const schemaSql = fs2.readFileSync(SCHEMA_FILE, "utf-8");
      dbInstance.exec(schemaSql);
    } catch (err) {
      console.error(" [DB] Schema initialization failed; existing database preserved.");
      dbInstance.close();
      dbInstance = null;
      throw err;
    }
  }
  try {
    dbInstance.exec(`
      ALTER TABLE competition_participants ADD COLUMN season_id TEXT;
    `);
  } catch {
  }
  try {
    dbInstance.exec(`
      ALTER TABLE competition_participants ADD COLUMN owner_user_id TEXT;
    `);
  } catch {
  }
  try {
    dbInstance.exec(`
      ALTER TABLE competition_participants ADD COLUMN source_competition_id TEXT;
    `);
  } catch {
  }
  try {
    dbInstance.exec(`
      ALTER TABLE competition_participants ADD COLUMN source_position INTEGER;
    `);
  } catch {
  }
  try {
    dbInstance.exec(`
      ALTER TABLE competition_participants ADD COLUMN qualification_reason TEXT;
    `);
  } catch {
  }
  try {
    dbInstance.exec(`
      ALTER TABLE competition_participants ADD COLUMN qualification_timestamp TEXT;
    `);
  } catch {
  }
  try {
    migrateFixturesTableIfNeeded(dbInstance);
  } catch (migErr) {
    console.error(" [DB] Error during fixtures table migration:", migErr);
    dbInstance.close();
    dbInstance = null;
    throw migErr;
  }
  try {
    dbInstance.exec(`
      ALTER TABLE fixtures ADD COLUMN fixture_source TEXT DEFAULT 'official_2026_27';
    `);
  } catch {
  }
  try {
    dbInstance.exec(`
      ALTER TABLE fixtures ADD COLUMN source_fixture_id TEXT;
    `);
  } catch {
  }
  try {
    dbInstance.exec(`
      ALTER TABLE fixtures ADD COLUMN source_winner_slot TEXT;
    `);
  } catch {
  }
  try {
    dbInstance.exec(`
      ALTER TABLE club_memberships ADD COLUMN updated_at TEXT;
    `);
  } catch {
  }
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
  } catch {
  }
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
  } catch {
  }
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
  } catch {
  }
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
  } catch {
  }
  saveDatabaseSync();
  return dbInstance;
}
function getDb() {
  if (!dbInstance) {
    throw new Error("Database is not initialized. Call initDatabase() first.");
  }
  return dbInstance;
}
function saveDatabaseSync() {
  if (!dbInstance) return;
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    const targetDir = path2.dirname(DB_FILE);
    if (!fs2.existsSync(targetDir)) {
      fs2.mkdirSync(targetDir, { recursive: true });
    }
    const tempFile = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs2.writeFileSync(tempFile, buffer);
    fs2.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error(" [DB] Error saving SQLite database to disk:", err);
  }
}
function queryGet(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      return row;
    }
    return null;
  } finally {
    stmt.free();
  }
}
function queryAll(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push(row);
    }
    return rows;
  } finally {
    stmt.free();
  }
}
function queryRun(sql, params = []) {
  const db = getDb();
  db.run(sql, params);
  const changes = db.getRowsModified();
  if (transactionDepth === 0) {
    saveDatabaseSync();
  }
  return { changes };
}
function dbTransaction(callback) {
  const db = getDb();
  const isTopLevel = transactionDepth === 0;
  transactionDepth++;
  if (isTopLevel) {
    db.exec("BEGIN TRANSACTION;");
  } else {
    db.exec(`SAVEPOINT sp_${transactionDepth};`);
  }
  try {
    const result = callback();
    if (isTopLevel) {
      db.exec("COMMIT;");
      saveDatabaseSync();
    } else {
      db.exec(`RELEASE SAVEPOINT sp_${transactionDepth};`);
    }
    transactionDepth--;
    return result;
  } catch (error) {
    if (isTopLevel) {
      try {
        db.exec("ROLLBACK;");
      } catch {
      }
    } else {
      try {
        db.exec(`ROLLBACK TO SAVEPOINT sp_${transactionDepth};`);
      } catch {
      }
    }
    transactionDepth--;
    throw error;
  }
}
var dbInstance, IS_SERVERLESS, DEFAULT_DATA_DIR, DATA_DIR, DB_FILE, SCHEMA_FILE, transactionDepth;
var init_db = __esm({
  "src/server/db/index.ts"() {
    init_migrateFixtures();
    init_migrateFixtures();
    dbInstance = null;
    IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
    DEFAULT_DATA_DIR = IS_SERVERLESS ? "/tmp/data" : path2.resolve(process.cwd(), "data");
    DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
    DB_FILE = process.env.DB_FILE || path2.join(DATA_DIR, "efootball.sqlite");
    SCHEMA_FILE = path2.resolve(process.cwd(), "src", "server", "db", "schema.sql");
    transactionDepth = 0;
  }
});

// src/server/db/seed.ts
function seedDatabase() {
  return dbTransaction(() => {
    let seasonsCreated = 0;
    let leaguesCreated = 0;
    let clubsCreated = 0;
    let competitionsCreated = 0;
    let skipped = 0;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existingSeason = queryGet("SELECT id FROM seasons WHERE id = ?", [SEED_SEASON.id]);
    if (!existingSeason) {
      queryRun(
        "INSERT INTO seasons (id, name, status, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [SEED_SEASON.id, SEED_SEASON.name, SEED_SEASON.status, SEED_SEASON.startDate, SEED_SEASON.endDate, now]
      );
      seasonsCreated++;
    } else {
      queryRun(
        "UPDATE seasons SET name = ?, status = ?, start_date = ?, end_date = ? WHERE id = ?",
        [SEED_SEASON.name, SEED_SEASON.status, SEED_SEASON.startDate, SEED_SEASON.endDate, SEED_SEASON.id]
      );
    }
    for (const league of SEED_LEAGUES) {
      const existingLeague = queryGet("SELECT id FROM leagues WHERE id = ?", [league.id]);
      if (!existingLeague) {
        queryRun(
          "INSERT INTO leagues (id, name, country, tier, logo_url, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          [league.id, league.name, league.country, league.tier, league.logoUrl, now]
        );
        leaguesCreated++;
      } else {
        skipped++;
      }
    }
    const activeClubIds = new Set(SEED_CLUBS.map((c) => c.id));
    for (const club of SEED_CLUBS) {
      const existingClub = queryGet("SELECT id FROM clubs WHERE id = ?", [club.id]);
      if (!existingClub) {
        queryRun(
          "INSERT INTO clubs (id, name, short_name, country, league_id, logo_url, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
          [club.id, club.name, club.shortName, club.country, club.leagueId, club.logoUrl, now]
        );
        clubsCreated++;
      } else {
        queryRun(
          "UPDATE clubs SET name = ?, short_name = ?, country = ?, league_id = ?, logo_url = ?, active = 1 WHERE id = ?",
          [club.name, club.shortName, club.country, club.leagueId, club.logoUrl, club.id]
        );
      }
      const slcId = `slc-${SEED_SEASON.id}-${club.id}`;
      queryRun(
        `INSERT INTO season_league_clubs (id, season_id, league_id, club_id, is_active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(season_id, club_id) DO UPDATE SET league_id = excluded.league_id, is_active = 1`,
        [slcId, SEED_SEASON.id, club.leagueId, club.id, now]
      );
    }
    const allDbClubs = queryAll("SELECT id FROM clubs");
    for (const c of allDbClubs) {
      if (!activeClubIds.has(c.id)) {
        queryRun("UPDATE clubs SET active = 0 WHERE id = ?", [c.id]);
        queryRun(
          "UPDATE season_league_clubs SET is_active = 0 WHERE club_id = ? AND season_id = ?",
          [c.id, SEED_SEASON.id]
        );
        queryRun(
          "DELETE FROM competition_participants WHERE club_id = ? AND season_id = ?",
          [c.id, SEED_SEASON.id]
        );
      }
    }
    for (const comp of SEED_COMPETITIONS) {
      const existingComp = queryGet("SELECT id FROM competitions WHERE id = ?", [comp.id]);
      if (!existingComp) {
        queryRun(
          'INSERT INTO competitions (id, season_id, league_id, name, type, schedule_mode, status, format_config_json, created_at) VALUES (?, ?, ?, ?, ?, ?, "upcoming", ?, ?)',
          [
            comp.id,
            comp.seasonId,
            comp.leagueId || null,
            comp.name,
            comp.type,
            comp.scheduleMode,
            JSON.stringify(comp.formatConfig),
            now
          ]
        );
        competitionsCreated++;
      } else {
        queryRun(
          "UPDATE competitions SET schedule_mode = ?, format_config_json = ? WHERE id = ?",
          [comp.scheduleMode, JSON.stringify(comp.formatConfig), comp.id]
        );
        skipped++;
      }
      if ((comp.type === "LEAGUE" || comp.type === "KNOCKOUT") && comp.leagueId) {
        queryRun(
          `DELETE FROM competition_participants 
           WHERE competition_id = ? AND club_id NOT IN (
             SELECT club_id FROM season_league_clubs WHERE league_id = ? AND season_id = ? AND is_active = 1
           )`,
          [comp.id, comp.leagueId, comp.seasonId]
        );
        const leagueClubs = queryAll(
          `SELECT slc.club_id 
           FROM season_league_clubs slc 
           JOIN clubs c ON slc.club_id = c.id
           WHERE slc.league_id = ? AND slc.season_id = ? AND slc.is_active = 1 
           ORDER BY c.name ASC`,
          [comp.leagueId, comp.seasonId]
        );
        for (let i = 0; i < leagueClubs.length; i++) {
          const clubId = leagueClubs[i].club_id;
          const partId = `part-${comp.id}-${clubId}`;
          queryRun(
            `INSERT INTO competition_participants (id, competition_id, club_id, season_id, seed_number, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(competition_id, club_id) DO UPDATE SET seed_number = excluded.seed_number`,
            [partId, comp.id, clubId, comp.seasonId, i + 1, now]
          );
        }
      }
    }
    console.log(
      ` [SEED] Done: Created ${seasonsCreated} season, ${leaguesCreated} leagues, ${clubsCreated} clubs, ${competitionsCreated} competitions. Skipped ${skipped} existing records.`
    );
    return { seasonsCreated, leaguesCreated, clubsCreated, competitionsCreated, skipped };
  });
}
function repairSeason202627Roster() {
  return dbTransaction(() => {
    const seasonId = "season-2026-27";
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const activeClubIds = new Set(SEED_CLUBS.map((c) => c.id));
    for (const league of SEED_LEAGUES) {
      const existing = queryGet("SELECT id FROM leagues WHERE id = ?", [league.id]);
      if (!existing) {
        queryRun(
          "INSERT INTO leagues (id, name, country, tier, logo_url, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          [league.id, league.name, league.country, league.tier, league.logoUrl, now]
        );
      } else {
        queryRun(
          "UPDATE leagues SET name = ?, country = ?, tier = ?, logo_url = ? WHERE id = ?",
          [league.name, league.country, league.tier, league.logoUrl, league.id]
        );
      }
    }
    let activatedClubs = 0;
    for (const club of SEED_CLUBS) {
      const existing = queryGet("SELECT id FROM clubs WHERE id = ?", [club.id]);
      if (!existing) {
        queryRun(
          "INSERT INTO clubs (id, name, short_name, country, league_id, logo_url, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
          [club.id, club.name, club.shortName, club.country, club.leagueId, club.logoUrl, now]
        );
      } else {
        queryRun(
          "UPDATE clubs SET name = ?, short_name = ?, country = ?, league_id = ?, logo_url = ?, active = 1 WHERE id = ?",
          [club.name, club.shortName, club.country, club.leagueId, club.logoUrl, club.id]
        );
      }
      const slcId = `slc-${seasonId}-${club.id}`;
      queryRun(
        `INSERT INTO season_league_clubs (id, season_id, league_id, club_id, is_active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(season_id, club_id) DO UPDATE SET league_id = excluded.league_id, is_active = 1`,
        [slcId, seasonId, club.leagueId, club.id, now]
      );
      activatedClubs++;
    }
    let deactivatedClubs = 0;
    const allDbClubs = queryAll("SELECT id FROM clubs");
    for (const c of allDbClubs) {
      if (!activeClubIds.has(c.id)) {
        queryRun("UPDATE clubs SET active = 0 WHERE id = ?", [c.id]);
        queryRun(
          "UPDATE season_league_clubs SET is_active = 0 WHERE club_id = ? AND season_id = ?",
          [c.id, seasonId]
        );
        queryRun(
          "DELETE FROM competition_participants WHERE club_id = ? AND season_id = ?",
          [c.id, seasonId]
        );
        deactivatedClubs++;
      }
    }
    for (const comp of SEED_COMPETITIONS) {
      if ((comp.type === "LEAGUE" || comp.type === "KNOCKOUT") && comp.leagueId) {
        queryRun(
          `DELETE FROM competition_participants 
           WHERE competition_id = ? AND club_id NOT IN (
             SELECT club_id FROM season_league_clubs WHERE league_id = ? AND season_id = ? AND is_active = 1
           )`,
          [comp.id, comp.leagueId, comp.seasonId]
        );
        const leagueClubs = queryAll(
          `SELECT slc.club_id 
           FROM season_league_clubs slc 
           JOIN clubs c ON slc.club_id = c.id
           WHERE slc.league_id = ? AND slc.season_id = ? AND slc.is_active = 1 
           ORDER BY c.name ASC`,
          [comp.leagueId, comp.seasonId]
        );
        for (let i = 0; i < leagueClubs.length; i++) {
          const clubId = leagueClubs[i].club_id;
          const partId = `part-${comp.id}-${clubId}`;
          queryRun(
            `INSERT INTO competition_participants (id, competition_id, club_id, season_id, seed_number, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(competition_id, club_id) DO UPDATE SET seed_number = excluded.seed_number`,
            [partId, comp.id, clubId, comp.seasonId, i + 1, now]
          );
        }
      }
    }
    const invalidFixtures = queryAll(
      `SELECT id, competition_id FROM fixtures 
       WHERE season_id = ? AND (
         home_club_id NOT IN (SELECT club_id FROM season_league_clubs WHERE season_id = ? AND is_active = 1)
         OR away_club_id NOT IN (SELECT club_id FROM season_league_clubs WHERE season_id = ? AND is_active = 1)
       )`,
      [seasonId, seasonId, seasonId]
    );
    if (invalidFixtures.length > 0) {
      console.log(` [REPAIR] Found ${invalidFixtures.length} invalid fixtures with inactive clubs. Purging and regenerating domestic schedules...`);
      const compsToReset = new Set(invalidFixtures.map((f) => f.competition_id));
      for (const compId of compsToReset) {
        queryRun("DELETE FROM result_submissions WHERE fixture_id IN (SELECT id FROM fixtures WHERE competition_id = ?)", [compId]);
        queryRun("DELETE FROM fixtures WHERE competition_id = ?", [compId]);
      }
    }
    const validCompIds = new Set(SEED_COMPETITIONS.map((c) => c.id));
    const allDbComps = queryAll("SELECT id FROM competitions WHERE season_id = ?", [seasonId]);
    for (const dbComp of allDbComps) {
      if (!validCompIds.has(dbComp.id)) {
        console.log(` [REPAIR] Purging obsolete competition: ${dbComp.id}`);
        queryRun("DELETE FROM result_submissions WHERE fixture_id IN (SELECT id FROM fixtures WHERE competition_id = ?)", [dbComp.id]);
        queryRun("DELETE FROM fixtures WHERE competition_id = ?", [dbComp.id]);
        queryRun("DELETE FROM competition_participants WHERE competition_id = ?", [dbComp.id]);
        queryRun("DELETE FROM competitions WHERE id = ?", [dbComp.id]);
      }
    }
    console.log(
      ` [REPAIR] 2026/27 Roster repaired: ${activatedClubs} clubs activated, ${deactivatedClubs} stale clubs deactivated.`
    );
    return { activatedClubs, deactivatedClubs, totalActive: activatedClubs };
  });
}
var SEED_SEASON, SEED_SEASONS, SEED_LEAGUES, SEED_CLUBS, SEED_COMPETITIONS;
var init_seed = __esm({
  "src/server/db/seed.ts"() {
    init_db();
    SEED_SEASON = {
      id: "season-2026-27",
      name: "2026/27 Season",
      status: "active",
      startDate: "2026-08-15",
      endDate: "2027-05-30"
    };
    SEED_SEASONS = [
      SEED_SEASON
    ];
    SEED_LEAGUES = [
      {
        id: "league-premier-league",
        name: "Premier League",
        country: "England",
        tier: 1,
        logoUrl: "https://crests.football-data.org/PL.png"
      },
      {
        id: "league-la-liga",
        name: "La Liga",
        country: "Spain",
        tier: 1,
        logoUrl: "https://crests.football-data.org/PD.png"
      },
      {
        id: "league-serie-a",
        name: "Serie A",
        country: "Italy",
        tier: 1,
        logoUrl: "https://crests.football-data.org/SA.png"
      },
      {
        id: "league-bundesliga",
        name: "Bundesliga",
        country: "Germany",
        tier: 1,
        logoUrl: "https://crests.football-data.org/BL1.png"
      },
      {
        id: "league-ligue-1",
        name: "Ligue 1",
        country: "France",
        tier: 1,
        logoUrl: "https://crests.football-data.org/FL1.png"
      }
    ];
    SEED_CLUBS = [
      // --- PREMIER LEAGUE (20 CLUBS - 2026/27) ---
      { id: "club-arsenal", name: "Arsenal", shortName: "ARS", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t3.svg" },
      { id: "club-aston-villa", name: "Aston Villa", shortName: "AVL", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t7.svg" },
      { id: "club-bournemouth", name: "AFC Bournemouth", shortName: "BOU", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t91.svg" },
      { id: "club-brentford", name: "Brentford", shortName: "BRE", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t94.svg" },
      { id: "club-brighton", name: "Brighton & Hove Albion", shortName: "BHA", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t36.svg" },
      { id: "club-chelsea", name: "Chelsea", shortName: "CHE", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t8.svg" },
      { id: "club-coventry", name: "Coventry City", shortName: "COV", country: "England", leagueId: "league-premier-league", logoUrl: "https://crests.football-data.org/1076.png" },
      { id: "club-crystal-palace", name: "Crystal Palace", shortName: "CRY", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t31.svg" },
      { id: "club-everton", name: "Everton", shortName: "EVE", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t11.svg" },
      { id: "club-fulham", name: "Fulham", shortName: "FUL", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t54.svg" },
      { id: "club-hull", name: "Hull City", shortName: "HUL", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t88.svg" },
      { id: "club-ipswich", name: "Ipswich Town", shortName: "IPS", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t40.svg" },
      { id: "club-leeds", name: "Leeds United", shortName: "LEE", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t2.svg" },
      { id: "club-liverpool", name: "Liverpool", shortName: "LIV", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t14.svg" },
      { id: "club-man-city", name: "Manchester City", shortName: "MCI", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t43.svg" },
      { id: "club-man-utd", name: "Manchester United", shortName: "MUN", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t1.svg" },
      { id: "club-newcastle", name: "Newcastle United", shortName: "NEW", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t4.svg" },
      { id: "club-nottm-forest", name: "Nottingham Forest", shortName: "NFO", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t17.svg" },
      { id: "club-sunderland", name: "Sunderland", shortName: "SUN", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t56.svg" },
      { id: "club-tottenham", name: "Tottenham Hotspur", shortName: "TOT", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t6.svg" },
      // --- LA LIGA (20 CLUBS - 2026/27) ---
      { id: "club-alaves", name: "Deportivo Alav\xE9s", shortName: "ALA", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/263.png" },
      { id: "club-athletic-club", name: "Athletic Club", shortName: "ATH", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/77.png" },
      { id: "club-atletico-madrid", name: "Atl\xE9tico de Madrid", shortName: "ATM", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/78.png" },
      { id: "club-barcelona", name: "FC Barcelona", shortName: "BAR", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/81.png" },
      { id: "club-celta-vigo", name: "RC Celta", shortName: "CEL", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/558.png" },
      { id: "club-deportivo-la-coruna", name: "Deportivo La Coru\xF1a", shortName: "DEP", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/560.png" },
      { id: "club-getafe", name: "Getafe CF", shortName: "GET", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/82.png" },
      { id: "club-girona", name: "Girona FC", shortName: "GIR", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/298.png" },
      { id: "club-las-palmas", name: "UD Las Palmas", shortName: "LPA", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/275.png" },
      { id: "club-malaga", name: "M\xE1laga CF", shortName: "MCF", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/84.png" },
      { id: "club-mallorca", name: "RCD Mallorca", shortName: "MLL", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/89.png" },
      { id: "club-osasuna", name: "CA Osasuna", shortName: "OSA", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/79.png" },
      { id: "club-racing-santander", name: "Racing Santander", shortName: "RAC", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/742.png" },
      { id: "club-rayo-vallecano", name: "Rayo Vallecano", shortName: "RAY", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/87.png" },
      { id: "club-real-betis", name: "Real Betis", shortName: "BET", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/90.png" },
      { id: "club-real-madrid", name: "Real Madrid", shortName: "RMA", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/86.png" },
      { id: "club-real-sociedad", name: "Real Sociedad", shortName: "RSO", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/92.png" },
      { id: "club-sevilla", name: "Sevilla FC", shortName: "SEV", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/559.png" },
      { id: "club-valencia", name: "Valencia CF", shortName: "VAL", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/95.png" },
      { id: "club-villarreal", name: "Villarreal CF", shortName: "VIL", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://crests.football-data.org/94.png" },
      // --- SERIE A (20 CLUBS - 2026/27) ---
      { id: "club-atalanta", name: "Atalanta", shortName: "ATA", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/102.png" },
      { id: "club-bologna", name: "Bologna FC", shortName: "BOL", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/103.png" },
      { id: "club-cagliari", name: "Cagliari Calcio", shortName: "CAG", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/104.png" },
      { id: "club-empoli", name: "Empoli FC", shortName: "EMP", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/445.png" },
      { id: "club-fiorentina", name: "ACF Fiorentina", shortName: "FIO", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/99.png" },
      { id: "club-frosinone", name: "Frosinone", shortName: "FRO", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/470.png" },
      { id: "club-genoa", name: "Genoa CFC", shortName: "GEN", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/107.png" },
      { id: "club-inter", name: "Inter Milan", shortName: "INT", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/108.png" },
      { id: "club-juventus", name: "Juventus", shortName: "JUV", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/109.png" },
      { id: "club-lazio", name: "SS Lazio", shortName: "LAZ", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/110.png" },
      { id: "club-lecce", name: "US Lecce", shortName: "LEC", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/5890.png" },
      { id: "club-milan", name: "AC Milan", shortName: "MIL", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/98.png" },
      { id: "club-monza", name: "Monza", shortName: "MON", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/5911.png" },
      { id: "club-napoli", name: "SSC Napoli", shortName: "NAP", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/113.png" },
      { id: "club-parma", name: "Parma Calcio", shortName: "PAR", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/112.png" },
      { id: "club-roma", name: "AS Roma", shortName: "ROM", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/100.png" },
      { id: "club-torino", name: "Torino FC", shortName: "TOR", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/586.png" },
      { id: "club-udinese", name: "Udinese Calcio", shortName: "UDI", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/115.png" },
      { id: "club-venezia", name: "Venezia", shortName: "VEN", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/454.png" },
      { id: "club-verona", name: "Hellas Verona", shortName: "VER", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://crests.football-data.org/450.png" },
      // --- BUNDESLIGA (18 CLUBS - 2026/27) ---
      { id: "club-augsburg", name: "FC Augsburg", shortName: "FCA", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/16.png" },
      { id: "club-bayern", name: "FC Bayern M\xFCnchen", shortName: "FCB", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/5.png" },
      { id: "club-bochum", name: "VfL Bochum", shortName: "BOC", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/36.png" },
      { id: "club-dortmund", name: "Borussia Dortmund", shortName: "BVB", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/4.png" },
      { id: "club-eintracht-frankfurt", name: "Eintracht Frankfurt", shortName: "SGE", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/19.png" },
      { id: "club-freiburg", name: "SC Freiburg", shortName: "SCF", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/17.png" },
      { id: "club-gladbach", name: "Borussia M\xF6nchengladbach", shortName: "BMG", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/18.png" },
      { id: "club-heidenheim", name: "1. FC Heidenheim", shortName: "HDH", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/44.png" },
      { id: "club-hoffenheim", name: "TSG Hoffenheim", shortName: "TSG", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/2.png" },
      { id: "club-holstein-kiel", name: "Holstein Kiel", shortName: "KSV", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/720.png" },
      { id: "club-leipzig", name: "RB Leipzig", shortName: "RBL", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/721.png" },
      { id: "club-leverkusen", name: "Bayer 04 Leverkusen", shortName: "B04", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/3.png" },
      { id: "club-mainz", name: "1. FSV Mainz 05", shortName: "M05", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/15.png" },
      { id: "club-st-pauli", name: "FC St. Pauli", shortName: "STP", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/37.png" },
      { id: "club-stuttgart", name: "VfB Stuttgart", shortName: "VFB", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/10.png" },
      { id: "club-union-berlin", name: "1. FC Union Berlin", shortName: "FCU", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/28.png" },
      { id: "club-werder-bremen", name: "SV Werder Bremen", shortName: "SVW", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/12.png" },
      { id: "club-wolfsburg", name: "VfL Wolfsburg", shortName: "WOB", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://crests.football-data.org/11.png" },
      // --- LIGUE 1 (18 CLUBS - 2026/27) ---
      { id: "club-auxerre", name: "AJ Auxerre", shortName: "AJA", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/519.png" },
      { id: "club-brest", name: "Stade Brestois 29", shortName: "SB29", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/512.png" },
      { id: "club-le-mans", name: "Le Mans FC", shortName: "LMFC", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/540.png" },
      { id: "club-lens", name: "RC Lens", shortName: "RCL", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/546.png" },
      { id: "club-lille", name: "LOSC Lille", shortName: "LOSC", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/521.png" },
      { id: "club-lyon", name: "Olympique Lyonnais", shortName: "OL", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/523.png" },
      { id: "club-marseille", name: "Olympique de Marseille", shortName: "OM", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/516.png" },
      { id: "club-monaco", name: "AS Monaco", shortName: "ASM", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/548.png" },
      { id: "club-montpellier", name: "Montpellier HSC", shortName: "MHSC", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/518.png" },
      { id: "club-nantes", name: "FC Nantes", shortName: "FCN", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/543.png" },
      { id: "club-nice", name: "OGC Nice", shortName: "OGCN", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/522.png" },
      { id: "club-paris-fc", name: "Paris FC", shortName: "PFC", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/533.png" },
      { id: "club-psg", name: "Paris Saint-Germain", shortName: "PSG", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/524.png" },
      { id: "club-reims", name: "Stade de Reims", shortName: "SDR", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/547.png" },
      { id: "club-rennes", name: "Stade Rennais FC", shortName: "SRFC", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/529.png" },
      { id: "club-strasbourg", name: "RC Strasbourg Alsace", shortName: "RCSA", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/576.png" },
      { id: "club-toulouse", name: "Toulouse FC", shortName: "TFC", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/511.png" },
      { id: "club-troyes", name: "ESTAC Troyes", shortName: "TRO", country: "France", leagueId: "league-ligue-1", logoUrl: "https://crests.football-data.org/531.png" }
    ];
    SEED_COMPETITIONS = [
      // --- DOMESTIC LEAGUES (Single Round-Robin Format) ---
      {
        id: "comp-premier-league-2026",
        seasonId: "season-2026-27",
        leagueId: "league-premier-league",
        name: "Premier League",
        type: "LEAGUE",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { rounds: 19, homeAndAway: false, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ["points", "goalDifference", "goalsFor", "headToHead"], qualificationSpots: 7 }
      },
      {
        id: "comp-la-liga-2026",
        seasonId: "season-2026-27",
        leagueId: "league-la-liga",
        name: "La Liga",
        type: "LEAGUE",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { rounds: 19, homeAndAway: false, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ["points", "headToHead", "goalDifference", "goalsFor"], qualificationSpots: 7 }
      },
      {
        id: "comp-serie-a-2026",
        seasonId: "season-2026-27",
        leagueId: "league-serie-a",
        name: "Serie A",
        type: "LEAGUE",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { rounds: 19, homeAndAway: false, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ["points", "headToHead", "goalDifference", "goalsFor"], qualificationSpots: 7 }
      },
      {
        id: "comp-bundesliga-2026",
        seasonId: "season-2026-27",
        leagueId: "league-bundesliga",
        name: "Bundesliga",
        type: "LEAGUE",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { rounds: 17, homeAndAway: false, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ["points", "goalDifference", "goalsFor", "headToHead"], qualificationSpots: 6 }
      },
      {
        id: "comp-ligue-1-2026",
        seasonId: "season-2026-27",
        leagueId: "league-ligue-1",
        name: "Ligue 1",
        type: "LEAGUE",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { rounds: 17, homeAndAway: false, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ["points", "goalDifference", "goalsFor", "headToHead"], qualificationSpots: 5 }
      },
      // --- NATIONAL CUPS ---
      {
        id: "comp-fa-cup-2026",
        seasonId: "season-2026-27",
        leagueId: "league-premier-league",
        name: "FA Cup",
        type: "KNOCKOUT",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { rounds: 6, singleLeg: true, extraTime: true, penalties: true }
      },
      {
        id: "comp-copa-del-rey-2026",
        seasonId: "season-2026-27",
        leagueId: "league-la-liga",
        name: "Copa del Rey",
        type: "KNOCKOUT",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { rounds: 6, singleLeg: true, extraTime: true, penalties: true }
      },
      {
        id: "comp-coppa-italia-2026",
        seasonId: "season-2026-27",
        leagueId: "league-serie-a",
        name: "Coppa Italia",
        type: "KNOCKOUT",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { rounds: 5, singleLeg: true, extraTime: true, penalties: true }
      },
      {
        id: "comp-dfb-pokal-2026",
        seasonId: "season-2026-27",
        leagueId: "league-bundesliga",
        name: "DFB-Pokal",
        type: "KNOCKOUT",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { rounds: 5, singleLeg: true, extraTime: true, penalties: true }
      },
      {
        id: "comp-coupe-de-france-2026",
        seasonId: "season-2026-27",
        leagueId: "league-ligue-1",
        name: "Coupe de France",
        type: "KNOCKOUT",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { rounds: 5, singleLeg: true, extraTime: true, penalties: true }
      },
      // --- SUPER CUPS ---
      {
        id: "comp-community-shield-2026",
        seasonId: "season-2026-27",
        leagueId: "league-premier-league",
        name: "FA Community Shield",
        type: "SUPER_CUP",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { teams: 2, singleLeg: true, penalties: true }
      },
      {
        id: "comp-supercopa-espana-2026",
        seasonId: "season-2026-27",
        leagueId: "league-la-liga",
        name: "Supercopa de Espa\xF1a",
        type: "SUPER_CUP",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { teams: 4, format: "final_four" }
      },
      {
        id: "comp-supercoppa-italiana-2026",
        seasonId: "season-2026-27",
        leagueId: "league-serie-a",
        name: "Supercoppa Italiana",
        type: "SUPER_CUP",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { teams: 4, format: "final_four" }
      },
      {
        id: "comp-dfl-supercup-2026",
        seasonId: "season-2026-27",
        leagueId: "league-bundesliga",
        name: "DFL-Supercup",
        type: "SUPER_CUP",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { teams: 2, singleLeg: true }
      },
      // --- EUROPEAN COMPETITIONS (32 Clubs Each) ---
      {
        id: "comp-champions-league-2026",
        seasonId: "season-2026-27",
        name: "UEFA Champions League",
        type: "EUROPEAN_LEAGUE_PHASE",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { leaguePhaseTeams: 32, matchesPerTeam: 8, directQualifiers: 8, playoffTeams: 16, knockoutTeams: 16 }
      },
      {
        id: "comp-europa-league-2026",
        seasonId: "season-2026-27",
        name: "UEFA Europa League",
        type: "EUROPEAN_LEAGUE_PHASE",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { leaguePhaseTeams: 32, matchesPerTeam: 8, directQualifiers: 8, playoffTeams: 16, knockoutTeams: 16 }
      },
      {
        id: "comp-uefa-super-cup-2026",
        seasonId: "season-2026-27",
        name: "UEFA Super Cup",
        type: "SUPER_CUP",
        scheduleMode: "GENERATED_SCHEDULE",
        formatConfig: { teams: 2, singleLeg: true }
      }
    ];
  }
});

// src/server/firebase/circuitBreaker.ts
var DEFAULT_COOLDOWN_MS, CONSECUTIVE_FAILURES_THRESHOLD, FIRESTORE_READ_SOFT_LIMIT, FirestoreCircuitBreaker, firestoreCircuitBreaker;
var init_circuitBreaker = __esm({
  "src/server/firebase/circuitBreaker.ts"() {
    DEFAULT_COOLDOWN_MS = 6e4;
    CONSECUTIVE_FAILURES_THRESHOLD = 3;
    FIRESTORE_READ_SOFT_LIMIT = Number(process.env.FIRESTORE_READ_SOFT_LIMIT) || 35e3;
    FirestoreCircuitBreaker = class {
      constructor(cooldownMs = DEFAULT_COOLDOWN_MS) {
        this.state = "CLOSED";
        this.lastFailureTime = null;
        this.lastError = null;
        this.resourceExhaustedCount = 0;
        this.totalErrors = 0;
        this.consecutiveFailures = 0;
        this.openCount = 0;
        this.cooldownMs = DEFAULT_COOLDOWN_MS;
        this.healthySince = (/* @__PURE__ */ new Date()).toISOString();
        this.halfOpenProbeInFlight = false;
        this.skippedReadsCount = 0;
        this.softLimitExceeded = false;
        this.cooldownMs = cooldownMs;
      }
      getOperationMode() {
        if (this.state === "CLOSED") {
          return this.softLimitExceeded ? "SQLITE_FALLBACK" : "FIRESTORE_PRIMARY";
        }
        if (this.state === "OPEN") {
          return "SQLITE_FALLBACK";
        }
        return "RECOVERING";
      }
      checkSoftLimit(currentReads) {
        if (currentReads >= FIRESTORE_READ_SOFT_LIMIT) {
          if (!this.softLimitExceeded) {
            this.softLimitExceeded = true;
            console.warn(`[CIRCUIT_BREAKER] Daily read soft limit reached (${currentReads} >= ${FIRESTORE_READ_SOFT_LIMIT}). Switching to conservative SQLITE_FALLBACK mode.`);
          }
          return true;
        }
        return false;
      }
      resetSoftLimit() {
        this.softLimitExceeded = false;
      }
      setCooldown(ms) {
        this.cooldownMs = ms;
      }
      isQuotaExhaustedError(err) {
        if (!err) return false;
        const rawCode = err.code ?? (err.status ?? "");
        const rawMsg = err.message || String(err);
        const strCode = String(rawCode).toUpperCase();
        const strMsg = String(rawMsg).toLowerCase();
        return rawCode === 8 || strCode === "8" || strCode.includes("RESOURCE_EXHAUSTED") || rawCode === 429 || strMsg.includes("resource_exhausted") || strMsg.includes("quota exceeded") || strMsg.includes("quota limit exceeded") || strMsg.includes("quota") || strMsg.includes("read quota");
      }
      isNetworkOrUnavailableError(err) {
        if (!err) return false;
        const rawCode = err.code ?? (err.status ?? "");
        const rawMsg = err.message || String(err);
        const strCode = String(rawCode).toUpperCase();
        const strMsg = String(rawMsg).toLowerCase();
        return rawCode === 14 || strCode === "14" || strCode.includes("UNAVAILABLE") || rawCode === 4 || strCode === "4" || strCode.includes("DEADLINE_EXCEEDED") || strMsg.includes("unavailable") || strMsg.includes("timeout") || strMsg.includes("timed out") || strMsg.includes("connection reset") || strMsg.includes("econnrefused");
      }
      recordSkippedRead(count = 1) {
        this.skippedReadsCount += count;
      }
      canExecute() {
        const now = Date.now();
        if (this.softLimitExceeded) {
          this.skippedReadsCount++;
          return false;
        }
        if (this.state === "CLOSED") {
          return true;
        }
        if (this.state === "OPEN") {
          const elapsed = now - (this.lastFailureTime || 0);
          if (elapsed >= this.cooldownMs) {
            this.state = "HALF_OPEN";
            this.halfOpenProbeInFlight = true;
            console.log(`[CIRCUIT_BREAKER] Cooldown (${this.cooldownMs}ms) expired. State -> HALF_OPEN (probing Firestore)`);
            return true;
          }
          this.skippedReadsCount++;
          return false;
        }
        if (this.state === "HALF_OPEN") {
          if (this.halfOpenProbeInFlight) {
            this.skippedReadsCount++;
            return false;
          }
          this.halfOpenProbeInFlight = true;
          return true;
        }
        this.skippedReadsCount++;
        return false;
      }
      recordSuccess() {
        this.consecutiveFailures = 0;
        this.halfOpenProbeInFlight = false;
        if (this.state !== "CLOSED") {
          console.log(`[CIRCUIT_BREAKER] Firestore probe succeeded. State -> CLOSED (restored normal operation)`);
          this.state = "CLOSED";
          this.healthySince = (/* @__PURE__ */ new Date()).toISOString();
          this.lastError = null;
        }
      }
      recordFailure(err) {
        this.totalErrors++;
        this.lastFailureTime = Date.now();
        this.halfOpenProbeInFlight = false;
        const errMsg = err?.message || String(err);
        this.lastError = errMsg;
        const isQuota = this.isQuotaExhaustedError(err);
        if (isQuota) {
          this.resourceExhaustedCount++;
          this.consecutiveFailures++;
          this.tripOpen(`Firestore Quota Exhausted: ${errMsg}`);
          return;
        }
        const isNet = this.isNetworkOrUnavailableError(err);
        if (isNet) {
          this.consecutiveFailures++;
          if (this.consecutiveFailures >= CONSECUTIVE_FAILURES_THRESHOLD || this.state === "HALF_OPEN") {
            this.tripOpen(`Firestore Transient Error (${this.consecutiveFailures} consecutive): ${errMsg}`);
          }
          return;
        }
      }
      tripOpen(reason) {
        if (this.state !== "OPEN") {
          this.openCount++;
          console.warn(`[CIRCUIT_BREAKER] TRIP -> OPEN (${reason}). Cooldown: ${this.cooldownMs}ms. Fallback data will be served.`);
        }
        this.state = "OPEN";
        this.healthySince = null;
      }
      forceState(state) {
        this.state = state;
        this.halfOpenProbeInFlight = false;
        if (state === "CLOSED") {
          this.healthySince = (/* @__PURE__ */ new Date()).toISOString();
          this.consecutiveFailures = 0;
        } else {
          this.lastFailureTime = Date.now();
          this.healthySince = null;
        }
        console.log(`[CIRCUIT_BREAKER] State forced to ${state}`);
      }
      reset() {
        this.forceState("CLOSED");
        this.lastError = null;
      }
      getStatus() {
        const now = Date.now();
        let cooldownRemainingMs = 0;
        if (this.state === "OPEN" && this.lastFailureTime) {
          cooldownRemainingMs = Math.max(0, this.cooldownMs - (now - this.lastFailureTime));
        }
        return {
          state: this.state,
          operationMode: this.getOperationMode(),
          lastFailureTime: this.lastFailureTime,
          lastError: this.lastError,
          resourceExhaustedCount: this.resourceExhaustedCount,
          totalErrors: this.totalErrors,
          consecutiveFailures: this.consecutiveFailures,
          openCount: this.openCount,
          cooldownMs: this.cooldownMs,
          cooldownRemainingMs,
          healthySince: this.healthySince,
          skippedReadsCount: this.skippedReadsCount,
          softLimitExceeded: this.softLimitExceeded,
          softLimitThreshold: FIRESTORE_READ_SOFT_LIMIT
        };
      }
      isHealthy() {
        return this.state === "CLOSED";
      }
    };
    firestoreCircuitBreaker = new FirestoreCircuitBreaker();
  }
});

// src/server/firebase/occupancySnapshot.ts
function updateOccupancyRecord(record) {
  const key = `${record.seasonId}_${record.clubId}`;
  memoryOccupancySnapshot.set(key, record);
  try {
    queryRun(
      `INSERT OR REPLACE INTO active_occupancies_cache 
       (club_id, season_id, user_id, username, display_name, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        record.clubId,
        record.seasonId,
        record.claimedByUserId,
        record.username || null,
        record.displayName || null,
        record.status,
        record.updatedAt
      ]
    );
  } catch {
  }
}
function getLocalOccupancySnapshot(seasonId = "season-2026-27") {
  const memRecords = [];
  for (const [k, v] of memoryOccupancySnapshot.entries()) {
    if (k.startsWith(`${seasonId}_`)) {
      memRecords.push(v);
    }
  }
  if (memRecords.length > 0) {
    return memRecords;
  }
  try {
    const cachedRows = queryAll(
      `SELECT club_id, season_id, user_id, username, display_name, status, updated_at
       FROM active_occupancies_cache
       WHERE season_id = ? AND status = 'active'`,
      [seasonId]
    );
    if (cachedRows.length > 0) {
      for (const r of cachedRows) {
        const rec = {
          clubId: r.club_id,
          seasonId: r.season_id,
          status: "active",
          claimedByUserId: r.user_id,
          username: r.username || void 0,
          displayName: r.display_name || void 0,
          updatedAt: r.updated_at
        };
        memoryOccupancySnapshot.set(`${seasonId}_${r.club_id}`, rec);
        memRecords.push(rec);
      }
      return memRecords;
    }
    const memRows = queryAll(
      `SELECT cm.club_id, cm.season_id, cm.user_id, u.username, u.first_name, u.last_name, cm.claimed_at as updated_at
       FROM club_memberships cm
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE cm.season_id = ? AND cm.status = 'active'`,
      [seasonId]
    );
    for (const r of memRows) {
      const displayName = `${r.first_name || ""} ${r.last_name || ""}`.trim() || r.username || r.user_id;
      const rec = {
        clubId: r.club_id,
        seasonId: r.season_id,
        status: "active",
        claimedByUserId: r.user_id,
        username: r.username || void 0,
        displayName,
        updatedAt: r.updated_at || (/* @__PURE__ */ new Date()).toISOString()
      };
      memoryOccupancySnapshot.set(`${seasonId}_${r.club_id}`, rec);
      memRecords.push(rec);
    }
  } catch (err) {
    console.warn("[OCCUPANCY_SNAPSHOT] SQLite hydration error:", err);
  }
  return memRecords;
}
function syncOccupanciesFromFirestoreDocs(seasonId, occupancies) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const occ of occupancies) {
    updateOccupancyRecord({
      clubId: occ.clubId,
      seasonId,
      status: "active",
      claimedByUserId: occ.userId,
      username: occ.username,
      displayName: occ.displayName,
      updatedAt: now
    });
  }
}
function loadSnapshotFromFile() {
  try {
    getLocalOccupancySnapshot("season-2026-27");
  } catch (err) {
    console.warn("[OCCUPANCY_SNAPSHOT] Load error:", err.message);
  }
}
function getUserOccupiedClubIdLocally(seasonId, userId) {
  const snapshot = getLocalOccupancySnapshot(seasonId);
  const found = snapshot.find((r) => r.claimedByUserId === userId);
  return found ? found.clubId : null;
}
function getClubOccupantUserIdLocally(seasonId, clubId) {
  const snapshot = getLocalOccupancySnapshot(seasonId);
  const found = snapshot.find((r) => r.clubId === clubId);
  return found ? found.claimedByUserId : null;
}
var memoryOccupancySnapshot;
var init_occupancySnapshot = __esm({
  "src/server/firebase/occupancySnapshot.ts"() {
    init_db();
    memoryOccupancySnapshot = /* @__PURE__ */ new Map();
  }
});

// src/server/utils/testGuard.ts
function isHostedEnvironment() {
  return Boolean(
    process.env.K_SERVICE && process.env.K_SERVICE.trim() !== "" || process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === "production"
  );
}
function isConnectedToProductionFirestore() {
  if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK === "true") {
    return false;
  }
  if (isHostedEnvironment()) {
    return true;
  }
  const status = getFirebaseStatus();
  if (status.authMode === "local_fallback") {
    return false;
  }
  if (process.env.FIRESTORE_EMULATOR_HOST && (status.projectId?.startsWith("demo-") || status.projectId?.startsWith("test-"))) {
    return false;
  }
  return true;
}
function isTargetingProductionProjectOrDb() {
  if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK === "true") {
    return false;
  }
  const status = getFirebaseStatus();
  const envProjectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  const envDbId = process.env.FIRESTORE_DATABASE_ID || process.env.FIREBASE_DATABASE_ID;
  if (status.projectId === PROD_PROJECT_ID || status.databaseId === PROD_DATABASE_ID || envProjectId === PROD_PROJECT_ID || envDbId === PROD_DATABASE_ID) {
    return true;
  }
  return false;
}
function isSyntheticIdentifier(id) {
  if (!id || typeof id !== "string") return false;
  const lower = id.toLowerCase();
  return SYNTHETIC_ID_PATTERNS.some((pattern) => lower.includes(pattern));
}
function isTestSafe() {
  if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK === "true") {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME !== void 0) {
      return false;
    }
    const { info } = initializeFirebaseAdmin();
    if (info.authMode === "local_fallback" && info.projectId === "test-local-fallback") {
      return true;
    }
    return false;
  }
  if (isHostedEnvironment()) {
    return false;
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const projId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
    if (projId.startsWith("demo-") || projId.startsWith("test-")) {
      return true;
    }
  }
  return false;
}
function assertTestEnvironmentSafe(actionName = "test_mutation") {
  if (!isTestSafe()) {
    const reasons = [];
    if (isHostedEnvironment()) reasons.push("hosted environment detected (K_SERVICE/VERCEL/NODE_ENV=production)");
    if (isTargetingProductionProjectOrDb()) reasons.push("production project/database targeted");
    if (process.env.ALLOW_TEST_WRITES === "true") reasons.push("ALLOW_TEST_WRITES is deprecated and cannot authorize writes");
    if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK !== "true" && !process.env.FIRESTORE_EMULATOR_HOST) {
      reasons.push("neither FIREBASE_FORCE_LOCAL_FALLBACK=true nor FIRESTORE_EMULATOR_HOST is configured");
    }
    const errorMsg = `PRODUCTION_SAFETY_VIOLATION: Test mutation "${actionName}" is strictly prohibited. Production database cannot be modified by test helpers or mock data. Violations: [${reasons.join("; ")}]`;
    console.error(`[CRITICAL PRODUCTION BLOCKED] ${errorMsg}`);
    throw new Error(errorMsg);
  }
}
function guardAgainstTestEntityCreation(entityType, entityId, entityNameOrUsername) {
  if (isSyntheticIdentifier(entityId) || isSyntheticIdentifier(entityNameOrUsername)) {
    assertTestEnvironmentSafe(`create_${entityType}:${entityId}`);
  }
}
function assertNoSyntheticIdsInProduction(actionName, ids) {
  if (!isConnectedToProductionFirestore()) {
    return;
  }
  for (const id of ids) {
    if (isSyntheticIdentifier(id)) {
      const errorMsg = `PRODUCTION_SAFETY_VIOLATION: Synthetic identifier "${id}" rejected in production/hosted environment during "${actionName}". Mutation blocked before persistence.`;
      console.error(`[CRITICAL PRODUCTION BLOCKED] ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }
}
var PROD_PROJECT_ID, PROD_DATABASE_ID, SYNTHETIC_ID_PATTERNS;
var init_testGuard = __esm({
  "src/server/utils/testGuard.ts"() {
    init_admin();
    PROD_PROJECT_ID = "gen-lang-client-0195097895";
    PROD_DATABASE_ID = "ai-studio-efluz-4c6c88a6-697e-4fdf-82ed-45fec68ca34d";
    SYNTHETIC_ID_PATTERNS = [
      "audit-",
      "test-",
      "test_",
      "admin_test",
      "admin-test",
      "admin-offline",
      "admin-audit",
      "offline-test",
      "fix-retry-test",
      "user_a_",
      "user_b_",
      "notif_b_",
      "spoofed_"
    ];
  }
});

// src/server/sync/mutationQueue.ts
import fs3 from "fs";
import path3 from "path";
function saveQueueBackupToFile() {
  try {
    if (!fs3.existsSync(BACKUP_DIR)) {
      fs3.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    const arr = Array.from(memoryQueue.values()).filter((m) => m.status === "PENDING" || m.status === "SYNCING");
    fs3.writeFileSync(BACKUP_FILE, JSON.stringify(arr, null, 2), "utf-8");
  } catch {
  }
}
function loadQueueBackupFromFile() {
  try {
    if (fs3.existsSync(BACKUP_FILE)) {
      const content = fs3.readFileSync(BACKUP_FILE, "utf-8");
      const arr = JSON.parse(content);
      for (const item of arr) {
        if (!memoryQueue.has(item.mutationId)) {
          memoryQueue.set(item.mutationId, item);
        }
      }
    }
  } catch {
  }
}
function enqueueMutation(mutation) {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL || process.env.K_SERVICE || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw Object.assign(
      new Error("Remote database unavailable. Change was not accepted; retry when service recovers."),
      { code: "AUTHORITATIVE_WRITE_REQUIRED", statusCode: 503 }
    );
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = memoryQueue.get(mutation.mutationId);
  if (existing && existing.status === "SYNCED") {
    return existing;
  }
  const fullMutation = {
    ...mutation,
    status: "PENDING",
    retryCount: existing ? existing.retryCount : 0,
    lastError: null,
    updatedAt: now
  };
  memoryQueue.set(mutation.mutationId, fullMutation);
  saveQueueBackupToFile();
  try {
    queryRun(
      `INSERT OR REPLACE INTO pending_mutations 
       (mutation_id, entity_type, entity_id, operation, payload, status, retry_count, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fullMutation.mutationId,
        fullMutation.entityType,
        fullMutation.entityId,
        fullMutation.operation,
        JSON.stringify(fullMutation.payload),
        fullMutation.status,
        fullMutation.retryCount,
        fullMutation.lastError,
        fullMutation.createdAt,
        fullMutation.updatedAt
      ]
    );
  } catch (err) {
    console.warn("[MUTATION_QUEUE] SQLite insert warning:", err);
  }
  console.log(`[MUTATION_QUEUE] Enqueued mutation: id=${fullMutation.mutationId} type=${fullMutation.entityType}`);
  return fullMutation;
}
function getPendingMutations(status) {
  if (memoryQueue.size === 0) {
    try {
      const rows = queryAll(
        `SELECT mutation_id, entity_type, entity_id, operation, payload, status, retry_count, last_error, created_at, updated_at 
         FROM pending_mutations WHERE status IN ('PENDING', 'SYNCING')`
      );
      for (const r of rows) {
        let payload = {};
        try {
          payload = JSON.parse(r.payload);
        } catch {
        }
        memoryQueue.set(r.mutation_id, {
          mutationId: r.mutation_id,
          entityType: r.entity_type,
          entityId: r.entity_id,
          operation: r.operation,
          payload,
          status: r.status,
          retryCount: r.retry_count || 0,
          lastError: r.last_error || null,
          createdAt: r.created_at,
          updatedAt: r.updated_at
        });
      }
    } catch {
    }
    loadQueueBackupFromFile();
  }
  const all = Array.from(memoryQueue.values());
  if (status) {
    return all.filter((m) => m.status === status);
  }
  return all;
}
function updateMutationStatus(mutationId, status, error) {
  const item = memoryQueue.get(mutationId);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (item) {
    item.status = status;
    item.updatedAt = now;
    if (error) {
      item.lastError = error;
      item.retryCount = (item.retryCount || 0) + 1;
    } else if (status === "SYNCED") {
      item.lastError = null;
    }
    memoryQueue.set(mutationId, item);
  }
  saveQueueBackupToFile();
  try {
    queryRun(
      `UPDATE pending_mutations 
       SET status = ?, last_error = ?, updated_at = ?, retry_count = retry_count + ?
       WHERE mutation_id = ?`,
      [status, error || null, now, error ? 1 : 0, mutationId]
    );
  } catch {
  }
}
function getQueueStats() {
  const all = getPendingMutations();
  return {
    total: all.length,
    pending: all.filter((m) => m.status === "PENDING").length,
    syncing: all.filter((m) => m.status === "SYNCING").length,
    synced: all.filter((m) => m.status === "SYNCED").length,
    failed: all.filter((m) => m.status === "FAILED").length
  };
}
async function processPendingMutations() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL || process.env.K_SERVICE || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error("HOSTED_LOCAL_QUEUE_DISABLED: reconcile legacy local mutations through a reviewed recovery plan");
  }
  if (isSyncInProgress) {
    console.log("[MUTATION_QUEUE] Sync already in progress, skipping duplicate call.");
    return {
      totalPending: getPendingMutations("PENDING").length,
      processed: 0,
      synced: 0,
      failed: 0,
      circuitOpen: !firestoreCircuitBreaker.canExecute(),
      errors: []
    };
  }
  if (!firestoreCircuitBreaker.canExecute()) {
    console.log("[MUTATION_QUEUE] Circuit breaker is OPEN. Deferring sync.");
    return {
      totalPending: getPendingMutations("PENDING").length,
      processed: 0,
      synced: 0,
      failed: 0,
      circuitOpen: true,
      errors: []
    };
  }
  isSyncInProgress = true;
  const pendingItems = getPendingMutations("PENDING").sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  let processed = 0;
  let synced = 0;
  let failed = 0;
  const errors = [];
  try {
    const db = getFirestoreDb();
    for (const item of pendingItems) {
      if (!firestoreCircuitBreaker.canExecute()) {
        console.warn("[MUTATION_QUEUE] Circuit breaker tripped during sync. Aborting remaining mutations.");
        break;
      }
      processed++;
      updateMutationStatus(item.mutationId, "SYNCING");
      try {
        await executeSingleMutationSync(db, item);
        updateMutationStatus(item.mutationId, "SYNCED");
        firestoreCircuitBreaker.recordSuccess();
        synced++;
        console.log(`[MUTATION_QUEUE] Successfully synced mutation ${item.mutationId} (${item.entityType})`);
      } catch (err) {
        const isQuota = firestoreCircuitBreaker.isQuotaExhaustedError(err);
        const isOwnershipMismatch = err.message?.includes("OWNERSHIP_MISMATCH");
        const isTerminalError = isOwnershipMismatch;
        firestoreCircuitBreaker.recordFailure(err);
        const nextStatus = isTerminalError ? "FAILED" : "PENDING";
        updateMutationStatus(item.mutationId, nextStatus, err.message);
        failed++;
        errors.push({ mutationId: item.mutationId, error: err.message });
        console.error(`[MUTATION_QUEUE] Failed syncing mutation ${item.mutationId}:`, err.message);
        if (isQuota) {
          break;
        }
      }
    }
  } finally {
    isSyncInProgress = false;
  }
  return {
    totalPending: getPendingMutations("PENDING").length,
    processed,
    synced,
    failed,
    circuitOpen: !firestoreCircuitBreaker.canExecute(),
    errors
  };
}
async function executeSingleMutationSync(db, item) {
  const { entityType, entityId, payload } = item;
  assertNoSyntheticIdsInProduction(`mutation_queue_replay:${entityType}`, [
    item.mutationId,
    entityId,
    payload?.adminUserId,
    payload?.userId,
    payload?.targetUserId,
    payload?.submittedByUserId,
    payload?.fixtureId,
    payload?.clubId,
    payload?.submissionId
  ]);
  switch (entityType) {
    case "RESULT_SUBMISSION": {
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(entityId);
      const fixDoc = await fixRef.get();
      if (!fixDoc.exists) {
        throw new Error(`Fixture ${entityId} not found in Firestore.`);
      }
      const fixData = fixDoc.data();
      const subRef = db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc(payload.submissionId);
      await subRef.set(
        {
          id: payload.submissionId,
          fixtureId: entityId,
          submittedByUserId: payload.userId,
          clubId: payload.userClubId,
          homeScore: payload.homeScore,
          awayScore: payload.awayScore,
          proofUrl: payload.proofUrl || null,
          createdAt: payload.createdAt || (/* @__PURE__ */ new Date()).toISOString()
        },
        { merge: true }
      );
      const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where("fixtureId", "==", entityId).get();
      const subs = subsSnap.docs.map((d) => d.data());
      let newStatus = fixData.status;
      let confirmedHome = fixData.homeScore ?? null;
      let confirmedAway = fixData.awayScore ?? null;
      let winnerClubId = fixData.winnerClubId ?? null;
      let confirmedAt = fixData.resultConfirmedAt ?? null;
      if (subs.length >= 2) {
        const [s1, s2] = subs;
        if (s1.homeScore === s2.homeScore && s1.awayScore === s2.awayScore) {
          newStatus = "CONFIRMED";
          confirmedHome = s1.homeScore;
          confirmedAway = s1.awayScore;
          confirmedAt = payload.updatedAt || (/* @__PURE__ */ new Date()).toISOString();
          if (confirmedHome > confirmedAway) winnerClubId = fixData.homeClubId;
          else if (confirmedAway > confirmedHome) winnerClubId = fixData.awayClubId;
        } else {
          newStatus = "DISPUTED";
        }
      } else if (subs.length === 1 && newStatus !== "CONFIRMED") {
        newStatus = "PENDING_CONFIRMATION";
      }
      await fixRef.update({
        status: newStatus,
        homeScore: confirmedHome,
        awayScore: confirmedAway,
        winnerClubId,
        resultConfirmedAt: confirmedAt,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (newStatus === "CONFIRMED" && fixData.competitionId) {
        try {
          const { rebuildCompetitionStandingsFirestore: rebuildCompetitionStandingsFirestore3 } = await Promise.resolve().then(() => (init_firestoreStore(), firestoreStore_exports));
          await rebuildCompetitionStandingsFirestore3(fixData.competitionId);
        } catch {
        }
      }
      break;
    }
    case "ADMIN_APPROVE_RESULT": {
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(entityId);
      const fixDoc = await fixRef.get();
      if (!fixDoc.exists) {
        throw new Error(`Fixture ${entityId} not found in Firestore.`);
      }
      const fixData = fixDoc.data();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      let winnerClubId = null;
      if (payload.homeScore > payload.awayScore) winnerClubId = fixData.homeClubId;
      else if (payload.awayScore > payload.homeScore) winnerClubId = fixData.awayClubId;
      await fixRef.update({
        status: "CONFIRMED",
        homeScore: payload.homeScore,
        awayScore: payload.awayScore,
        winnerClubId,
        resultConfirmedAt: now,
        updatedAt: now
      });
      const disputesSnap = await db.collection(COLLECTIONS.DISPUTES).where("fixtureId", "==", entityId).get();
      for (const d of disputesSnap.docs) {
        await d.ref.update({
          status: "RESOLVED",
          resolvedByUserId: payload.adminUserId,
          resolutionNotes: payload.notes || "Approved by admin via sync",
          resolvedAt: now
        });
      }
      if (fixData.competitionId) {
        try {
          const { rebuildCompetitionStandingsFirestore: rebuildCompetitionStandingsFirestore3 } = await Promise.resolve().then(() => (init_firestoreStore(), firestoreStore_exports));
          await rebuildCompetitionStandingsFirestore3(fixData.competitionId);
        } catch {
        }
      }
      break;
    }
    case "ADMIN_REJECT_RESULT": {
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(entityId);
      const fixDoc = await fixRef.get();
      if (!fixDoc.exists) {
        throw new Error(`Fixture ${entityId} not found in Firestore.`);
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await fixRef.update({
        status: "SCHEDULED",
        homeScore: null,
        awayScore: null,
        winnerClubId: null,
        resultConfirmedAt: null,
        updatedAt: now
      });
      const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where("fixtureId", "==", entityId).get();
      const b = db.batch();
      for (const doc of subsSnap.docs) {
        b.delete(doc.ref);
      }
      await b.commit();
      if (fixDoc.data()?.competitionId) {
        try {
          const { rebuildCompetitionStandingsFirestore: rebuildCompetitionStandingsFirestore3 } = await Promise.resolve().then(() => (init_firestoreStore(), firestoreStore_exports));
          await rebuildCompetitionStandingsFirestore3(fixDoc.data().competitionId);
        } catch {
        }
      }
      break;
    }
    case "CLUB_CLAIM": {
      const { claimClubAtomicFirestore: claimClubAtomicFirestore2 } = await Promise.resolve().then(() => (init_firestoreStore(), firestoreStore_exports));
      const res = await claimClubAtomicFirestore2(payload.userId, payload.clubId, payload.seasonId, { authoritativeOnly: true });
      if (!res || !res.authoritative || res.isFallback) {
        throw new Error("AUTHORITATIVE_WRITE_FAILED: Remote claim write did not succeed.");
      }
      break;
    }
    case "ADMIN_ASSIGN_CLUB": {
      const { adminAssignClubFirestore: adminAssignClubFirestore2 } = await Promise.resolve().then(() => (init_firestoreStore(), firestoreStore_exports));
      const res = await adminAssignClubFirestore2(payload.adminUserId || "system", payload.clubId, payload.targetUserId, payload.seasonId, { authoritativeOnly: true });
      if (!res || !res.authoritative || res.isFallback) {
        throw new Error("AUTHORITATIVE_WRITE_FAILED: Remote admin assign club did not succeed.");
      }
      break;
    }
    case "ADMIN_RELEASE_CLUB": {
      const { adminReleaseClubFirestore: adminReleaseClubFirestore2 } = await Promise.resolve().then(() => (init_firestoreStore(), firestoreStore_exports));
      const res = await adminReleaseClubFirestore2(payload.adminUserId || "system", payload.clubId, payload.seasonId, { authoritativeOnly: true });
      if (!res || !res.authoritative || res.isFallback) {
        throw new Error("AUTHORITATIVE_WRITE_FAILED: Remote admin release club did not succeed.");
      }
      break;
    }
    case "MATCHDAY_OVERRIDE": {
      const { setCompetitionMatchdayOverrideFirestore: setCompetitionMatchdayOverrideFirestore2 } = await Promise.resolve().then(() => (init_firestoreStore(), firestoreStore_exports));
      await setCompetitionMatchdayOverrideFirestore2(payload.competitionId, payload.overrideStatus);
      break;
    }
    case "ADMIN_DECISION": {
      if (item.operation === "ADMIN_APPROVE_RESULT") {
        const { adminApproveFixtureResultFirestore: adminApproveFixtureResultFirestore2 } = await Promise.resolve().then(() => (init_firestoreStore(), firestoreStore_exports));
        const res = await adminApproveFixtureResultFirestore2(
          payload.adminUserId,
          payload.fixtureId,
          payload.homeScore,
          payload.awayScore,
          payload.notes,
          { authoritativeOnly: true }
        );
        if (!res || !res.authoritative || res.isFallback) {
          throw new Error("AUTHORITATIVE_WRITE_FAILED: Remote admin approve write did not succeed.");
        }
      } else if (item.operation === "ADMIN_REJECT_RESULT") {
        const { reopenFixtureFirestore: reopenFixtureFirestore2 } = await Promise.resolve().then(() => (init_firestoreStore(), firestoreStore_exports));
        const res = await reopenFixtureFirestore2(
          payload.adminUserId,
          payload.fixtureId,
          payload.notes,
          { authoritativeOnly: true }
        );
        if (!res || !res.authoritative || res.isFallback) {
          throw new Error("AUTHORITATIVE_WRITE_FAILED: Remote reopen write did not succeed.");
        }
      }
      break;
    }
    case "USER_CREATE": {
      const { getOrCreateTelegramUserFirestore: getOrCreateTelegramUserFirestore2 } = await Promise.resolve().then(() => (init_firestoreStore(), firestoreStore_exports));
      await getOrCreateTelegramUserFirestore2(payload);
      break;
    }
    case "NOTIFICATION_READ": {
      const notifRef = db.collection(COLLECTIONS.NOTIFICATIONS).doc(entityId);
      const notifDoc = await notifRef.get();
      if (!notifDoc.exists) {
        console.warn(`[MUTATION_QUEUE] Notification ${entityId} not found in Firestore during sync replay. Skipping.`);
        break;
      }
      const notifData = notifDoc.data();
      if (payload.userId && notifData?.userId !== payload.userId) {
        throw new Error(`OWNERSHIP_MISMATCH: Notification ${entityId} belongs to user '${notifData?.userId}', not '${payload.userId}'.`);
      }
      await notifRef.update({ isRead: true, readAt: payload.readAt || (/* @__PURE__ */ new Date()).toISOString() });
      break;
    }
    case "NOTIFICATION_READ_ALL": {
      const targetUserId = payload.userId || entityId;
      const notifsSnap = await db.collection(COLLECTIONS.NOTIFICATIONS).where("userId", "==", targetUserId).where("isRead", "==", false).get();
      if (!notifsSnap.empty) {
        const b = db.batch();
        const readAt = payload.readAt || (/* @__PURE__ */ new Date()).toISOString();
        notifsSnap.docs.forEach((d) => b.update(d.ref, { isRead: true, readAt }));
        await b.commit();
      }
      break;
    }
    default:
      console.warn(`[MUTATION_QUEUE] Unknown mutation entityType: ${entityType}`);
  }
}
var memoryQueue, isSyncInProgress, IS_SERVERLESS2, BACKUP_DIR, BACKUP_FILE;
var init_mutationQueue = __esm({
  "src/server/sync/mutationQueue.ts"() {
    init_db();
    init_circuitBreaker();
    init_admin();
    init_collections();
    init_testGuard();
    memoryQueue = /* @__PURE__ */ new Map();
    isSyncInProgress = false;
    IS_SERVERLESS2 = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
    BACKUP_DIR = process.env.DATA_DIR || (IS_SERVERLESS2 ? "/tmp/data" : path3.resolve(process.cwd(), "data"));
    BACKUP_FILE = path3.join(BACKUP_DIR, "pending_mutations.json");
  }
});

// src/server/tournament/fixtureEngine.ts
function generateEuropean32LeaguePhaseSchedule(clubIds, options = {}) {
  if (clubIds.length !== 32) {
    throw new Error(`European 32-team league phase requires exactly 32 clubs (received ${clubIds.length}).`);
  }
  const n = 32;
  const numRounds = 8;
  const roundPairs = [];
  for (let r = 0; r < numRounds; r++) {
    const pairs = [];
    pairs.push([31, r]);
    for (let i = 1; i <= 15; i++) {
      const u = (r + i) % 31;
      const v = (r - i + 31) % 31;
      pairs.push([u, v]);
    }
    roundPairs.push(pairs);
  }
  const homeCount = new Array(n).fill(0);
  const matchups = [];
  for (let r = 0; r < numRounds; r++) {
    const pairs = roundPairs[r];
    for (let m = 0; m < pairs.length; m++) {
      const [u, v] = pairs[m];
      let uIsHome;
      if (homeCount[u] >= 4 && homeCount[v] < 4) {
        uIsHome = false;
      } else if (homeCount[v] >= 4 && homeCount[u] < 4) {
        uIsHome = true;
      } else if (homeCount[u] < homeCount[v]) {
        uIsHome = true;
      } else if (homeCount[v] < homeCount[u]) {
        uIsHome = false;
      } else {
        uIsHome = (r + m) % 2 === 0;
      }
      const homeIdx = uIsHome ? u : v;
      const awayIdx = uIsHome ? v : u;
      homeCount[homeIdx]++;
      matchups.push({
        matchday: r + 1,
        homeClubId: clubIds[homeIdx],
        awayClubId: clubIds[awayIdx]
      });
    }
  }
  return matchups;
}
var init_fixtureEngine = __esm({
  "src/server/tournament/fixtureEngine.ts"() {
  }
});

// src/server/services/notificationService.ts
async function createNotification(userId, type, title, message, data) {
  await createNotificationFirestore(userId, type, title, message, data);
}
var init_notificationService = __esm({
  "src/server/services/notificationService.ts"() {
    init_firestoreStore();
  }
});

// src/server/tournament/standingsProjection.ts
function projectStandings(clubs, fixtures, config = {}) {
  const win = Number(config.pointsForWin ?? 3), draw = Number(config.pointsForDraw ?? 1), loss = Number(config.pointsForLoss ?? 0);
  const rows = clubs.map((c) => ({ position: 0, clubId: c.id, clubName: c.name, shortName: c.shortName, logoUrl: c.logoUrl, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, form: [] }));
  const byId = new Map(rows.map((row) => [row.clubId, row]));
  const confirmed = fixtures.filter((f) => f.status === "CONFIRMED").sort((a, b) => (Date.parse(a.resultConfirmedAt || a.scheduledAt || "") || 0) - (Date.parse(b.resultConfirmedAt || b.scheduledAt || "") || 0) || a.id.localeCompare(b.id));
  for (const f of confirmed) {
    if (!f.homeClubId || !f.awayClubId || f.homeClubId === f.awayClubId || !Number.isInteger(f.homeScore) || !Number.isInteger(f.awayScore) || f.homeScore < 0 || f.awayScore < 0) throw new Error(`INVALID_CONFIRMED_RESULT: ${f.id}`);
    const home = byId.get(f.homeClubId), away = byId.get(f.awayClubId);
    if (!home || !away) throw new Error(`FIXTURE_PARTICIPANT_MISSING: ${f.id}`);
    for (const [row, forGoals, againstGoals] of [[home, f.homeScore, f.awayScore], [away, f.awayScore, f.homeScore]]) {
      row.played++;
      row.goalsFor += forGoals;
      row.goalsAgainst += againstGoals;
      row.goalDifference = row.goalsFor - row.goalsAgainst;
      if (forGoals > againstGoals) {
        row.won++;
        row.points += win;
        row.form.push("W");
      } else if (forGoals === againstGoals) {
        row.drawn++;
        row.points += draw;
        row.form.push("D");
      } else {
        row.lost++;
        row.points += loss;
        row.form.push("L");
      }
      row.form = row.form.slice(-5);
    }
  }
  const rules = config.tieBreakers || ["points", "goalDifference", "goalsFor", "headToHead"];
  if (rules.some((rule) => !["points", "goalDifference", "goalsFor", "headToHead", "wins"].includes(rule))) throw new Error("UNSUPPORTED_TIEBREAKER");
  function rank(group, index) {
    if (group.length < 2 || index >= rules.length) return [...group].sort((a, b) => a.clubId.localeCompare(b.clubId));
    const rule = rules[index];
    const ids = new Set(group.map((r) => r.clubId));
    const metric = (row) => {
      if (rule !== "headToHead") return [rule === "wins" ? row.won : Number(row[rule])];
      let points = 0, gd = 0, gf = 0;
      for (const f of confirmed) if (ids.has(f.homeClubId) && ids.has(f.awayClubId)) {
        if (f.homeClubId !== row.clubId && f.awayClubId !== row.clubId) continue;
        const own = f.homeClubId === row.clubId ? f.homeScore : f.awayScore, other = f.homeClubId === row.clubId ? f.awayScore : f.homeScore;
        points += own > other ? win : own === other ? draw : loss;
        gd += own - other;
        gf += own;
      }
      return [points, gd, gf];
    };
    const metrics = new Map(group.map((r) => [r.clubId, metric(r)]));
    const compare = (a, b) => {
      const av = metrics.get(a.clubId), bv = metrics.get(b.clubId);
      for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return bv[i] - av[i];
      return 0;
    };
    const ordered = [...group].sort(compare), output = [];
    for (let start = 0; start < ordered.length; ) {
      let end = start + 1;
      while (end < ordered.length && compare(ordered[start], ordered[end]) === 0) end++;
      output.push(...rank(ordered.slice(start, end), index + 1));
      start = end;
    }
    return output;
  }
  return rank(rows, 0).map((row, index) => ({ ...row, position: index + 1 }));
}
var init_standingsProjection = __esm({
  "src/server/tournament/standingsProjection.ts"() {
  }
});

// src/server/tournament/qualificationEngine.ts
var qualificationEngine_exports = {};
__export(qualificationEngine_exports, {
  applyEuropeanQualificationSync: () => applyEuropeanQualificationSync,
  deleteQualificationPreviewToken: () => deleteQualificationPreviewToken,
  evaluateSeasonQualifications: () => evaluateSeasonQualifications,
  evaluateSeasonQualificationsFirestore: () => evaluateSeasonQualificationsFirestore,
  getEuropeanStandings: () => getEuropeanStandings,
  getQualificationPreviewToken: () => getQualificationPreviewToken,
  populateSuperCupParticipants: () => populateSuperCupParticipants,
  previewEuropeanQualificationSync: () => previewEuropeanQualificationSync,
  rebuildEuropeanStandings: () => rebuildEuropeanStandings,
  saveQualificationPreviewToken: () => saveQualificationPreviewToken
});
import crypto from "crypto";
function fingerprintSnapshots(snapshots) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])])) : value;
  const rows = snapshots.map((s) => s.docs.map((d) => ({ id: d.id, data: d.data() })).sort((a, b) => a.id.localeCompare(b.id)));
  return crypto.createHash("sha256").update(JSON.stringify(canonical(rows))).digest("hex");
}
async function saveQualificationPreviewToken(token, preview) {
  const key = `${PREVIEW_TOKEN_REDIS_PREFIX}${token}`;
  const payload = {
    preview,
    token,
    expiresAt: Date.now() + PREVIEW_TOKEN_TTL_SECONDS * 1e3
  };
  const client = getUpstashClient();
  if (client) {
    try {
      await client.set(key, payload, { ex: PREVIEW_TOKEN_TTL_SECONDS });
    } catch (err) {
      console.warn(`[QUALIFICATION] Failed to write preview token to Upstash Redis:`, err?.message || err);
      throw new Error("QUALIFICATION_PREVIEW_STORAGE_UNAVAILABLE");
    }
  } else if (process.env.NODE_ENV === "production" || process.env.VERCEL || process.env.K_SERVICE) {
    throw new Error("REDIS_REQUIRED_FOR_QUALIFICATION_PREVIEW");
  }
  previewTokenCache.set(token, payload);
}
async function getQualificationPreviewToken(token) {
  const key = `${PREVIEW_TOKEN_REDIS_PREFIX}${token}`;
  const client = getUpstashClient();
  if (client) {
    try {
      const data = await client.get(key);
      if (data && data.preview) {
        return data.preview;
      }
    } catch (err) {
      console.warn(`[QUALIFICATION] Failed to read preview token from Upstash Redis:`, err?.message || err);
    }
  }
  const mem = previewTokenCache.get(token);
  if (mem && Date.now() <= mem.expiresAt) {
    return mem.preview;
  }
  return null;
}
async function deleteQualificationPreviewToken(token) {
  const key = `${PREVIEW_TOKEN_REDIS_PREFIX}${token}`;
  previewTokenCache.delete(token);
  const client = getUpstashClient();
  if (client) {
    try {
      await client.del(key);
    } catch {
    }
  }
}
async function previewEuropeanQualificationSync(seasonId = "season-2026-27", mode = "provisional") {
  const db = getFirestoreDb();
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const [compSnap, partsSnap, fixSnap, occSnap] = await Promise.all([
    db.collection(COLLECTIONS.COMPETITIONS).where("seasonId", "==", seasonId).get(),
    db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where("seasonId", "==", seasonId).get(),
    db.collection(COLLECTIONS.FIXTURES).where("seasonId", "==", seasonId).get(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where("seasonId", "==", seasonId).get()
  ]);
  const allComps = compSnap.docs.map((d) => d.data());
  const leagues = allComps.filter((c) => c.type === "LEAGUE");
  const allFixtures = fixSnap.docs.map((d) => d.data());
  const existingParts = partsSnap.docs.map((d) => d.data());
  const occupancyMap = /* @__PURE__ */ new Map();
  for (const doc of occSnap.docs) {
    const data = doc.data();
    if (data.userId && data.clubId) {
      occupancyMap.set(data.clubId, data.userId);
    }
  }
  const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));
  const uclComp = allComps.find(
    (c) => c.type === "EUROPEAN_LEAGUE_PHASE" && (c.name.toLowerCase().includes("champions") || c.id.includes("ucl"))
  ) || { id: "comp-champions-league-2026", name: "UEFA Champions League", seasonId, type: "EUROPEAN_LEAGUE_PHASE" };
  const uelComp = allComps.find(
    (c) => c.type === "EUROPEAN_LEAGUE_PHASE" && (c.name.toLowerCase().includes("europa") || c.id.includes("uel"))
  ) || { id: "comp-europa-league-2026", name: "UEFA Europa League", seasonId, type: "EUROPEAN_LEAGUE_PHASE" };
  const uclTotal = Number(uclComp.formatConfig?.leaguePhaseTeams);
  const uelTotal = Number(uelComp.formatConfig?.leaguePhaseTeams);
  if (!Number.isInteger(uclTotal) || !Number.isInteger(uelTotal) || uclTotal < 2 || uelTotal < 2) throw new Error("EUROPEAN_FORMAT_NOT_CONFIGURED");
  const europeanFixtures = allFixtures.filter(
    (f) => f.competitionId === uclComp.id || f.competitionId === uelComp.id
  );
  const playedEuropeanFixtures = europeanFixtures.filter(
    (f) => f.status !== "SCHEDULED"
  );
  const hasEuropeanStarted = playedEuropeanFixtures.length > 0;
  const leagueIds = new Set(leagues.map((l) => l.id));
  const leagueFixtures = allFixtures.filter((f) => leagueIds.has(f.competitionId));
  const unplayedLeagueMatchesCount = leagueFixtures.filter((f) => f.status !== "CONFIRMED").length;
  const domesticLeaguesCompleted = leagueFixtures.length > 0 && unplayedLeagueMatchesCount === 0;
  let canApply = true;
  let blockReason;
  if (hasEuropeanStarted) {
    canApply = false;
    blockReason = `European competitions have already started (${playedEuropeanFixtures.length} played/in-progress matches). Participant synchronization is strictly blocked to protect active competition integrity.`;
  } else if (mode === "final" && !domesticLeaguesCompleted) {
    canApply = false;
    blockReason = `Domestic leagues are not finished (${unplayedLeagueMatchesCount} unconfirmed fixtures remaining). Final European qualification sync can only be applied after all domestic league matches are confirmed.`;
  }
  const projectedUcl = [];
  const projectedUel = [];
  for (const league of leagues) {
    const standings = projectStandings(SEED_CLUBS.filter((c) => c.leagueId === league.leagueId), allFixtures.filter((f) => f.competitionId === league.id), league.formatConfig);
    if (standings.length === 0) continue;
    const uclConfig = uclComp.formatConfig;
    const uelConfig = uelComp.formatConfig;
    const leagueConfig = league.formatConfig;
    const uclSpots = Number(uclConfig?.qualificationSlots?.[league.id] ?? leagueConfig?.qualificationSpots);
    const uelSpots = Number(uelConfig?.qualificationSlots?.[league.id] ?? leagueConfig?.europaQualificationSpots ?? leagueConfig?.qualificationSpots);
    if (!Number.isInteger(uclSpots) || !Number.isInteger(uelSpots) || uclSpots < 0 || uelSpots < 0 || uclSpots + uelSpots > standings.length) {
      throw new Error(`QUALIFICATION_ALLOCATION_INVALID: ${league.id}`);
    }
    for (let i = 0; i < Math.min(uclSpots, standings.length); i++) {
      const row = standings[i];
      const ownerUserId = occupancyMap.get(row.clubId) || null;
      projectedUcl.push({
        seasonId,
        sourceCompetitionId: league.id,
        sourceCompetitionName: league.name,
        targetCompetitionId: uclComp.id,
        targetCompetitionName: uclComp.name,
        clubId: row.clubId,
        clubName: row.clubName,
        ownerUserId,
        rank: row.position,
        reason: `${league.name} Rank #${row.position} (UCL Spot)`
      });
    }
    for (let i = uclSpots; i < Math.min(uclSpots + uelSpots, standings.length); i++) {
      const row = standings[i];
      const ownerUserId = occupancyMap.get(row.clubId) || null;
      projectedUel.push({
        seasonId,
        sourceCompetitionId: league.id,
        sourceCompetitionName: league.name,
        targetCompetitionId: uelComp.id,
        targetCompetitionName: uelComp.name,
        clubId: row.clubId,
        clubName: row.clubName,
        ownerUserId,
        rank: row.position,
        reason: `${league.name} Rank #${row.position} (UEL Spot)`
      });
    }
  }
  const existingUclParts = existingParts.filter((p) => p.competitionId === uclComp.id);
  const existingUclClubIds = new Set(existingUclParts.map((p) => p.clubId));
  const projectedUclClubIds = new Set(projectedUcl.map((p) => p.clubId));
  const uclDiff = {
    competitionId: uclComp.id,
    competitionName: uclComp.name,
    totalTarget: uclTotal,
    retained: projectedUcl.filter((p) => existingUclClubIds.has(p.clubId)).map((p) => ({ clubId: p.clubId, clubName: p.clubName, rank: p.rank, sourceLeague: p.sourceCompetitionName })),
    added: projectedUcl.filter((p) => !existingUclClubIds.has(p.clubId)).map((p) => ({ clubId: p.clubId, clubName: p.clubName, rank: p.rank, sourceLeague: p.sourceCompetitionName })),
    removed: existingUclParts.filter((p) => !projectedUclClubIds.has(p.clubId)).map((p) => {
      const club = clubsMap.get(p.clubId);
      return { clubId: p.clubId, clubName: club?.name || p.clubId, previousReason: p.qualificationReason };
    })
  };
  const existingUelParts = existingParts.filter((p) => p.competitionId === uelComp.id);
  const existingUelClubIds = new Set(existingUelParts.map((p) => p.clubId));
  const projectedUelClubIds = new Set(projectedUel.map((p) => p.clubId));
  const uelDiff = {
    competitionId: uelComp.id,
    competitionName: uelComp.name,
    totalTarget: uelTotal,
    retained: projectedUel.filter((p) => existingUelClubIds.has(p.clubId)).map((p) => ({ clubId: p.clubId, clubName: p.clubName, rank: p.rank, sourceLeague: p.sourceCompetitionName })),
    added: projectedUel.filter((p) => !existingUelClubIds.has(p.clubId)).map((p) => ({ clubId: p.clubId, clubName: p.clubName, rank: p.rank, sourceLeague: p.sourceCompetitionName })),
    removed: existingUelParts.filter((p) => !projectedUelClubIds.has(p.clubId)).map((p) => {
      const club = clubsMap.get(p.clubId);
      return { clubId: p.clubId, clubName: club?.name || p.clubId, previousReason: p.qualificationReason };
    })
  };
  const previewToken = `prev-qual-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1e3).toISOString();
  if (projectedUcl.length !== uclTotal || projectedUel.length !== uelTotal) {
    canApply = false;
    blockReason = "QUALIFICATION_TOTAL_MISMATCH: review configured league allocations and competition team counts";
  }
  const preview = {
    sourceFingerprint: fingerprintSnapshots([compSnap, partsSnap, fixSnap, occSnap]),
    previewToken,
    seasonId,
    mode,
    canApply,
    blockReason,
    domesticLeaguesCompleted,
    unplayedLeagueMatchesCount,
    hasEuropeanStarted,
    summary: {
      ucl: {
        totalTarget: uclTotal,
        retainedCount: uclDiff.retained.length,
        addedCount: uclDiff.added.length,
        removedCount: uclDiff.removed.length
      },
      uel: {
        totalTarget: uelTotal,
        retainedCount: uelDiff.retained.length,
        addedCount: uelDiff.added.length,
        removedCount: uelDiff.removed.length
      }
    },
    diff: {
      ucl: uclDiff,
      uel: uelDiff
    },
    projectedQualifications: [...projectedUcl, ...projectedUel],
    generatedAt: nowIso,
    expiresAt
  };
  await saveQualificationPreviewToken(previewToken, preview);
  return preview;
}
async function applyEuropeanQualificationSync(params) {
  if (!params.confirmation) {
    throw new Error("Explicit admin confirmation is required to apply European qualifications sync.");
  }
  const preview = await getQualificationPreviewToken(params.previewToken);
  if (!preview) {
    throw new Error("Preview token is invalid, expired, or was already applied. Please generate a fresh preview before applying.");
  }
  if (!preview.canApply) {
    throw new Error(preview.blockReason || "Cannot apply qualifications sync: preconditions failed.");
  }
  if (!preview.sourceFingerprint || Date.parse(preview.expiresAt) <= Date.now() || params.seasonId && params.seasonId !== preview.seasonId) {
    throw new Error("PREVIEW_EXPIRED_OR_SEASON_MISMATCH: generate a new preview");
  }
  const db = getFirestoreDb();
  const activeEuropeanFixSnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "in", [preview.diff.ucl.competitionId, preview.diff.uel.competitionId]).where("status", "in", ["CONFIRMED", "PLAYING", "IN_PROGRESS", "AWAITING_RESULT", "PENDING_CONFIRMATION", "DISPUTED"]).limit(1).get();
  if (!activeEuropeanFixSnap.empty) {
    throw new Error(
      "Precondition Failed: European competitions have already started with active or confirmed matches. Modifying participants is strictly prohibited."
    );
  }
  if (preview.mode === "final") {
    const unplayedLeaguesSnap = await db.collection(COLLECTIONS.FIXTURES).where("seasonId", "==", preview.seasonId).get();
    const leagueIds = [
      "comp-premier-league-2026",
      "comp-la-liga-2026",
      "comp-serie-a-2026",
      "comp-bundesliga-2026",
      "comp-ligue-1-2026"
    ];
    const unplayedLeagueMatches = unplayedLeaguesSnap.docs.filter(
      (d) => leagueIds.includes(d.data().competitionId) && d.data().status !== "CONFIRMED"
    ).length;
    if (unplayedLeagueMatches > 0) {
      throw new Error(
        `Precondition Failed: Domestic leagues still have ${unplayedLeagueMatches} unplayed scheduled matches. Final qualification sync cannot be applied.`
      );
    }
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const participantsAdded = preview.diff.ucl.added.length + preview.diff.uel.added.length;
  const participantsRemoved = preview.diff.ucl.removed.length + preview.diff.uel.removed.length;
  const notificationsToSend = [];
  await db.runTransaction(async (transaction) => {
    const collections = [COLLECTIONS.COMPETITIONS, COLLECTIONS.COMPETITION_PARTICIPANTS, COLLECTIONS.FIXTURES, COLLECTIONS.CLUB_OCCUPANCIES];
    const snapshots = [];
    for (const collection of collections) snapshots.push(await transaction.get(db.collection(collection).where("seasonId", "==", preview.seasonId)));
    const applicationRef = db.collection("qualification_applications").doc(params.previewToken);
    const application = await transaction.get(applicationRef);
    if (application.exists) throw new Error("PREVIEW_ALREADY_APPLIED");
    if (fingerprintSnapshots(snapshots) !== preview.sourceFingerprint) throw new Error("PREVIEW_DATA_CHANGED: refresh and review the new preview");
    const existing = snapshots[1].docs;
    for (const q of preview.projectedQualifications) {
      const matches = existing.filter((d) => d.data().competitionId === q.targetCompetitionId && d.data().clubId === q.clubId);
      if (matches.length > 1) throw new Error("DUPLICATE_PARTICIPANTS: manual review required");
      const id = matches[0]?.id || `part-${q.targetCompetitionId}-${q.clubId}`;
      transaction.set(db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(id), {
        id,
        seasonId: preview.seasonId,
        competitionId: q.targetCompetitionId,
        clubId: q.clubId,
        ownerUserId: q.ownerUserId,
        sourceCompetitionId: q.sourceCompetitionId,
        sourcePosition: q.rank,
        qualificationReason: q.reason,
        qualificationTimestamp: now,
        createdAt: matches[0]?.data().createdAt || now,
        updatedAt: now
      }, { merge: true });
    }
    for (const diff of [preview.diff.ucl, preview.diff.uel]) {
      for (const removed of diff.removed) {
        const matches = existing.filter((d) => d.data().competitionId === diff.competitionId && d.data().clubId === removed.clubId);
        if (matches.length !== 1) throw new Error("PARTICIPANT_REMOVAL_AMBIGUOUS");
        transaction.delete(db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(matches[0].id));
      }
    }
    transaction.set(applicationRef, { appliedAt: now, adminUserId: params.adminUserId, seasonId: preview.seasonId, sourceFingerprint: preview.sourceFingerprint });
  });
  for (const q of preview.projectedQualifications) {
    try {
      const partId = `part-${q.targetCompetitionId}-${q.clubId}`;
      queryRun(
        `INSERT OR REPLACE INTO competition_participants 
         (id, competition_id, club_id, season_id, owner_user_id, source_competition_id, source_position, qualification_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [partId, q.targetCompetitionId, q.clubId, preview.seasonId, q.ownerUserId, q.sourceCompetitionId, q.rank, q.reason, now]
      );
    } catch {
    }
  }
  for (const diff of [preview.diff.ucl, preview.diff.uel]) {
    for (const removed of diff.removed) {
      try {
        queryRun("DELETE FROM competition_participants WHERE competition_id = ? AND season_id = ? AND club_id = ?", [diff.competitionId, preview.seasonId, removed.clubId]);
      } catch {
      }
    }
  }
  await deleteQualificationPreviewToken(params.previewToken);
  await invalidateDataset(ReadModelKeys.competitions(preview.seasonId));
  for (const compId of [preview.diff.ucl.competitionId, preview.diff.uel.competitionId]) {
    await invalidateDataset(ReadModelKeys.standings(compId, preview.seasonId));
    await invalidateDataset(ReadModelKeys.competitionFixtures(compId, preview.seasonId));
    await invalidateDataset(`european:standings:${compId}:${preview.seasonId}`);
  }
  await Promise.all(
    notificationsToSend.map(
      (n) => createNotification(n.userId, "QUALIFICATION_CONFIRMED", n.title, n.message).catch(() => {
      })
    )
  );
  await createAuditLog(
    params.adminUserId,
    "EUROPEAN_QUALIFICATIONS_SYNCED",
    "SEASON",
    preview.seasonId,
    void 0,
    {
      mode: preview.mode,
      totalQualified: preview.projectedQualifications.length,
      participantsAdded,
      participantsRemoved,
      previewToken: params.previewToken,
      timestamp: now
    },
    void 0,
    params.adminUsername || "admin",
    `Applied European qualification sync (${preview.mode}): ${participantsAdded} added, ${participantsRemoved} removed.`
  ).catch(() => console.warn("[QUALIFICATION] Applied transaction recorded; auxiliary audit unavailable"));
  return {
    success: true,
    message: `Successfully applied European qualifications sync (${preview.mode}): ${participantsAdded} added, ${participantsRemoved} removed.`,
    qualificationsApplied: preview.projectedQualifications.length,
    participantsAdded,
    participantsRemoved
  };
}
async function rebuildEuropeanStandings(competitionId, seasonId = "season-2026-27") {
  const db = getFirestoreDb();
  const [compDoc, partsSnap, fixSnap] = await Promise.all([
    db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get(),
    db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where("competitionId", "==", competitionId).get(),
    db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", competitionId).get()
  ]);
  const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));
  const participants = partsSnap.docs.map((d) => d.data());
  const fixtures = fixSnap.docs.map((d) => d.data());
  let clubIds = participants.map((p) => p.clubId);
  if (clubIds.length === 0) {
    throw new Error("EUROPEAN_PARTICIPANTS_NOT_CONFIGURED");
  }
  clubIds = [...new Set(clubIds)];
  const format = compDoc.data()?.formatConfig;
  const totalTeams = Number(format?.leaguePhaseTeams);
  const directQualifiers = Number(format?.directQualifiers);
  const playoffTeams = Number(format?.playoffTeams);
  if (!Number.isInteger(totalTeams) || totalTeams !== clubIds.length || !Number.isInteger(directQualifiers) || !Number.isInteger(playoffTeams) || directQualifiers + playoffTeams > totalTeams) {
    throw new Error("EUROPEAN_FORMAT_PARTICIPANTS_MISMATCH");
  }
  const statsMap = /* @__PURE__ */ new Map();
  for (const cid of clubIds) {
    const club = clubsMap.get(cid);
    statsMap.set(cid, {
      clubId: cid,
      clubName: club?.name || cid,
      badgeUrl: club?.logoUrl,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0
    });
  }
  for (const f of fixtures) {
    if (f.status !== "CONFIRMED" || !Number.isInteger(f.homeScore) || !Number.isInteger(f.awayScore) || f.homeScore < 0 || f.awayScore < 0) continue;
    if (f.seasonId !== seasonId || !f.homeClubId || !f.awayClubId) continue;
    if (/quarter|semi|final|play.?off|round of|knockout/i.test(f.roundName || "") || /-r[1-5]-m/.test(f.id)) continue;
    const home = statsMap.get(f.homeClubId);
    const away = statsMap.get(f.awayClubId);
    if (home) {
      home.played += 1;
      home.goalsFor += f.homeScore;
      home.goalsAgainst += f.awayScore;
      home.goalDifference = home.goalsFor - home.goalsAgainst;
      if (f.homeScore > f.awayScore) {
        home.won += 1;
        home.points += 3;
      } else if (f.homeScore === f.awayScore) {
        home.drawn += 1;
        home.points += 1;
      } else {
        home.lost += 1;
      }
    }
    if (away) {
      away.played += 1;
      away.goalsFor += f.awayScore;
      away.goalsAgainst += f.homeScore;
      away.goalDifference = away.goalsFor - away.goalsAgainst;
      if (f.awayScore > f.homeScore) {
        away.won += 1;
        away.points += 3;
      } else if (f.homeScore === f.awayScore) {
        away.drawn += 1;
        away.points += 1;
      } else {
        away.lost += 1;
      }
    }
  }
  const sorted = Array.from(statsMap.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.clubName.localeCompare(b.clubName);
  });
  const rows = sorted.map((s, idx) => {
    const position = idx + 1;
    let zone = "ELIMINATED";
    let zoneLabel = "Eliminated";
    if (position <= directQualifiers) {
      zone = "DIRECT_R16";
      zoneLabel = "Round of 16 (Direct Qualification)";
    } else if (position <= directQualifiers + playoffTeams) {
      zone = "KNOCKOUT_PLAYOFF";
      zoneLabel = "Knockout Play-offs";
    }
    return {
      position,
      clubId: s.clubId,
      clubName: s.clubName,
      shortName: clubsMap.get(s.clubId)?.shortName || s.clubName,
      logoUrl: s.badgeUrl,
      form: [],
      badgeUrl: s.badgeUrl,
      played: s.played,
      won: s.won,
      drawn: s.drawn,
      lost: s.lost,
      goalsFor: s.goalsFor,
      goalsAgainst: s.goalsAgainst,
      goalDifference: s.goalDifference,
      points: s.points,
      zone,
      zoneLabel
    };
  });
  const cacheKey = ReadModelKeys.standings(competitionId, seasonId);
  await redisSetRaw(
    cacheKey,
    {
      data: rows,
      schemaVersion: SCHEMA_VERSION,
      sourceVersion: "rebuild-european-standings",
      expectedCount: clubIds.length
    },
    86400
  );
  return rows;
}
async function getEuropeanStandings(competitionId, seasonId = "season-2026-27") {
  const result = await readThroughReadModel({
    key: ReadModelKeys.standings(competitionId, seasonId),
    seasonId,
    firestoreFetcher: () => rebuildEuropeanStandings(competitionId, seasonId),
    validateData: (rows) => Array.isArray(rows) && rows.length > 0
  });
  return { rows: result.data, source: result.source, degraded: Boolean(result.degraded || result.stale) };
}
async function evaluateSeasonQualifications(seasonId = "season-2026-27") {
  const preview = await previewEuropeanQualificationSync(seasonId, "provisional");
  return {
    success: false,
    qualifications: preview.projectedQualifications,
    participantsAdded: 0
  };
}
async function populateSuperCupParticipants(seasonId = "season-2026-27", superCupCompetitionId) {
  const db = getFirestoreDb();
  const SUPER_CUP_MAP = {
    "comp-community-shield-2026": { leagueId: "comp-premier-league-2026", cupId: "comp-fa-cup-2026", name: "FA Community Shield" },
    "comp-supercopa-2026": { leagueId: "comp-la-liga-2026", cupId: "comp-copa-del-rey-2026", name: "Supercopa de Espa\xF1a" },
    "comp-supercoppa-2026": { leagueId: "comp-serie-a-2026", cupId: "comp-coppa-italia-2026", name: "Supercoppa Italiana" },
    "comp-dfl-supercup-2026": { leagueId: "comp-bundesliga-2026", cupId: "comp-dfb-pokal-2026", name: "DFL-Supercup" },
    "comp-trophee-champions-2026": { leagueId: "comp-ligue-1-2026", cupId: "comp-coupe-de-france-2026", name: "Troph\xE9e des Champions" },
    "comp-uefa-super-cup-2026": { leagueId: "comp-champions-league-2026", cupId: "comp-europa-league-2026", name: "UEFA Super Cup" }
  };
  const config = SUPER_CUP_MAP[superCupCompetitionId] || { leagueId: "comp-premier-league-2026", name: "Super Cup" };
  const leagueStandings = await calculateCompetitionStandingsFirestore(config.leagueId);
  const leagueChampion = leagueStandings[0];
  let secondClub = leagueStandings[1] || leagueStandings[0];
  if (config.cupId) {
    try {
      const cupFinalSnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", config.cupId).where("roundName", "==", "Final").get();
      if (!cupFinalSnap.empty) {
        const finalMatch = cupFinalSnap.docs[0].data();
        if (finalMatch.winnerClubId && finalMatch.winnerClubId !== leagueChampion?.clubId) {
          const cDoc = await db.collection(COLLECTIONS.CLUBS).doc(finalMatch.winnerClubId).get();
          if (cDoc.exists) {
            secondClub = {
              clubId: finalMatch.winnerClubId,
              clubName: cDoc.data()?.name || finalMatch.winnerClubId
            };
          }
        }
      }
    } catch {
    }
  }
  const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));
  const champClub = leagueChampion ? clubsMap.get(leagueChampion.clubId) || { id: leagueChampion.clubId, name: leagueChampion.clubName } : SEED_CLUBS[0];
  const chalClub = secondClub ? clubsMap.get(secondClub.clubId) || { id: secondClub.clubId, name: secondClub.clubName } : SEED_CLUBS[1];
  const participants = [
    { clubId: champClub.id, clubName: champClub.name, role: "LEAGUE_CHAMPION" },
    { clubId: chalClub.id, clubName: chalClub.name, role: "CUP_CHAMPION_OR_RUNNER_UP" }
  ];
  try {
    const batch = db.batch();
    for (const p of participants) {
      const docRef = db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(`${superCupCompetitionId}_${p.clubId}`);
      batch.set(
        docRef,
        {
          id: `${superCupCompetitionId}_${p.clubId}`,
          competitionId: superCupCompetitionId,
          clubId: p.clubId,
          clubName: p.clubName,
          seasonId,
          qualificationReason: p.role,
          sourceCompetitionId: config.leagueId,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        },
        { merge: true }
      );
    }
    await batch.commit();
  } catch (err) {
    console.warn("[SUPER_CUP] Firestore commit error:", err.message);
  }
  return {
    competitionId: superCupCompetitionId,
    participants
  };
}
var PREVIEW_TOKEN_REDIS_PREFIX, PREVIEW_TOKEN_TTL_SECONDS, previewTokenCache, evaluateSeasonQualificationsFirestore;
var init_qualificationEngine = __esm({
  "src/server/tournament/qualificationEngine.ts"() {
    init_admin();
    init_collections();
    init_firestoreStore();
    init_adminService();
    init_notificationService();
    init_db();
    init_seed();
    init_readModelStore();
    init_standingsProjection();
    PREVIEW_TOKEN_REDIS_PREFIX = "qualification:preview:";
    PREVIEW_TOKEN_TTL_SECONDS = 900;
    previewTokenCache = /* @__PURE__ */ new Map();
    evaluateSeasonQualificationsFirestore = evaluateSeasonQualifications;
  }
});

// src/server/readModel/readModelStore.ts
import { Redis } from "@upstash/redis";
function getRawDatasetKey(key) {
  return key.replace(/^efluz:v1:(fresh:|lkg:|dirty:)?/, "").replace(/^efluz:v1:/, "");
}
function getFreshKey(datasetKey) {
  const clean = getRawDatasetKey(datasetKey);
  return `${KEY_PREFIX}:fresh:${clean}`;
}
function getLkgKey(datasetKey) {
  const clean = getRawDatasetKey(datasetKey);
  return `${KEY_PREFIX}:lkg:${clean}`;
}
function getDirtyKey(datasetKey) {
  const clean = getRawDatasetKey(datasetKey);
  return `${KEY_PREFIX}:dirty:${clean}`;
}
function getUpstashClient() {
  if (upstashClient) return upstashClient;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token && !url.includes("your-upstash-redis-url") && !url.includes("example")) {
    try {
      upstashClient = new Redis({ url, token });
      isUpstashConfigured = true;
      return upstashClient;
    } catch (err) {
      console.warn("[READ_MODEL_STORE] Failed to initialize Upstash Redis client:", err);
    }
  }
  return null;
}
async function redisGetExact(key) {
  const client = getUpstashClient();
  if (client) {
    try {
      const val = await client.get(key);
      if (val && typeof val === "object" && "data" in val) {
        return val;
      }
      return null;
    } catch (err) {
      console.warn(`[READ_MODEL_STORE] Redis get error for key ${key}:`, err?.message || err);
    }
  }
  const entry = memoryRedisStorage.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    memoryRedisStorage.delete(key);
    return null;
  }
  return entry.snapshot;
}
async function redisGetFresh(datasetKey) {
  const freshKey = getFreshKey(datasetKey);
  return redisGetExact(freshKey);
}
async function redisGetLkg(datasetKey) {
  const lkgKey = getLkgKey(datasetKey);
  return redisGetExact(lkgKey);
}
async function redisIsDirty(datasetKey) {
  const dirtyKey = getDirtyKey(datasetKey);
  const client = getUpstashClient();
  if (client) {
    try {
      const exists = await client.exists(dirtyKey);
      if (exists > 0) return true;
    } catch {
    }
  }
  const entry = memoryRedisStorage.get(dirtyKey);
  if (!entry) return false;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    memoryRedisStorage.delete(dirtyKey);
    return false;
  }
  return true;
}
async function redisGetRaw2(key) {
  if (key.includes(":fresh:") || key.includes(":lkg:") || key.includes(":dirty:")) {
    return redisGetExact(key);
  }
  const fresh = await redisGetFresh(key);
  if (fresh && fresh.data !== void 0) {
    const dirty = await redisIsDirty(key);
    if (!dirty) {
      return fresh;
    }
  }
  const lkg = await redisGetLkg(key);
  if (lkg && lkg.data !== void 0) {
    return lkg;
  }
  const legacy = await redisGetExact(key);
  if (legacy) return legacy;
  return null;
}
async function redisSetRaw(datasetKey, snapshot, ttlSeconds = 86400) {
  const cleanKey = getRawDatasetKey(datasetKey);
  const freshKey = getFreshKey(cleanKey);
  const lkgKey = getLkgKey(cleanKey);
  const dirtyKey = getDirtyKey(cleanKey);
  const now = snapshot.generatedAt || (/* @__PURE__ */ new Date()).toISOString();
  globalLastSnapshotAt = now;
  const actualCount = Array.isArray(snapshot.data) ? snapshot.data.length : snapshot.data !== null && snapshot.data !== void 0 ? 1 : 0;
  const fullSnapshot = {
    schemaVersion: snapshot.schemaVersion || SCHEMA_VERSION,
    generatedAt: now,
    sourceVersion: snapshot.sourceVersion || "authoritative",
    expectedCount: snapshot.expectedCount !== void 0 ? snapshot.expectedCount : actualCount,
    actualCount,
    data: snapshot.data
  };
  const client = getUpstashClient();
  if (client) {
    const accepted = await client.eval(`
      local old = redis.call('GET', KEYS[2])
      if old then
        local ok, previous = pcall(cjson.decode, old)
        if ok and tonumber(previous.actualCount or 0) > 0 and tonumber(ARGV[3]) == 0 then return 0 end
        if ok and previous.generatedAt and previous.generatedAt > ARGV[4] then return 0 end
      end
      redis.call('SET', KEYS[2], ARGV[1])
      redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
      redis.call('DEL', KEYS[3])
      return 1
    `, [freshKey, lkgKey, dirtyKey], [JSON.stringify(fullSnapshot), Math.max(1, ttlSeconds), actualCount, now]);
    if (Number(accepted) !== 1) throw new Error(`SNAPSHOT_REJECTED: ${cleanKey}`);
  } else {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL || process.env.K_SERVICE) throw new Error("REDIS_REQUIRED_FOR_DURABLE_SNAPSHOT");
    const previous = await redisGetLkg(cleanKey);
    if (previous && (previous.actualCount > 0 && actualCount === 0 || previous.generatedAt > now)) throw new Error(`SNAPSHOT_REJECTED: ${cleanKey}`);
  }
  memoryRedisStorage.set(freshKey, { snapshot: fullSnapshot, expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1e3 });
  memoryRedisStorage.set(lkgKey, { snapshot: fullSnapshot, expiresAt: null });
  memoryRedisStorage.delete(dirtyKey);
  setInProcessMemory(cleanKey, fullSnapshot);
  setInProcessMemory(freshKey, fullSnapshot);
  setInProcessMemory(lkgKey, fullSnapshot);
}
async function invalidateDataset(datasetKey, targetedRebuild) {
  const cleanKey = getRawDatasetKey(datasetKey);
  const freshKey = getFreshKey(cleanKey);
  const dirtyKey = getDirtyKey(cleanKey);
  inProcessMemoryCache.delete(datasetKey);
  inProcessMemoryCache.delete(cleanKey);
  inProcessMemoryCache.delete(freshKey);
  inProcessMemoryCache.delete(`${KEY_PREFIX}:${cleanKey}`);
  const client = getUpstashClient();
  if (client) {
    try {
      await client.del(freshKey);
      await client.set(dirtyKey, { markedAt: (/* @__PURE__ */ new Date()).toISOString() }, { ex: 86400 });
    } catch (err) {
      console.warn(`[READ_MODEL_STORE] Error invalidating fresh key ${freshKey}:`, err?.message || err);
    }
  }
  memoryRedisStorage.delete(freshKey);
  memoryRedisStorage.set(dirtyKey, {
    snapshot: {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      sourceVersion: "dirty",
      expectedCount: 0,
      actualCount: 0,
      data: true
    },
    expiresAt: Date.now() + 864e5
  });
  if (targetedRebuild) {
    try {
      await targetedRebuild();
      if (client) {
        try {
          await client.del(dirtyKey);
        } catch {
        }
      }
      memoryRedisStorage.delete(dirtyKey);
    } catch (err) {
      console.warn(
        `[READ_MODEL_STORE] Targeted rebuild failed for ${cleanKey}; preserving existing LKG snapshot as stale. Cause:`,
        err?.message || err
      );
    }
  }
}
function getFromProcessMemory(key) {
  const cleanKey = getRawDatasetKey(key);
  const entry = inProcessMemoryCache.get(key) || inProcessMemoryCache.get(cleanKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    inProcessMemoryCache.delete(key);
    inProcessMemoryCache.delete(cleanKey);
    return null;
  }
  return entry.data;
}
function setInProcessMemory(key, data, ttlMs = PROCESS_MEMORY_TTL_MS) {
  const cleanKey = getRawDatasetKey(key);
  const entry = { data, expiresAt: Date.now() + ttlMs };
  inProcessMemoryCache.set(key, entry);
  if (cleanKey !== key) {
    inProcessMemoryCache.set(cleanKey, entry);
  }
}
function compareAdminFixtures(a, b, singleCompetition = false) {
  if (!singleCompetition) {
    const orderA = CANONICAL_COMPETITION_ORDER[a.competitionId] ?? 999;
    const orderB = CANONICAL_COMPETITION_ORDER[b.competitionId] ?? 999;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
  }
  const mdA = typeof a.matchday === "number" ? a.matchday : parseInt(String(a.matchday || 0), 10) || 0;
  const mdB = typeof b.matchday === "number" ? b.matchday : parseInt(String(b.matchday || 0), 10) || 0;
  if (mdA !== mdB) {
    return mdA - mdB;
  }
  const timeA = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
  const timeB = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
  if (timeA !== timeB) {
    return timeA - timeB;
  }
  return (a.id || "").localeCompare(b.id || "");
}
function encodeFixtureCursor(fixture) {
  const compOrder = CANONICAL_COMPETITION_ORDER[fixture.competitionId] ?? 999;
  const matchday = typeof fixture.matchday === "number" ? fixture.matchday : parseInt(String(fixture.matchday || 0), 10) || 0;
  const scheduledAt = fixture.scheduledAt || "";
  const id = fixture.id;
  const tuple = {
    competitionOrder: compOrder,
    matchday,
    scheduledAt,
    id
  };
  return Buffer.from(JSON.stringify(tuple)).toString("base64url");
}
function decodeFixtureCursor(cursorStr) {
  try {
    const raw = Buffer.from(cursorStr, "base64url").toString("utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "string") {
      return parsed;
    }
  } catch {
  }
  return null;
}
async function readThroughReadModel(options) {
  const { key, ttlSeconds = 86400, expectedCount, firestoreFetcher, validateData } = options;
  const cleanKey = getRawDatasetKey(key);
  const canQueryFirestore = firestoreCircuitBreaker.canExecute();
  const isDirty = await redisIsDirty(cleanKey);
  const memoryHit = getFromProcessMemory(cleanKey);
  if (!isDirty && memoryHit && memoryHit.data !== void 0 && Date.now() - Date.parse(memoryHit.generatedAt) < ttlSeconds * 1e3) {
    if (!canQueryFirestore) {
      return {
        data: memoryHit.data,
        source: "memory_stale",
        generatedAt: memoryHit.generatedAt,
        sourceVersion: memoryHit.sourceVersion,
        stale: true,
        degraded: true
      };
    }
    return {
      data: memoryHit.data,
      source: "memory",
      generatedAt: memoryHit.generatedAt,
      sourceVersion: memoryHit.sourceVersion,
      stale: false,
      degraded: false
    };
  }
  let freshSnapshot = null;
  if (!isDirty) {
    freshSnapshot = await redisGetFresh(cleanKey);
  }
  if (!canQueryFirestore) {
    if (freshSnapshot && freshSnapshot.data !== void 0) {
      setInProcessMemory(cleanKey, freshSnapshot);
      return {
        data: freshSnapshot.data,
        source: "redis_fresh",
        generatedAt: freshSnapshot.generatedAt,
        sourceVersion: freshSnapshot.sourceVersion,
        stale: true,
        degraded: true
      };
    }
    const lkgSnapshot = await redisGetLkg(cleanKey);
    if (lkgSnapshot && lkgSnapshot.data !== void 0) {
      setInProcessMemory(cleanKey, lkgSnapshot);
      return {
        data: lkgSnapshot.data,
        source: "redis_stale",
        generatedAt: lkgSnapshot.generatedAt,
        sourceVersion: lkgSnapshot.sourceVersion,
        stale: true,
        degraded: true
      };
    }
    throw new ReadModelNotWarmedError(
      `Firestore circuit breaker is OPEN and no warmed Redis snapshot exists for key: ${key}`
    );
  }
  if (freshSnapshot && freshSnapshot.data !== void 0) {
    const ageMs = Date.now() - new Date(freshSnapshot.generatedAt).getTime();
    if (ageMs < ttlSeconds * 1e3) {
      setInProcessMemory(cleanKey, freshSnapshot);
      return {
        data: freshSnapshot.data,
        source: "redis_fresh",
        generatedAt: freshSnapshot.generatedAt,
        sourceVersion: freshSnapshot.sourceVersion,
        stale: false,
        degraded: false
      };
    }
  }
  let loader = inFlightLoaders.get(cleanKey);
  if (!loader) {
    loader = (async () => {
      try {
        const freshData = await firestoreFetcher();
        const isValid = validateData ? validateData(freshData) : Boolean(freshData);
        if (!isValid) {
          throw new Error(`Fetched Firestore data failed validation for key ${key}`);
        }
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const actualCount = Array.isArray(freshData) ? freshData.length : freshData ? 1 : 0;
        const snapshot = {
          schemaVersion: SCHEMA_VERSION,
          generatedAt: now,
          sourceVersion: options.sourceVersion || "firestore-authoritative",
          expectedCount: expectedCount ?? actualCount,
          actualCount,
          data: freshData
        };
        await redisSetRaw(cleanKey, snapshot, ttlSeconds);
        firestoreCircuitBreaker.recordSuccess();
        return freshData;
      } catch (err) {
        firestoreCircuitBreaker.recordFailure(err);
        throw err;
      } finally {
        inFlightLoaders.delete(cleanKey);
      }
    })();
    inFlightLoaders.set(cleanKey, loader);
  }
  try {
    const resultData = await loader;
    return {
      data: resultData,
      source: "firestore",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      sourceVersion: options.sourceVersion || "firestore-authoritative",
      stale: false,
      degraded: false
    };
  } catch (firestoreErr) {
    const lkgSnapshot = await redisGetLkg(cleanKey);
    if (lkgSnapshot && lkgSnapshot.data !== void 0) {
      console.warn(
        `[READ_MODEL] Firestore failed for ${key}, serving stale Redis LKG snapshot. Cause:`,
        firestoreErr?.message || firestoreErr
      );
      setInProcessMemory(cleanKey, lkgSnapshot);
      return {
        data: lkgSnapshot.data,
        source: "redis_stale",
        generatedAt: lkgSnapshot.generatedAt,
        sourceVersion: lkgSnapshot.sourceVersion,
        stale: true,
        degraded: true
      };
    }
    console.error(`[READ_MODEL] Both Firestore and Redis unavailable for key: ${key}. Error:`, firestoreErr);
    throw new ReadModelNotWarmedError(
      `Failed to load authoritative data from Firestore and no Redis snapshot is available for key: ${key}`
    );
  }
}
async function buildCompetitionsSnapshot(seasonId = "season-2026-27") {
  const db = getFirestoreDb();
  if (!db) throw new ReadModelNotWarmedError("Firestore unavailable for competition refresh");
  const docs = await db.collection(COLLECTIONS.COMPETITIONS).where("seasonId", "==", seasonId).get();
  const competitions = docs.docs.map((d) => {
    const data = d.data();
    const seed = SEED_COMPETITIONS.find((c) => c.id === d.id);
    return { ...seed, ...data, id: d.id, seasonId };
  }).filter((c) => !c.id.includes("efl-cup") && String(c.status) !== "inactive" && !c.hidden);
  if (!competitions.length) throw new ReadModelNotWarmedError("No authoritative competition catalog");
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    sourceVersion: "firestore-catalog",
    expectedCount: competitions.length,
    actualCount: competitions.length,
    data: competitions
  };
  await redisSetRaw(ReadModelKeys.competitions(seasonId), snapshot, 3600);
  return snapshot;
}
async function buildClubsSnapshot(seasonId = "season-2026-27") {
  const occMap = /* @__PURE__ */ new Map();
  const userMap = /* @__PURE__ */ new Map();
  const existingLkg = await redisGetLkg(ReadModelKeys.clubsWithOwners(seasonId));
  let firestoreFailed = false;
  let occupancyDocumentsSeen = 0;
  try {
    const db = getFirestoreDb();
    if (db) {
      const occSnap = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where("seasonId", "==", seasonId).get();
      occupancyDocumentsSeen = occSnap.size;
      for (const doc of occSnap.docs) {
        const data = doc.data();
        if (data.clubId && data.userId && !["released", "inactive"].includes(data.status)) {
          occMap.set(data.clubId, { userId: data.userId });
        }
      }
      if (occMap.size === 0) {
        const broadSnap = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where("seasonId", "==", seasonId).limit(100).get();
        for (const doc of broadSnap.docs) {
          const data = doc.data();
          if (data.clubId && data.userId && data.status !== "released") {
            occMap.set(data.clubId, { userId: data.userId });
          }
        }
      }
      const ownerUserIds = Array.from(new Set(Array.from(occMap.values()).map((o) => o.userId)));
      await Promise.all(
        ownerUserIds.map(async (uid) => {
          try {
            const uDoc = await db.collection(COLLECTIONS.USERS).doc(uid).get();
            if (uDoc.exists) {
              const uData = uDoc.data();
              userMap.set(uid, {
                username: uData?.username || `user_${uid.substring(0, 5)}`
              });
            }
          } catch {
            const previous = existingLkg?.data.find((c) => c.ownerUserId === uid);
            if (previous?.ownerUsername) userMap.set(uid, { username: previous.ownerUsername });
          }
        })
      );
    }
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    firestoreFailed = true;
    console.warn("[READ_MODEL_STORE] Firestore occupancies fetch error in buildClubsSnapshot:", err?.message || err);
  }
  if (firestoreFailed) {
    if (existingLkg && Array.isArray(existingLkg.data) && existingLkg.data.length > 0) {
      throw new ReadModelNotWarmedError("Authoritative refresh unavailable; preserve last-known-good snapshot");
    }
    throw new ReadModelNotWarmedError(
      "READ_MODEL_NOT_WARMED: Firestore club/occupancy read failed and no populated clubs-with-owners LKG exists."
    );
  }
  if (occMap.size === 0 && occupancyDocumentsSeen === 0 && existingLkg && Array.isArray(existingLkg.data) && existingLkg.data.some((c) => c.isOccupied)) {
    console.warn("[READ_MODEL_STORE] Firestore returned 0 occupancies while LKG had active owners; preserving LKG snapshot.");
    throw new ReadModelNotWarmedError("Authoritative refresh unavailable; preserve last-known-good snapshot");
  }
  const neutralClubs = SEED_CLUBS.map((seed) => {
    const occ = occMap.get(seed.id);
    const ownerUserId = occ ? occ.userId : null;
    const userDetail = ownerUserId ? userMap.get(ownerUserId) : null;
    const isOccupied = Boolean(ownerUserId);
    return {
      id: seed.id,
      name: seed.name,
      shortName: seed.shortName,
      country: seed.country,
      leagueId: seed.leagueId,
      logoUrl: seed.logoUrl,
      active: true,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ownerUserId,
      ownerUsername: userDetail?.username || null,
      claimedByUserId: ownerUserId,
      claimedByUsername: userDetail?.username || null,
      managerUserId: ownerUserId,
      managerUsername: userDetail?.username || null,
      isClaimed: isOccupied,
      isAvailable: !isOccupied,
      isOccupied,
      isTaken: isOccupied,
      occupancy: {
        status: isOccupied ? "occupied" : "available",
        userId: ownerUserId || void 0,
        username: userDetail?.username || void 0
      }
    };
  });
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    sourceVersion: `occupancies-${occMap.size}`,
    expectedCount: 96,
    actualCount: neutralClubs.length,
    data: neutralClubs
  };
  const key = ReadModelKeys.clubsWithOwners(seasonId);
  await redisSetRaw(key, snapshot, 86400);
  for (const league of SEED_LEAGUES) {
    const leagueClubs = neutralClubs.filter((c) => c.leagueId === league.id);
    const expectedLeagueCount = league.id.includes("bundesliga") || league.id.includes("ligue-1") ? 18 : 20;
    const leagueSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      sourceVersion: `occupancies-${occMap.size}`,
      expectedCount: expectedLeagueCount,
      actualCount: leagueClubs.length,
      data: leagueClubs
    };
    const leagueKey = ReadModelKeys.leagueClubs(league.id, seasonId);
    await redisSetRaw(leagueKey, leagueSnapshot, 86400);
  }
  return snapshot;
}
function enrichClubForUser(club, currentUserId) {
  const isCurrentUserClub = Boolean(currentUserId && club.ownerUserId === currentUserId);
  const isOccupied = Boolean(club.ownerUserId || club.isOccupied || club.isTaken);
  return {
    id: club.id,
    name: club.name,
    shortName: club.shortName,
    country: club.country,
    leagueId: club.leagueId,
    leagueName: club.leagueName,
    logoUrl: club.logoUrl,
    active: club.active,
    stadium: club.stadium,
    createdAt: club.createdAt,
    ownerUserId: club.ownerUserId,
    ownerUsername: club.ownerUsername,
    isOccupied,
    owner: club.owner ? {
      userId: club.owner.userId,
      username: club.owner.username,
      firstName: club.owner.firstName,
      claimedAt: club.owner.claimedAt
    } : void 0,
    isCurrentUserClub,
    isTaken: isOccupied,
    claimedByUserId: club.ownerUserId,
    claimedByUsername: club.ownerUsername,
    managerUsername: club.ownerUsername,
    occupancy: {
      status: isCurrentUserClub ? "owned" : isOccupied ? "occupied" : "available",
      userId: club.ownerUserId || void 0,
      username: club.ownerUsername || void 0
    }
  };
}
function normalizeFixtureSnapshot(doc, seasonId = "season-2026-27") {
  const homeClubSeed = SEED_CLUBS.find((c) => c.id === doc.homeClubId);
  const awayClubSeed = SEED_CLUBS.find((c) => c.id === doc.awayClubId);
  return {
    id: doc.id,
    seasonId: doc.seasonId || seasonId,
    competitionId: doc.competitionId,
    competitionName: doc.competitionName || doc.competitionId,
    matchday: doc.matchday,
    roundName: doc.roundName,
    homeClubId: doc.homeClubId && doc.homeClubId !== "TBD" ? doc.homeClubId : null,
    awayClubId: doc.awayClubId && doc.awayClubId !== "TBD" ? doc.awayClubId : null,
    homeClub: doc.homeClubId && doc.homeClubId !== "TBD" ? {
      id: doc.homeClubId,
      name: homeClubSeed?.name || doc.homeClubId,
      shortName: homeClubSeed?.shortName || doc.homeClubId.substring(0, 3).toUpperCase(),
      country: homeClubSeed?.country || "England",
      leagueId: homeClubSeed?.leagueId || "league-premier-league",
      logoUrl: homeClubSeed?.logoUrl || "",
      active: true,
      createdAt: ""
    } : void 0,
    awayClub: doc.awayClubId && doc.awayClubId !== "TBD" ? {
      id: doc.awayClubId,
      name: awayClubSeed?.name || doc.awayClubId,
      shortName: awayClubSeed?.shortName || doc.awayClubId.substring(0, 3).toUpperCase(),
      country: awayClubSeed?.country || "England",
      leagueId: awayClubSeed?.leagueId || "league-premier-league",
      logoUrl: awayClubSeed?.logoUrl || "",
      active: true,
      createdAt: ""
    } : void 0,
    scheduledAt: doc.scheduledAt,
    homeScore: doc.homeScore ?? void 0,
    awayScore: doc.awayScore ?? void 0,
    winnerClubId: doc.winnerClubId ?? void 0,
    status: doc.status || "SCHEDULED",
    resultConfirmedAt: doc.resultConfirmedAt || void 0,
    homeOwnerId: doc.homeOwnerId,
    awayOwnerId: doc.awayOwnerId,
    createdAt: doc.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: doc.updatedAt || doc.createdAt || (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function buildAdminFixturesSnapshot(seasonId = "season-2026-27") {
  const db = getFirestoreDb();
  let fixDocs = [];
  if (db) {
    try {
      const fixSnap = await db.collection(COLLECTIONS.FIXTURES).where("seasonId", "==", seasonId).get();
      fixDocs = fixSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((f) => !f.competitionId.includes("efl-cup"));
    } catch (err) {
      console.warn("[READ_MODEL_STORE] Error fetching fixtures in buildAdminFixturesSnapshot:", err?.message || err);
      const existingLkg = await redisGetLkg(ReadModelKeys.adminFixtures(seasonId));
      if (existingLkg && existingLkg.data) {
        throw new ReadModelNotWarmedError("Authoritative refresh unavailable; preserve last-known-good snapshot");
      }
      throw new ReadModelNotWarmedError("Authoritative fixture read failed and no snapshot exists");
    }
  } else throw new ReadModelNotWarmedError("Firestore unavailable for fixture refresh");
  const fixtures = fixDocs.map((doc) => normalizeFixtureSnapshot(doc, seasonId));
  fixtures.sort((a, b) => compareAdminFixtures(a, b, false));
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    sourceVersion: `fixtures-${fixtures.length}`,
    expectedCount: fixtures.length,
    actualCount: fixtures.length,
    data: fixtures
  };
  const key = ReadModelKeys.adminFixtures(seasonId);
  await redisSetRaw(key, snapshot, 86400);
  const compsSet = new Set(fixtures.map((f) => f.competitionId));
  for (const compId of compsSet) {
    const compFixtures = fixtures.filter((f) => f.competitionId === compId);
    compFixtures.sort((a, b) => compareAdminFixtures(a, b, true));
    const compKey = ReadModelKeys.competitionFixtures(compId, seasonId);
    const compSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      sourceVersion: `fixtures-${compFixtures.length}`,
      expectedCount: compFixtures.length,
      actualCount: compFixtures.length,
      data: compFixtures
    };
    await redisSetRaw(compKey, compSnapshot, 86400);
  }
  return snapshot;
}
function generateZeroValueStandings(competitionId, seasonId = "season-2026-27") {
  const config = DOMESTIC_LEAGUE_CONFIG[competitionId];
  let clubs = config ? SEED_CLUBS.filter((c) => c.leagueId === config.leagueId) : [];
  if (clubs.length === 0) {
    clubs = SEED_CLUBS.slice(0, 20);
  }
  return clubs.map((club, idx) => ({
    position: idx + 1,
    clubId: club.id,
    clubName: club.name,
    shortName: club.shortName,
    logoUrl: club.logoUrl,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    form: [],
    streak: "",
    competitionId,
    seasonId
  }));
}
async function buildStandingsSnapshot(competitionId, seasonId = "season-2026-27") {
  if (["comp-champions-league-2026", "comp-europa-league-2026"].includes(competitionId)) {
    const { rebuildEuropeanStandings: rebuildEuropeanStandings2 } = await Promise.resolve().then(() => (init_qualificationEngine(), qualificationEngine_exports));
    const rows2 = await rebuildEuropeanStandings2(competitionId, seasonId);
    return { schemaVersion: SCHEMA_VERSION, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), sourceVersion: "european-authoritative", expectedCount: rows2.length, actualCount: rows2.length, data: rows2 };
  }
  const config = DOMESTIC_LEAGUE_CONFIG[competitionId];
  const expectedCount = config ? config.expectedCount : 20;
  const key = ReadModelKeys.standings(competitionId, seasonId);
  const existingLkg = await redisGetLkg(key);
  let rows = [];
  let firestoreFailed = false;
  try {
    const db = getFirestoreDb();
    if (db) {
      const stdDoc = await db.collection(COLLECTIONS.STANDINGS).doc(competitionId).get();
      if (stdDoc.exists) {
        const data = stdDoc.data();
        if (Array.isArray(data?.rows) && data.rows.length > 0) {
          rows = data.rows;
        }
      }
    }
  } catch (err) {
    firestoreFailed = true;
    console.warn(`[READ_MODEL_STORE] Error fetching standings for ${competitionId}:`, err?.message || err);
  }
  if (firestoreFailed) {
    if (existingLkg && Array.isArray(existingLkg.data) && existingLkg.data.length > 0) {
      throw new ReadModelNotWarmedError("Authoritative refresh unavailable; preserve last-known-good snapshot");
    }
    throw new ReadModelNotWarmedError(
      `READ_MODEL_NOT_WARMED: Firestore standings retrieval failed for ${competitionId} and no valid LKG snapshot exists.`
    );
  }
  if (rows.length === 0) {
    if (existingLkg && Array.isArray(existingLkg.data) && existingLkg.data.length > 0) {
      throw new ReadModelNotWarmedError("Authoritative refresh unavailable; preserve last-known-good snapshot");
    }
    let hasConfirmedFixtures = false;
    try {
      const db = getFirestoreDb();
      if (db) {
        const fixSnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", competitionId).where("status", "==", "CONFIRMED").limit(1).get();
        hasConfirmedFixtures = !fixSnap.empty;
      } else {
        throw new Error("Firestore unavailable: cannot verify empty standings");
      }
    } catch (error) {
      throw error;
    }
    if (!hasConfirmedFixtures && config) {
      rows = generateZeroValueStandings(competitionId, seasonId);
    } else if (hasConfirmedFixtures) {
      throw new Error(
        `Standings for ${competitionId} cannot be zeroed: competition has confirmed fixtures recorded in Firestore.`
      );
    }
  }
  rows.sort((a, b) => a.position - b.position);
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    sourceVersion: `standings-${rows.length}`,
    expectedCount,
    actualCount: rows.length,
    data: rows
  };
  await redisSetRaw(key, snapshot, 86400);
  return snapshot;
}
async function getCompetitionsFromReadModel(seasonId = "season-2026-27") {
  const result = await readThroughReadModel({
    key: ReadModelKeys.competitions(seasonId),
    seasonId,
    expectedCount: 17,
    firestoreFetcher: async () => {
      const snap = await buildCompetitionsSnapshot(seasonId);
      return snap.data;
    },
    validateData: (data) => Array.isArray(data) && data.length > 0
  });
  return {
    competitions: result.data,
    source: result.source,
    stale: Boolean(result.stale),
    degraded: Boolean(result.degraded),
    snapshotAt: result.generatedAt
  };
}
async function getAdminClubsFromReadModel(seasonId = "season-2026-27", leagueId, currentUserId) {
  const result = await readThroughReadModel({
    key: ReadModelKeys.clubsWithOwners(seasonId),
    seasonId,
    expectedCount: 96,
    firestoreFetcher: async () => {
      const snap = await buildClubsSnapshot(seasonId);
      return snap.data;
    },
    validateData: (data) => Array.isArray(data) && data.length > 0
  });
  let clubs = result.data;
  if (leagueId && leagueId !== "ALL") {
    clubs = clubs.filter((c) => c.leagueId === leagueId);
  }
  const adminClubs = clubs.map((c) => {
    const isCurrentUserClub = Boolean(currentUserId && c.ownerUserId === currentUserId);
    return {
      ...c,
      seasonId,
      isOccupied: Boolean(c.ownerUserId),
      occupiedByUserId: c.ownerUserId,
      occupiedByUsername: c.ownerUsername,
      claimedByUserId: c.ownerUserId,
      claimedByUsername: c.ownerUsername,
      managerUserId: c.ownerUserId,
      managerUsername: c.ownerUsername,
      isTaken: Boolean(c.ownerUserId),
      isCurrentUserClub,
      occupancy: {
        status: isCurrentUserClub ? "owned" : c.ownerUserId ? "occupied" : "available",
        userId: c.ownerUserId || void 0,
        username: c.ownerUsername || void 0
      }
    };
  });
  return {
    clubs: adminClubs,
    total: adminClubs.length,
    source: result.source,
    degraded: Boolean(result.degraded),
    stale: Boolean(result.stale),
    snapshotAt: result.generatedAt
  };
}
async function getLeagueClubsFromReadModel(leagueId, seasonId = "season-2026-27", currentUserId) {
  const result = await readThroughReadModel({
    key: ReadModelKeys.clubsWithOwners(seasonId),
    seasonId,
    expectedCount: 96,
    firestoreFetcher: async () => (await buildClubsSnapshot(seasonId)).data,
    validateData: (data) => Array.isArray(data) && data.length > 0
  });
  return {
    clubs: result.data.filter((c) => c.leagueId === leagueId).map((c) => enrichClubForUser(c, currentUserId)),
    source: result.source,
    stale: Boolean(result.stale),
    degraded: Boolean(result.degraded),
    snapshotAt: result.generatedAt
  };
}
async function getAvailableClubsFromReadModel(seasonId = "season-2026-27", currentUserId) {
  const result = await readThroughReadModel({
    key: ReadModelKeys.clubsWithOwners(seasonId),
    seasonId,
    expectedCount: 96,
    firestoreFetcher: async () => {
      const snap = await buildClubsSnapshot(seasonId);
      return snap.data;
    },
    validateData: (data) => Array.isArray(data) && data.length > 0
  });
  const availableClubs = result.data.filter((c) => !c.ownerUserId && !c.isOccupied && !c.isTaken).map((c) => enrichClubForUser(c, currentUserId));
  return {
    clubs: availableClubs,
    source: result.source,
    stale: Boolean(result.stale),
    degraded: Boolean(result.degraded),
    snapshotAt: result.generatedAt
  };
}
async function getClubByIdFromReadModel(clubId, seasonId = "season-2026-27", currentUserId) {
  const result = await readThroughReadModel({
    key: ReadModelKeys.clubsWithOwners(seasonId),
    seasonId,
    expectedCount: 96,
    firestoreFetcher: async () => {
      const snap = await buildClubsSnapshot(seasonId);
      return snap.data;
    },
    validateData: (data) => Array.isArray(data) && data.length > 0
  });
  const neutral = result.data.find((c) => c.id === clubId);
  if (!neutral) {
    return { club: null, source: result.source, stale: Boolean(result.stale), degraded: Boolean(result.degraded) };
  }
  const club = enrichClubForUser(neutral, currentUserId);
  return { club, source: result.source, stale: Boolean(result.stale), degraded: Boolean(result.degraded) };
}
async function getUserActiveClubFromReadModel(userId, seasonId = "season-2026-27") {
  const result = await readThroughReadModel({
    key: ReadModelKeys.clubsWithOwners(seasonId),
    seasonId,
    expectedCount: 96,
    firestoreFetcher: async () => (await buildClubsSnapshot(seasonId)).data,
    validateData: (data) => Array.isArray(data) && data.length > 0
  });
  const owner = result.data.find((c) => (c.ownerUserId || c.claimedByUserId) === userId);
  return owner ? enrichClubForUser(owner, userId) : null;
}
async function getOptionalCurrentClub(userId, seasonId = "season-2026-27") {
  try {
    const currentClub = await getUserActiveClubFromReadModel(userId, seasonId);
    return { currentClub, currentClubStatus: "resolved", degraded: false };
  } catch (error) {
    if (!(error instanceof ReadModelNotWarmedError)) throw error;
    return { currentClub: null, currentClubStatus: "unavailable", degraded: true };
  }
}
async function getCompetitionStandingsFromReadModel(competitionId, seasonId = "season-2026-27") {
  const config = DOMESTIC_LEAGUE_CONFIG[competitionId];
  const expectedCount = config ? config.expectedCount : 20;
  const result = await readThroughReadModel({
    key: ReadModelKeys.standings(competitionId, seasonId),
    seasonId,
    expectedCount,
    firestoreFetcher: async () => {
      const snap = await buildStandingsSnapshot(competitionId, seasonId);
      return snap.data;
    },
    validateData: (rows) => Array.isArray(rows) && rows.length > 0
  });
  return {
    standings: result.data,
    source: result.source,
    stale: Boolean(result.stale),
    degraded: Boolean(result.degraded),
    snapshotAt: result.generatedAt
  };
}
async function getCompetitionFixturesFromReadModel(competitionId, options = {}) {
  const seasonId = options.seasonId || "season-2026-27";
  const result = await readThroughReadModel({
    key: ReadModelKeys.adminFixtures(seasonId),
    seasonId,
    firestoreFetcher: async () => (await buildAdminFixturesSnapshot(seasonId)).data,
    validateData: (data) => Array.isArray(data)
  });
  let fixtures = result.data.filter((f) => f.competitionId === competitionId);
  if (options.matchday !== void 0) fixtures = fixtures.filter((f) => Number(f.matchday) === Number(options.matchday));
  if (options.status && options.status !== "ALL") fixtures = fixtures.filter((f) => f.status === options.status);
  return {
    fixtures: fixtures.sort((a, b) => compareAdminFixtures(a, b, true)),
    source: result.source,
    stale: Boolean(result.stale),
    degraded: Boolean(result.degraded),
    snapshotAt: result.generatedAt
  };
}
async function getAdminFixturesFromReadModel(options = {}) {
  const seasonId = options.seasonId || "season-2026-27";
  const limit = Math.min(Math.max(options.limit || 25, 1), 100);
  const snapshotRes = await readThroughReadModel({
    key: ReadModelKeys.adminFixtures(seasonId),
    seasonId,
    firestoreFetcher: async () => {
      const snap = await buildAdminFixturesSnapshot(seasonId);
      return snap.data;
    },
    validateData: (fixtures) => Array.isArray(fixtures) && fixtures.length > 0
  });
  let allFixtures = [...snapshotRes.data].sort((a, b) => compareAdminFixtures(a, b));
  if (options.competitionId && options.competitionId !== "ALL") {
    allFixtures = allFixtures.filter((f) => f.competitionId === options.competitionId);
  }
  if (options.status && options.status !== "ALL") {
    allFixtures = allFixtures.filter((f) => f.status === options.status);
  }
  if (options.matchday !== void 0) {
    allFixtures = allFixtures.filter((f) => f.matchday === options.matchday);
  }
  if (options.clubId) {
    allFixtures = allFixtures.filter((f) => f.homeClubId === options.clubId || f.awayClubId === options.clubId);
  }
  if (options.search) {
    const q = options.search.toLowerCase();
    allFixtures = allFixtures.filter(
      (f) => f.homeClub?.name.toLowerCase().includes(q) || f.awayClub?.name.toLowerCase().includes(q) || f.roundName?.toLowerCase().includes(q) || f.id.toLowerCase().includes(q)
    );
  }
  const total = allFixtures.length;
  let startIndex = 0;
  if (options.cursor) {
    const tuple = decodeFixtureCursor(options.cursor);
    if (tuple) {
      const foundIdx = allFixtures.findIndex((f) => {
        const order = CANONICAL_COMPETITION_ORDER[f.competitionId] ?? 999;
        if (order !== tuple.competitionOrder) return order > tuple.competitionOrder;
        const matchday = Number(f.matchday) || 0;
        if (matchday !== tuple.matchday) return matchday > tuple.matchday;
        const time = Date.parse(f.scheduledAt) || 0, previous = Date.parse(tuple.scheduledAt) || 0;
        return time !== previous ? time > previous : f.id.localeCompare(tuple.id) > 0;
      });
      startIndex = foundIdx < 0 ? allFixtures.length : foundIdx;
    } else {
      const rawIdx = allFixtures.findIndex((f) => f.id === options.cursor);
      if (rawIdx >= 0) {
        startIndex = rawIdx + 1;
      } else throw Object.assign(new Error("INVALID_FIXTURE_CURSOR"), { statusCode: 400 });
    }
  }
  const pagedFixtures = allFixtures.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < allFixtures.length;
  const nextCursor = hasMore && pagedFixtures.length > 0 ? encodeFixtureCursor(pagedFixtures[pagedFixtures.length - 1]) : void 0;
  return {
    fixtures: pagedFixtures,
    total,
    hasMore,
    nextCursor,
    limit,
    source: snapshotRes.source,
    degraded: snapshotRes.source === "redis_stale",
    stale: snapshotRes.source === "redis_stale",
    generatedAt: snapshotRes.generatedAt
  };
}
async function invalidateClubReadModels(seasonId = "season-2026-27") {
  await invalidateDataset(ReadModelKeys.clubsWithOwners(seasonId));
  for (const l of SEED_LEAGUES) {
    await invalidateDataset(ReadModelKeys.leagueClubs(l.id, seasonId));
  }
  await invalidateDataset(ReadModelKeys.adminFixtures(seasonId));
}
async function refreshChangedFixtureReadModel(fixtureId) {
  const document = await getFirestoreDb().collection(COLLECTIONS.FIXTURES).doc(fixtureId).get();
  if (!document.exists) throw new Error("FIXTURE_NOT_FOUND");
  const fixture = normalizeFixtureSnapshot({ ...document.data(), id: document.id });
  const key = ReadModelKeys.adminFixtures(fixture.seasonId);
  const client = getUpstashClient();
  let patched = false;
  if (client) {
    const result = await client.eval(`
      if redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
      local raw = redis.call('GET', KEYS[2])
      if not raw then return 0 end
      local snapshot = cjson.decode(raw)
      local changed = cjson.decode(ARGV[1])
      for i, row in ipairs(snapshot.data) do
        if row.id == changed.id then
          if row.updatedAt and row.updatedAt > changed.updatedAt then return 1 end
          snapshot.data[i] = changed
          local updated = cjson.encode(snapshot)
          redis.call('SET', KEYS[2], updated)
          local ttl = redis.call('TTL', KEYS[1])
          if ttl > 0 then redis.call('SET', KEYS[1], updated, 'EX', ttl) end
          return 1
        end
      end
      return 0
    `, [getFreshKey(key), getLkgKey(key), getDirtyKey(key)], [JSON.stringify(fixture)]);
    patched = Number(result) === 1;
    inProcessMemoryCache.delete(getRawDatasetKey(key));
    inProcessMemoryCache.delete(key);
    memoryRedisStorage.delete(getFreshKey(key));
    memoryRedisStorage.delete(getLkgKey(key));
  }
  if (!patched) await invalidateDataset(key);
  await invalidateDataset(ReadModelKeys.competitionFixtures(fixture.competitionId, fixture.seasonId));
  await invalidateDataset(ReadModelKeys.standings(fixture.competitionId, fixture.seasonId));
}
async function invalidateFixtureReadModels(competitionId, seasonId = "season-2026-27") {
  await invalidateDataset(ReadModelKeys.adminFixtures(seasonId));
  if (competitionId) {
    await invalidateDataset(ReadModelKeys.competitionFixtures(competitionId, seasonId));
    await invalidateDataset(ReadModelKeys.standings(competitionId, seasonId));
  }
}
async function invalidateUserMembershipReadModel(userId, seasonId = "season-2026-27") {
  await invalidateDataset(ReadModelKeys.userMembership(userId, seasonId));
}
async function rebuildAllReadModels(seasonId = "season-2026-27") {
  const warmedLkgKeys = [];
  const errors = [];
  const standingsPerLeague = {};
  let compCount = 0;
  try {
    const compSnap = await buildCompetitionsSnapshot(seasonId);
    compCount = compSnap.data.length;
    warmedLkgKeys.push(getLkgKey(ReadModelKeys.competitions(seasonId)));
  } catch (err) {
    errors.push(`Competitions rebuild error: ${err.message}`);
  }
  let clubCount = 0;
  try {
    const clubSnap = await buildClubsSnapshot(seasonId);
    clubCount = clubSnap.data.length;
    warmedLkgKeys.push(getLkgKey(ReadModelKeys.clubsWithOwners(seasonId)));
    for (const l of SEED_LEAGUES) {
      warmedLkgKeys.push(getLkgKey(ReadModelKeys.leagueClubs(l.id, seasonId)));
    }
  } catch (err) {
    errors.push(`Clubs rebuild error: ${err.message}`);
  }
  let fixtureCount = 0;
  try {
    const fixSnap = await buildAdminFixturesSnapshot(seasonId);
    fixtureCount = fixSnap.data.length;
    warmedLkgKeys.push(getLkgKey(ReadModelKeys.adminFixtures(seasonId)));
    const uniqueCompIds = Array.from(new Set(fixSnap.data.map((f) => f.competitionId)));
    for (const cId of uniqueCompIds) {
      warmedLkgKeys.push(getLkgKey(ReadModelKeys.competitionFixtures(cId, seasonId)));
    }
  } catch (err) {
    errors.push(`Fixtures rebuild error: ${err.message}`);
  }
  let standingsCount = 0;
  for (const cId of Object.keys(DOMESTIC_LEAGUE_CONFIG)) {
    try {
      const stdSnap = await buildStandingsSnapshot(cId, seasonId);
      standingsCount += stdSnap.data.length;
      standingsPerLeague[DOMESTIC_LEAGUE_CONFIG[cId].name] = stdSnap.data.length;
      warmedLkgKeys.push(getLkgKey(ReadModelKeys.standings(cId, seasonId)));
    } catch (err) {
      errors.push(`Standings rebuild error for ${cId}: ${err.message}`);
    }
  }
  let membershipCount = 0;
  try {
    const db = getFirestoreDb();
    if (db) {
      const occSnap = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where("seasonId", "==", seasonId).where("status", "==", "active").get();
      for (const occDoc of occSnap.docs) {
        const occ = occDoc.data();
        if (occ.userId && occ.clubId) {
          const clubSeed = SEED_CLUBS.find((c) => c.id === occ.clubId);
          const membershipData = {
            hasClub: true,
            clubId: occ.clubId,
            club: clubSeed ? enrichClubForUser(clubSeed, occ.userId) : null
          };
          const memKey = ReadModelKeys.userMembership(occ.userId, seasonId);
          const memSnap = {
            schemaVersion: SCHEMA_VERSION,
            generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
            sourceVersion: `occupancy-${occDoc.id}`,
            expectedCount: 1,
            actualCount: 1,
            data: membershipData
          };
          await redisSetRaw(memKey, memSnap, 86400);
          warmedLkgKeys.push(getLkgKey(memKey));
          membershipCount++;
        }
      }
    }
  } catch (err) {
    errors.push(`User memberships rebuild error: ${err.message}`);
  }
  return {
    success: errors.length === 0,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    warmedLkgKeys,
    warmedKeys: warmedLkgKeys,
    counts: {
      competitions: compCount,
      clubs: clubCount,
      fixtures: fixtureCount,
      standings: standingsCount,
      userMemberships: membershipCount,
      standingsPerLeague
    },
    errors: errors.length > 0 ? errors : void 0
  };
}
async function getReadModelHealthStatus(seasonId = "season-2026-27") {
  const cb = firestoreCircuitBreaker.getStatus();
  let redisState = "IN_MEMORY_FALLBACK";
  const client = getUpstashClient();
  if (client) {
    try {
      const ping = await client.ping();
      redisState = ping === "PONG" || ping ? "CONNECTED" : "ERROR";
    } catch {
      redisState = "ERROR";
    }
  }
  const coreDatasetDefinitions = [
    { name: "competitions", rawKey: ReadModelKeys.competitions(seasonId), expectedCount: 17 },
    { name: "clubs-with-owners", rawKey: ReadModelKeys.clubsWithOwners(seasonId), expectedCount: 96 },
    { name: "admin-fixtures", rawKey: ReadModelKeys.adminFixtures(seasonId), expectedCount: 0 },
    ...SEED_LEAGUES.map((l) => ({
      name: `league-${l.id}-clubs`,
      rawKey: ReadModelKeys.leagueClubs(l.id, seasonId),
      expectedCount: l.id.includes("bundesliga") || l.id.includes("ligue-1") ? 18 : 20
    })),
    ...Object.entries(DOMESTIC_LEAGUE_CONFIG).map(([compId, conf]) => ({
      name: `standings-${conf.name}`,
      rawKey: ReadModelKeys.standings(compId, seasonId),
      expectedCount: conf.expectedCount
    }))
  ];
  const freshKeys = [];
  const lkgKeys = [];
  const dirtyKeys = [];
  const missingKeys = [];
  const coreDatasets = {};
  let newestSnapshotTime = globalLastSnapshotAt;
  for (const def of coreDatasetDefinitions) {
    const cleanKey = getRawDatasetKey(def.rawKey);
    const fresh = await redisGetFresh(cleanKey);
    const lkg = await redisGetLkg(cleanKey);
    const isDirty = await redisIsDirty(cleanKey);
    const hasFresh = Boolean(fresh && fresh.data !== void 0);
    const hasLkg = Boolean(lkg && lkg.data !== void 0);
    if (hasFresh) freshKeys.push(getFreshKey(cleanKey));
    if (hasLkg) lkgKeys.push(getLkgKey(cleanKey));
    if (isDirty) dirtyKeys.push(getDirtyKey(cleanKey));
    if (!hasFresh && !hasLkg) missingKeys.push(cleanKey);
    const snap = fresh || lkg;
    if (snap?.generatedAt) {
      if (!newestSnapshotTime || new Date(snap.generatedAt) > new Date(newestSnapshotTime)) {
        newestSnapshotTime = snap.generatedAt;
      }
    }
    const snapTimestamp = snap?.generatedAt || null;
    const snapAge = snapTimestamp ? Math.floor((Date.now() - new Date(snapTimestamp).getTime()) / 1e3) : null;
    const actualCount = snap?.actualCount ?? 0;
    let status = "MISSING";
    if (hasFresh && !isDirty) {
      status = "FRESH";
    } else if (isDirty) {
      status = "DIRTY";
    } else if (hasLkg) {
      status = "LKG_STALE";
    }
    coreDatasets[def.name] = {
      key: cleanKey,
      expectedCount: def.expectedCount,
      actualCount,
      snapshotTimestamp: snapTimestamp,
      snapshotAgeSeconds: snapAge,
      hasFresh,
      hasLkg,
      isDirty,
      status
    };
  }
  const now = Date.now();
  const snapshotAgeSeconds = newestSnapshotTime ? Math.floor((now - new Date(newestSnapshotTime).getTime()) / 1e3) : null;
  return {
    firestoreState: cb.state,
    redisState,
    circuitBreakerState: {
      state: cb.state,
      consecutiveFailures: cb.consecutiveFailures,
      resourceExhaustedCount: cb.resourceExhaustedCount,
      lastFailureTime: cb.lastFailureTime,
      lastError: cb.lastError
    },
    lastSnapshotAt: newestSnapshotTime,
    snapshotAgeSeconds,
    freshKeys,
    lkgKeys,
    dirtyKeys,
    missingKeys,
    "fresh keys": freshKeys,
    "lkg keys": lkgKeys,
    "dirty keys": dirtyKeys,
    "missing keys": missingKeys,
    warmedKeys: lkgKeys,
    coreDatasets
  };
}
var SCHEMA_VERSION, KEY_PREFIX, ReadModelNotWarmedError, DOMESTIC_LEAGUE_CONFIG, CANONICAL_COMPETITION_ORDER, ReadModelKeys, upstashClient, isUpstashConfigured, memoryRedisStorage, inProcessMemoryCache, PROCESS_MEMORY_TTL_MS, inFlightLoaders, globalLastSnapshotAt;
var init_readModelStore = __esm({
  "src/server/readModel/readModelStore.ts"() {
    init_circuitBreaker();
    init_admin();
    init_collections();
    init_seed();
    SCHEMA_VERSION = "v1";
    KEY_PREFIX = `efluz:${SCHEMA_VERSION}`;
    ReadModelNotWarmedError = class extends Error {
      constructor(message = "Read model is not warmed and authoritative database is temporarily unreachable.") {
        super(message);
        this.errorCode = "READ_MODEL_NOT_WARMED";
        this.statusCode = 503;
        this.status = 503;
        this.name = "ReadModelNotWarmedError";
      }
    };
    DOMESTIC_LEAGUE_CONFIG = {
      "comp-premier-league-2026": { leagueId: "league-premier-league", expectedCount: 20, name: "Premier League" },
      "comp-la-liga-2026": { leagueId: "league-la-liga", expectedCount: 20, name: "La Liga" },
      "comp-serie-a-2026": { leagueId: "league-serie-a", expectedCount: 20, name: "Serie A" },
      "comp-bundesliga-2026": { leagueId: "league-bundesliga", expectedCount: 18, name: "Bundesliga" },
      "comp-ligue-1-2026": { leagueId: "league-ligue-1", expectedCount: 18, name: "Ligue 1" }
    };
    CANONICAL_COMPETITION_ORDER = {
      "comp-premier-league-2026": 1,
      "comp-la-liga-2026": 2,
      "comp-serie-a-2026": 3,
      "comp-bundesliga-2026": 4,
      "comp-ligue-1-2026": 5,
      "comp-fa-cup-2026": 6,
      "comp-copa-del-rey-2026": 7,
      "comp-coppa-italia-2026": 8,
      "comp-dfb-pokal-2026": 9,
      "comp-coupe-de-france-2026": 10,
      "comp-community-shield-2026": 11,
      "comp-supercopa-espana-2026": 12,
      "comp-supercoppa-italiana-2026": 13,
      "comp-dfl-supercup-2026": 14,
      "comp-champions-league-2026": 15,
      "comp-europa-league-2026": 16,
      "comp-uefa-super-cup-2026": 17
    };
    ReadModelKeys = {
      competitions: (seasonId = "season-2026-27") => `${KEY_PREFIX}:season:${seasonId}:competitions`,
      clubsWithOwners: (seasonId = "season-2026-27") => `${KEY_PREFIX}:season:${seasonId}:clubs-with-owners`,
      leagueClubs: (leagueId, seasonId = "season-2026-27") => `${KEY_PREFIX}:season:${seasonId}:league:${leagueId}:clubs`,
      standings: (competitionId, seasonId = "season-2026-27") => `${KEY_PREFIX}:season:${seasonId}:competition:${competitionId}:standings`,
      competitionFixtures: (competitionId, seasonId = "season-2026-27") => `${KEY_PREFIX}:season:${seasonId}:competition:${competitionId}:fixtures`,
      adminFixtures: (seasonId = "season-2026-27") => `${KEY_PREFIX}:season:${seasonId}:admin:fixtures`,
      userMembership: (userId, seasonId = "season-2026-27") => `${KEY_PREFIX}:season:${seasonId}:user:${userId}:membership`
    };
    upstashClient = null;
    isUpstashConfigured = false;
    memoryRedisStorage = /* @__PURE__ */ new Map();
    inProcessMemoryCache = /* @__PURE__ */ new Map();
    PROCESS_MEMORY_TTL_MS = 15e3;
    inFlightLoaders = /* @__PURE__ */ new Map();
    globalLastSnapshotAt = null;
  }
});

// src/server/tournament/standingsEngine.ts
function calculateCompetitionStandings(competitionId) {
  const comp = queryGet(
    "SELECT season_id, format_config_json FROM competitions WHERE id = ?",
    [competitionId]
  );
  const seasonId = comp?.season_id || "season-2026-27";
  let formatConfig = {};
  if (comp?.format_config_json) {
    try {
      formatConfig = JSON.parse(comp.format_config_json);
    } catch {
      formatConfig = {};
    }
  }
  const pointsForWin = formatConfig.pointsForWin ?? 3;
  const pointsForDraw = formatConfig.pointsForDraw ?? 1;
  const pointsForLoss = formatConfig.pointsForLoss ?? 0;
  const tieBreakers = formatConfig.tieBreakers ?? ["points", "goalDifference", "goalsFor", "headToHead"];
  const clubs = queryAll(
    `SELECT c.id, c.name, c.short_name, c.logo_url, u.username as manager_username
     FROM competition_participants cp
     JOIN clubs c ON cp.club_id = c.id
     LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = ? AND cm.status = 'active'
     LEFT JOIN users u ON cm.user_id = u.id
     WHERE cp.competition_id = ?
     ORDER BY c.name ASC`,
    [seasonId, competitionId]
  );
  let clubList = clubs;
  if (clubList.length === 0) {
    clubList = queryAll(
      `SELECT c.id, c.name, c.short_name, c.logo_url, u.username as manager_username
       FROM competitions comp
       JOIN season_league_clubs slc ON comp.league_id = slc.league_id AND comp.season_id = slc.season_id AND slc.is_active = 1
       JOIN clubs c ON slc.club_id = c.id
       LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = comp.season_id AND cm.status = 'active'
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE comp.id = ?
       ORDER BY c.name ASC`,
      [competitionId]
    );
  }
  const confirmedFixtures = queryAll(
    `SELECT id, matchday, home_club_id, away_club_id, home_score, away_score, result_confirmed_at
     FROM fixtures
     WHERE competition_id = ? AND status = 'CONFIRMED' AND home_score IS NOT NULL AND away_score IS NOT NULL
     ORDER BY matchday ASC, result_confirmed_at ASC`,
    [competitionId]
  );
  const statsMap = /* @__PURE__ */ new Map();
  for (const c of clubList) {
    statsMap.set(c.id, {
      clubId: c.id,
      clubName: c.name,
      shortName: c.short_name,
      logoUrl: c.logo_url,
      managerUsername: c.manager_username || void 0,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      form: []
    });
  }
  for (const fix of confirmedFixtures) {
    const home = statsMap.get(fix.home_club_id);
    const away = statsMap.get(fix.away_club_id);
    if (home) {
      home.played += 1;
      home.goalsFor += fix.home_score;
      home.goalsAgainst += fix.away_score;
      if (fix.home_score > fix.away_score) {
        home.won += 1;
        home.points += pointsForWin;
        home.form.push("W");
      } else if (fix.home_score === fix.away_score) {
        home.drawn += 1;
        home.points += pointsForDraw;
        home.form.push("D");
      } else {
        home.lost += 1;
        home.points += pointsForLoss;
        home.form.push("L");
      }
    }
    if (away) {
      away.played += 1;
      away.goalsFor += fix.away_score;
      away.goalsAgainst += fix.home_score;
      if (fix.away_score > fix.home_score) {
        away.won += 1;
        away.points += pointsForWin;
        away.form.push("W");
      } else if (fix.away_score === fix.home_score) {
        away.drawn += 1;
        away.points += pointsForDraw;
        away.form.push("D");
      } else {
        away.lost += 1;
        away.points += pointsForLoss;
        away.form.push("L");
      }
    }
  }
  const rows = Array.from(statsMap.values()).map((row) => {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
    row.form = row.form.slice(-5);
    return row;
  });
  function getH2HPoints(clubAId, clubBId) {
    let pts = 0;
    for (const f of confirmedFixtures) {
      if (f.home_club_id === clubAId && f.away_club_id === clubBId) {
        if (f.home_score > f.away_score) pts += pointsForWin;
        else if (f.home_score === f.away_score) pts += pointsForDraw;
      } else if (f.home_club_id === clubBId && f.away_club_id === clubAId) {
        if (f.away_score > f.home_score) pts += pointsForWin;
        else if (f.away_score === f.home_score) pts += pointsForDraw;
      }
    }
    return pts;
  }
  rows.sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    for (const criteria of tieBreakers) {
      if (criteria === "goalDifference") {
        if (b.goalDifference !== a.goalDifference) {
          return b.goalDifference - a.goalDifference;
        }
      } else if (criteria === "goalsFor") {
        if (b.goalsFor !== a.goalsFor) {
          return b.goalsFor - a.goalsFor;
        }
      } else if (criteria === "headToHead") {
        const h2hA = getH2HPoints(a.clubId, b.clubId);
        const h2hB = getH2HPoints(b.clubId, a.clubId);
        if (h2hB !== h2hA) {
          return h2hB - h2hA;
        }
      }
    }
    return a.clubName.localeCompare(b.clubName);
  });
  return rows.map((r, index) => ({
    position: index + 1,
    clubId: r.clubId,
    clubName: r.clubName,
    shortName: r.shortName,
    logoUrl: r.logoUrl,
    managerUsername: r.managerUsername,
    played: r.played,
    won: r.won,
    drawn: r.drawn,
    lost: r.lost,
    goalsFor: r.goalsFor,
    goalsAgainst: r.goalsAgainst,
    goalDifference: r.goalDifference,
    points: r.points,
    form: r.form
  }));
}
var init_standingsEngine = __esm({
  "src/server/tournament/standingsEngine.ts"() {
    init_db();
  }
});

// src/server/db/sqliteStandings.ts
var sqliteStandings_exports = {};
__export(sqliteStandings_exports, {
  getMaterializedStandingsForCompetition: () => getMaterializedStandingsForCompetition,
  refreshMaterializedStandingsForCompetition: () => refreshMaterializedStandingsForCompetition,
  updateMaterializedStandingsFromFixture: () => updateMaterializedStandingsFromFixture
});
function refreshMaterializedStandingsForCompetition(competitionId) {
  const standings = calculateCompetitionStandings(competitionId);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  dbTransaction(() => {
    queryRun("DELETE FROM competition_standings WHERE competition_id = ?", [competitionId]);
    for (const row of standings) {
      queryRun(
        `INSERT OR REPLACE INTO competition_standings (
          competition_id, club_id, rank, club_name, short_name, logo_url,
          played, won, drawn, lost, goals_for, goals_against, goal_difference,
          points, form_json, qualification_status, manager_username, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          competitionId,
          row.clubId,
          row.position,
          row.clubName,
          row.shortName || "",
          row.logoUrl || "",
          row.played,
          row.won,
          row.drawn,
          row.lost,
          row.goalsFor,
          row.goalsAgainst,
          row.goalDifference,
          row.points,
          JSON.stringify(row.form || []),
          null,
          row.managerUsername || null,
          now
        ]
      );
    }
  });
  return standings;
}
function getMaterializedStandingsForCompetition(competitionId) {
  const rows = queryAll(
    "SELECT * FROM competition_standings WHERE competition_id = ? ORDER BY rank ASC",
    [competitionId]
  );
  if (!rows || rows.length === 0) {
    return refreshMaterializedStandingsForCompetition(competitionId);
  }
  return rows.map((r) => ({
    position: r.rank,
    clubId: r.club_id,
    clubName: r.club_name,
    shortName: r.short_name,
    logoUrl: r.logo_url,
    managerUsername: r.manager_username || void 0,
    played: r.played,
    won: r.won,
    drawn: r.drawn,
    lost: r.lost,
    goalsFor: r.goals_for,
    goalsAgainst: r.goals_against,
    goalDifference: r.goal_difference,
    points: r.points,
    form: r.form_json ? JSON.parse(r.form_json) : []
  }));
}
function updateMaterializedStandingsFromFixture(fixtureId) {
  const fix = queryGet("SELECT competition_id FROM fixtures WHERE id = ?", [fixtureId]);
  if (!fix?.competition_id) {
    return null;
  }
  return refreshMaterializedStandingsForCompetition(fix.competition_id);
}
var init_sqliteStandings = __esm({
  "src/server/db/sqliteStandings.ts"() {
    init_db();
    init_standingsEngine();
  }
});

// src/server/tournament/domesticCupService.ts
var domesticCupService_exports = {};
__export(domesticCupService_exports, {
  DOMESTIC_CUPS: () => DOMESTIC_CUPS,
  advanceDomesticCupWinnerSafe: () => advanceDomesticCupWinnerSafe,
  generateDomesticCupBracketSafe: () => generateDomesticCupBracketSafe,
  getDomesticCupDetails: () => getDomesticCupDetails,
  isDomesticCup: () => isDomesticCup,
  previewDomesticCupBracket: () => previewDomesticCupBracket,
  validateDomesticCupId: () => validateDomesticCupId
});
function isDomesticCup(competitionId) {
  if (competitionId.toLowerCase().includes("efl-cup") || competitionId.toLowerCase().includes("carabao")) {
    return false;
  }
  return Boolean(DOMESTIC_CUPS[competitionId]);
}
function validateDomesticCupId(competitionId) {
  if (competitionId.toLowerCase().includes("efl-cup") || competitionId.toLowerCase().includes("carabao")) {
    throw new Error("EFL Cup is strictly excluded from domestic cup administration.");
  }
  const cup = DOMESTIC_CUPS[competitionId];
  if (!cup) {
    throw new Error(`Invalid domestic cup ID '${competitionId}'. Must be one of: ${Object.keys(DOMESTIC_CUPS).join(", ")}`);
  }
  return cup;
}
async function getDomesticCupDetails(competitionId, seasonId = "season-2026-27") {
  const cupConfig = validateDomesticCupId(competitionId);
  const cacheKey = `cup:bracket:${competitionId}:${seasonId}`;
  const rawLkg = await redisGetRaw2(cacheKey);
  if (rawLkg?.data && (!firestoreCircuitBreaker.canExecute() || rawLkg.data.rounds?.length > 0)) {
    if (!firestoreCircuitBreaker.canExecute()) {
      return {
        ...rawLkg.data,
        source: "redis-lkg",
        degraded: true
      };
    }
  }
  try {
    const db = getFirestoreDb();
    const [compDoc, partSnap, fixSnap, occSnap] = await Promise.all([
      db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get(),
      db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where("competitionId", "==", competitionId).get(),
      db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", competitionId).get(),
      db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where("seasonId", "==", seasonId).get()
    ]);
    const compData = compDoc.exists ? compDoc.data() : null;
    const occupancyUserMap = /* @__PURE__ */ new Map();
    for (const d of occSnap.docs) {
      const occ = d.data();
      if (occ.clubId && occ.userId) {
        occupancyUserMap.set(occ.clubId, occ.userId);
      }
    }
    const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));
    const participants = [];
    if (!partSnap.empty) {
      for (const d of partSnap.docs) {
        const part = d.data();
        const club = clubsMap.get(part.clubId);
        participants.push({
          clubId: part.clubId,
          clubName: club?.name || part.clubId,
          badgeUrl: club?.logoUrl,
          seedNumber: part.seedNumber,
          ownerUserId: part.ownerUserId || occupancyUserMap.get(part.clubId)
        });
      }
    } else {
      const leagueClubs = SEED_CLUBS.filter((c) => c.leagueId === cupConfig.leagueId);
      for (const c of leagueClubs) {
        participants.push({
          clubId: c.id,
          clubName: c.name,
          badgeUrl: c.logoUrl,
          ownerUserId: occupancyUserMap.get(c.id)
        });
      }
    }
    const fixtures = fixSnap.docs.map((d) => d.data());
    const roundMap = /* @__PURE__ */ new Map();
    const getRoundTitle = (md, totalRounds) => {
      if (md === totalRounds) return "Final";
      if (md === totalRounds - 1) return "Semi-Finals";
      if (md === totalRounds - 2) return "Quarter-Finals";
      if (md === totalRounds - 3) return "Round of 16";
      return `Round ${md}`;
    };
    const maxMatchday = Math.max(1, ...fixtures.map((f) => f.matchday || 1));
    for (const f of fixtures) {
      const md = f.matchday || 1;
      const rawHomeId = f.homeClubId;
      const rawAwayId = f.awayClubId;
      const homeClubId = !rawHomeId || rawHomeId === "TBD" ? null : rawHomeId;
      const awayClubId = !rawAwayId || rawAwayId === "TBD" ? null : rawAwayId;
      const homeClub = homeClubId ? clubsMap.get(homeClubId) : null;
      const awayClub = awayClubId ? clubsMap.get(awayClubId) : null;
      const winnerClub = f.winnerClubId ? clubsMap.get(f.winnerClubId) : null;
      const node = {
        id: f.id,
        fixtureId: f.id,
        matchday: md,
        roundName: f.roundName || getRoundTitle(md, maxMatchday),
        homeClubId,
        homeClubName: homeClub?.name || "TBD",
        homeClubBadge: homeClub?.logoUrl,
        awayClubId,
        awayClubName: awayClub?.name || "TBD",
        awayClubBadge: awayClub?.logoUrl,
        status: f.status,
        homeScore: f.homeScore,
        awayScore: f.awayScore,
        homePenaltyScore: f.homePenaltyScore ?? null,
        awayPenaltyScore: f.awayPenaltyScore ?? null,
        winnerClubId: f.winnerClubId,
        winnerClubName: winnerClub?.name,
        scheduledAt: f.scheduledAt,
        resultConfirmedAt: f.resultConfirmedAt || null,
        sourceFixtureId: f.sourceFixtureId || null,
        sourceWinnerSlot: f.sourceWinnerSlot || null,
        homeSourceFixtureId: f.homeSourceFixtureId || null,
        awaySourceFixtureId: f.awaySourceFixtureId || null,
        homeSourceWinnerSlot: f.homeSourceWinnerSlot || null,
        awaySourceWinnerSlot: f.awaySourceWinnerSlot || null
      };
      if (!roundMap.has(md)) {
        roundMap.set(md, []);
      }
      roundMap.get(md).push(node);
    }
    const rounds = Array.from(roundMap.entries()).sort(([a], [b]) => a - b).map(([roundNumber, matches]) => {
      const sortedMatches = matches.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
      const completedCount2 = sortedMatches.filter((m) => m.status === "CONFIRMED").length;
      return {
        roundNumber,
        roundName: sortedMatches[0]?.roundName || `Round ${roundNumber}`,
        matches: sortedMatches,
        fixtures: sortedMatches,
        matchesCount: sortedMatches.length,
        totalMatches: sortedMatches.length,
        completedCount: completedCount2,
        completedMatches: completedCount2
      };
    });
    const completedCount = fixtures.filter((f) => f.status === "CONFIRMED").length;
    const bracketStatus = fixtures.length === 0 ? "NOT_GENERATED" : completedCount === fixtures.length ? "COMPLETED" : "IN_PROGRESS";
    const result = {
      competition: {
        id: competitionId,
        name: compData?.name || cupConfig.name,
        type: compData?.type || "KNOCKOUT",
        seasonId: compData?.seasonId || seasonId,
        status: compData?.status || "active",
        hasFixtures: fixtures.length > 0,
        fixtureCount: fixtures.length,
        fixturesCount: fixtures.length,
        currentMatchday: compData?.currentMatchday || 1,
        isMatchdayOpen: compData?.isMatchdayOpen ?? true,
        nextMatchdayOpenAt: compData?.nextMatchdayOpenAt,
        matchdayOverrideStatus: compData?.adminOverrideStatus
      },
      totalTeams: participants.length,
      totalParticipants: participants.length,
      participantsCount: participants.length,
      expectedTeams: cupConfig.expectedTeams,
      participants,
      rounds,
      fixturesCount: fixtures.length,
      totalFixtures: fixtures.length,
      completedFixturesCount: completedCount,
      completedFixtures: completedCount,
      totalMatches: fixtures.length,
      completedMatches: completedCount,
      bracketStatus,
      currentRound: compData?.currentMatchday || 1,
      currentRoundName: rounds.find((r) => r.roundNumber === (compData?.currentMatchday || 1))?.roundName || "Round 1",
      isMatchdayLocked: !(compData?.isMatchdayOpen ?? true),
      source: "firestore",
      degraded: false
    };
    await redisSetRaw(
      cacheKey,
      {
        data: result,
        schemaVersion: SCHEMA_VERSION,
        sourceVersion: "firestore-authoritative",
        expectedCount: result.rounds.length
      },
      86400
    );
    return result;
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    const compRow = queryGet("SELECT * FROM competitions WHERE id = ?", [competitionId]);
    const fixRows = queryAll(
      "SELECT * FROM fixtures WHERE competition_id = ? ORDER BY matchday ASC, id ASC",
      [competitionId]
    );
    const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));
    const roundMap = /* @__PURE__ */ new Map();
    for (const f of fixRows) {
      const md = f.matchday || 1;
      const rawHomeId = f.home_club_id;
      const rawAwayId = f.away_club_id;
      const homeClubId = !rawHomeId || rawHomeId === "TBD" ? null : rawHomeId;
      const awayClubId = !rawAwayId || rawAwayId === "TBD" ? null : rawAwayId;
      const homeClub = homeClubId ? clubsMap.get(homeClubId) : null;
      const awayClub = awayClubId ? clubsMap.get(awayClubId) : null;
      const winnerClub = f.winner_club_id ? clubsMap.get(f.winner_club_id) : null;
      const node = {
        id: f.id,
        fixtureId: f.id,
        matchday: md,
        roundName: f.round_name || `Round ${md}`,
        homeClubId,
        homeClubName: homeClub?.name || "TBD",
        homeClubBadge: homeClub?.logoUrl,
        awayClubId,
        awayClubName: awayClub?.name || "TBD",
        awayClubBadge: awayClub?.logoUrl,
        status: f.status,
        homeScore: f.home_score,
        awayScore: f.away_score,
        homePenaltyScore: f.home_penalty_score ?? null,
        awayPenaltyScore: f.away_penalty_score ?? null,
        winnerClubId: f.winner_club_id,
        winnerClubName: winnerClub?.name,
        scheduledAt: f.scheduled_at,
        resultConfirmedAt: f.result_confirmed_at,
        sourceFixtureId: f.source_fixture_id || null,
        sourceWinnerSlot: f.source_winner_slot || null
      };
      if (!roundMap.has(md)) roundMap.set(md, []);
      roundMap.get(md).push(node);
    }
    const rounds = Array.from(roundMap.entries()).sort(([a], [b]) => a - b).map(([roundNumber, matches]) => {
      const sorted = matches.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
      const completed = sorted.filter((m) => m.status === "CONFIRMED").length;
      return {
        roundNumber,
        roundName: sorted[0]?.roundName || `Round ${roundNumber}`,
        matches: sorted,
        fixtures: sorted,
        matchesCount: sorted.length,
        totalMatches: sorted.length,
        completedCount: completed,
        completedMatches: completed
      };
    });
    const completedCount = fixRows.filter((f) => f.status === "CONFIRMED").length;
    const bracketStatus = fixRows.length === 0 ? "NOT_GENERATED" : completedCount === fixRows.length ? "COMPLETED" : "IN_PROGRESS";
    return {
      competition: {
        id: competitionId,
        name: compRow?.name || cupConfig.name,
        type: compRow?.type || "KNOCKOUT",
        seasonId: compRow?.season_id || seasonId,
        status: compRow?.status || "active",
        hasFixtures: fixRows.length > 0,
        fixtureCount: fixRows.length,
        fixturesCount: fixRows.length,
        currentMatchday: compRow?.current_matchday || 1,
        isMatchdayOpen: Boolean(compRow?.is_matchday_open ?? 1),
        nextMatchdayOpenAt: compRow?.next_matchday_open_at,
        matchdayOverrideStatus: compRow?.matchday_override_status
      },
      totalTeams: cupConfig.expectedTeams,
      totalParticipants: cupConfig.expectedTeams,
      participantsCount: cupConfig.expectedTeams,
      expectedTeams: cupConfig.expectedTeams,
      participants: SEED_CLUBS.filter((c) => c.leagueId === cupConfig.leagueId).map((c) => ({
        clubId: c.id,
        clubName: c.name,
        badgeUrl: c.logoUrl
      })),
      rounds,
      fixturesCount: fixRows.length,
      totalFixtures: fixRows.length,
      completedFixturesCount: completedCount,
      completedFixtures: completedCount,
      totalMatches: fixRows.length,
      completedMatches: completedCount,
      bracketStatus,
      currentRound: compRow?.current_matchday || 1,
      currentRoundName: rounds.find((r) => r.roundNumber === (compRow?.current_matchday || 1))?.roundName || "Round 1",
      isMatchdayLocked: !Boolean(compRow?.is_matchday_open ?? 1),
      source: "sqlite",
      degraded: true
    };
  }
}
async function previewDomesticCupBracket(competitionId, seasonId = "season-2026-27") {
  const cupConfig = validateDomesticCupId(competitionId);
  const db = getFirestoreDb();
  const existingFixSnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", competitionId).get();
  const existingCount = existingFixSnap.size;
  const leagueClubs = SEED_CLUBS.filter((c) => c.leagueId === cupConfig.leagueId).sort(
    (a, b) => a.name.localeCompare(b.name)
  );
  const clubIds = leagueClubs.map((c) => c.id);
  const totalTeams = clubIds.length;
  const prelimMatches = totalTeams > 16 ? totalTeams - 16 : 0;
  const byeTeamsCount = totalTeams - prelimMatches * 2;
  const pureByeMatches = totalTeams > 16 ? (byeTeamsCount - prelimMatches) / 2 : 8;
  const totalRounds = totalTeams > 16 ? 5 : 4;
  const previewMatches = [];
  const roundsStructured = [];
  if (totalTeams > 16) {
    const r1Matches = [];
    for (let i = 0; i < prelimMatches; i++) {
      const homeClub = leagueClubs[byeTeamsCount + i * 2];
      const awayClub = leagueClubs[byeTeamsCount + i * 2 + 1];
      const m = {
        roundNumber: 1,
        roundName: "Preliminary Round",
        matchIndex: i,
        fixtureId: `fix-${competitionId}-r1-m${i}`,
        homeClubId: homeClub?.id || null,
        homeClubName: homeClub?.name || "TBD",
        awayClubId: awayClub?.id || null,
        awayClubName: awayClub?.name || "TBD",
        homeClub: homeClub ? { id: homeClub.id, name: homeClub.name } : null,
        awayClub: awayClub ? { id: awayClub.id, name: awayClub.name } : null,
        sourceFixtureId: null,
        sourceWinnerSlot: null,
        homeSourceFixtureId: null,
        awaySourceFixtureId: null,
        homeSourceWinnerSlot: null,
        awaySourceWinnerSlot: null
      };
      previewMatches.push(m);
      r1Matches.push(m);
    }
    roundsStructured.push({
      roundNumber: 1,
      roundName: "Preliminary Round",
      matchesCount: r1Matches.length,
      totalMatches: r1Matches.length,
      pairings: r1Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId
      })),
      matches: r1Matches
    });
    const r2Matches = [];
    for (let i = 0; i < 8; i++) {
      let homeId = null;
      let homeName = "TBD";
      let awayId = null;
      let awayName = "TBD";
      let homeClubObj = null;
      let awayClubObj = null;
      let sourceFixtureId = null;
      let sourceWinnerSlot = null;
      let homeSourceFixtureId = null;
      let awaySourceFixtureId = null;
      let homeSourceWinnerSlot = null;
      let awaySourceWinnerSlot = null;
      if (i < pureByeMatches) {
        const homeClub = leagueClubs[i * 2];
        const awayClub = leagueClubs[i * 2 + 1];
        homeId = homeClub?.id || null;
        homeName = homeClub?.name || "TBD";
        awayId = awayClub?.id || null;
        awayName = awayClub?.name || "TBD";
        homeClubObj = homeClub ? { id: homeClub.id, name: homeClub.name } : null;
        awayClubObj = awayClub ? { id: awayClub.id, name: awayClub.name } : null;
      } else {
        const k = i - pureByeMatches;
        const byeClub = leagueClubs[pureByeMatches * 2 + k];
        const srcFixId = `fix-${competitionId}-r1-m${k}`;
        homeId = byeClub?.id || null;
        homeName = byeClub?.name || "TBD";
        awayId = null;
        awayName = `Winner R1-M${k}`;
        homeClubObj = byeClub ? { id: byeClub.id, name: byeClub.name } : null;
        awayClubObj = null;
        sourceFixtureId = srcFixId;
        sourceWinnerSlot = "away";
        awaySourceFixtureId = srcFixId;
        awaySourceWinnerSlot = "away";
      }
      const m = {
        roundNumber: 2,
        roundName: "Round of 16",
        matchIndex: i,
        fixtureId: `fix-${competitionId}-r2-m${i}`,
        homeClubId: homeId,
        homeClubName: homeName,
        awayClubId: awayId,
        awayClubName: awayName,
        homeClub: homeClubObj,
        awayClub: awayClubObj,
        sourceFixtureId,
        sourceWinnerSlot,
        homeSourceFixtureId,
        awaySourceFixtureId,
        homeSourceWinnerSlot,
        awaySourceWinnerSlot
      };
      previewMatches.push(m);
      r2Matches.push(m);
    }
    roundsStructured.push({
      roundNumber: 2,
      roundName: "Round of 16",
      matchesCount: r2Matches.length,
      totalMatches: r2Matches.length,
      pairings: r2Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId
      })),
      matches: r2Matches
    });
    const r3Matches = [];
    for (let mIdx = 0; mIdx < 4; mIdx++) {
      const homeSource = `fix-${competitionId}-r2-m${mIdx * 2}`;
      const awaySource = `fix-${competitionId}-r2-m${mIdx * 2 + 1}`;
      const m = {
        roundNumber: 3,
        roundName: "Quarter-Finals",
        matchIndex: mIdx,
        fixtureId: `fix-${competitionId}-r3-m${mIdx}`,
        homeClubId: null,
        homeClubName: `Winner R2-M${mIdx * 2}`,
        awayClubId: null,
        awayClubName: `Winner R2-M${mIdx * 2 + 1}`,
        homeClub: null,
        awayClub: null,
        sourceFixtureId: homeSource,
        sourceWinnerSlot: "home",
        homeSourceFixtureId: homeSource,
        awaySourceFixtureId: awaySource,
        homeSourceWinnerSlot: "home",
        awaySourceWinnerSlot: "away"
      };
      previewMatches.push(m);
      r3Matches.push(m);
    }
    roundsStructured.push({
      roundNumber: 3,
      roundName: "Quarter-Finals",
      matchesCount: r3Matches.length,
      totalMatches: r3Matches.length,
      pairings: r3Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId
      })),
      matches: r3Matches
    });
    const r4Matches = [];
    for (let mIdx = 0; mIdx < 2; mIdx++) {
      const homeSource = `fix-${competitionId}-r3-m${mIdx * 2}`;
      const awaySource = `fix-${competitionId}-r3-m${mIdx * 2 + 1}`;
      const m = {
        roundNumber: 4,
        roundName: "Semi-Finals",
        matchIndex: mIdx,
        fixtureId: `fix-${competitionId}-r4-m${mIdx}`,
        homeClubId: null,
        homeClubName: `Winner QF-M${mIdx * 2}`,
        awayClubId: null,
        awayClubName: `Winner QF-M${mIdx * 2 + 1}`,
        homeClub: null,
        awayClub: null,
        sourceFixtureId: homeSource,
        sourceWinnerSlot: "home",
        homeSourceFixtureId: homeSource,
        awaySourceFixtureId: awaySource,
        homeSourceWinnerSlot: "home",
        awaySourceWinnerSlot: "away"
      };
      previewMatches.push(m);
      r4Matches.push(m);
    }
    roundsStructured.push({
      roundNumber: 4,
      roundName: "Semi-Finals",
      matchesCount: r4Matches.length,
      totalMatches: r4Matches.length,
      pairings: r4Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId
      })),
      matches: r4Matches
    });
    const r5HomeSource = `fix-${competitionId}-r4-m0`;
    const r5AwaySource = `fix-${competitionId}-r4-m1`;
    const r5Matches = [
      {
        roundNumber: 5,
        roundName: "Final",
        matchIndex: 0,
        fixtureId: `fix-${competitionId}-r5-m0`,
        homeClubId: null,
        homeClubName: "Winner SF-M0",
        awayClubId: null,
        awayClubName: "Winner SF-M1",
        homeClub: null,
        awayClub: null,
        sourceFixtureId: r5HomeSource,
        sourceWinnerSlot: "home",
        homeSourceFixtureId: r5HomeSource,
        awaySourceFixtureId: r5AwaySource,
        homeSourceWinnerSlot: "home",
        awaySourceWinnerSlot: "away"
      }
    ];
    previewMatches.push(r5Matches[0]);
    roundsStructured.push({
      roundNumber: 5,
      roundName: "Final",
      matchesCount: 1,
      totalMatches: 1,
      pairings: r5Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId
      })),
      matches: r5Matches
    });
  } else {
    const r1Matches = [];
    for (let i = 0; i < 8; i++) {
      const homeClub = leagueClubs[i * 2];
      const awayClub = leagueClubs[i * 2 + 1];
      const m = {
        roundNumber: 1,
        roundName: "Round of 16",
        matchIndex: i,
        fixtureId: `fix-${competitionId}-r1-m${i}`,
        homeClubId: homeClub?.id || null,
        homeClubName: homeClub?.name || "TBD",
        awayClubId: awayClub?.id || null,
        awayClubName: awayClub?.name || "TBD",
        homeClub: homeClub ? { id: homeClub.id, name: homeClub.name } : null,
        awayClub: awayClub ? { id: awayClub.id, name: awayClub.name } : null,
        sourceFixtureId: null,
        sourceWinnerSlot: null,
        homeSourceFixtureId: null,
        awaySourceFixtureId: null,
        homeSourceWinnerSlot: null,
        awaySourceWinnerSlot: null
      };
      previewMatches.push(m);
      r1Matches.push(m);
    }
    roundsStructured.push({
      roundNumber: 1,
      roundName: "Round of 16",
      matchesCount: r1Matches.length,
      totalMatches: r1Matches.length,
      pairings: r1Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId
      })),
      matches: r1Matches
    });
    const r2Matches = [];
    for (let mIdx = 0; mIdx < 4; mIdx++) {
      const homeSource = `fix-${competitionId}-r1-m${mIdx * 2}`;
      const awaySource = `fix-${competitionId}-r1-m${mIdx * 2 + 1}`;
      const m = {
        roundNumber: 2,
        roundName: "Quarter-Finals",
        matchIndex: mIdx,
        fixtureId: `fix-${competitionId}-r2-m${mIdx}`,
        homeClubId: null,
        homeClubName: `Winner R1-M${mIdx * 2}`,
        awayClubId: null,
        awayClubName: `Winner R1-M${mIdx * 2 + 1}`,
        homeClub: null,
        awayClub: null,
        sourceFixtureId: homeSource,
        sourceWinnerSlot: "home",
        homeSourceFixtureId: homeSource,
        awaySourceFixtureId: awaySource,
        homeSourceWinnerSlot: "home",
        awaySourceWinnerSlot: "away"
      };
      previewMatches.push(m);
      r2Matches.push(m);
    }
    roundsStructured.push({
      roundNumber: 2,
      roundName: "Quarter-Finals",
      matchesCount: r2Matches.length,
      totalMatches: r2Matches.length,
      pairings: r2Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId
      })),
      matches: r2Matches
    });
    const r3Matches = [];
    for (let mIdx = 0; mIdx < 2; mIdx++) {
      const homeSource = `fix-${competitionId}-r2-m${mIdx * 2}`;
      const awaySource = `fix-${competitionId}-r2-m${mIdx * 2 + 1}`;
      const m = {
        roundNumber: 3,
        roundName: "Semi-Finals",
        matchIndex: mIdx,
        fixtureId: `fix-${competitionId}-r3-m${mIdx}`,
        homeClubId: null,
        homeClubName: `Winner QF-M${mIdx * 2}`,
        awayClubId: null,
        awayClubName: `Winner QF-M${mIdx * 2 + 1}`,
        homeClub: null,
        awayClub: null,
        sourceFixtureId: homeSource,
        sourceWinnerSlot: "home",
        homeSourceFixtureId: homeSource,
        awaySourceFixtureId: awaySource,
        homeSourceWinnerSlot: "home",
        awaySourceWinnerSlot: "away"
      };
      previewMatches.push(m);
      r3Matches.push(m);
    }
    roundsStructured.push({
      roundNumber: 3,
      roundName: "Semi-Finals",
      matchesCount: r3Matches.length,
      totalMatches: r3Matches.length,
      pairings: r3Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId
      })),
      matches: r3Matches
    });
    const r4HomeSource = `fix-${competitionId}-r3-m0`;
    const r4AwaySource = `fix-${competitionId}-r3-m1`;
    const r4Matches = [
      {
        roundNumber: 4,
        roundName: "Final",
        matchIndex: 0,
        fixtureId: `fix-${competitionId}-r4-m0`,
        homeClubId: null,
        homeClubName: "Winner SF-M0",
        awayClubId: null,
        awayClubName: "Winner SF-M1",
        homeClub: null,
        awayClub: null,
        sourceFixtureId: r4HomeSource,
        sourceWinnerSlot: "home",
        homeSourceFixtureId: r4HomeSource,
        awaySourceFixtureId: r4AwaySource,
        homeSourceWinnerSlot: "home",
        awaySourceWinnerSlot: "away"
      }
    ];
    previewMatches.push(r4Matches[0]);
    roundsStructured.push({
      roundNumber: 4,
      roundName: "Final",
      matchesCount: 1,
      totalMatches: 1,
      pairings: r4Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId
      })),
      matches: r4Matches
    });
  }
  const canGenerate = existingCount === 0;
  const blockReason = !canGenerate ? `Competition already has ${existingCount} existing fixtures. Bracket generation is blocked to preserve confirmed results and prevent overwriting production fixtures.` : void 0;
  return {
    competitionId,
    competitionName: cupConfig.name,
    totalTeams,
    totalParticipants: totalTeams,
    prelimMatches,
    byeTeamsCount,
    totalRounds,
    roundsCount: totalRounds,
    existingFixturesCount: existingCount,
    canGenerate,
    blockReason,
    previewMatches,
    rounds: roundsStructured
  };
}
async function generateDomesticCupBracketSafe(competitionId, options) {
  const cupConfig = validateDomesticCupId(competitionId);
  const seasonId = options.seasonId || "season-2026-27";
  if (!options.confirmation) {
    throw new Error("Explicit admin confirmation is required to generate a domestic cup bracket.");
  }
  const db = getFirestoreDb();
  const existingFixSnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", competitionId).get();
  if (!existingFixSnap.empty) {
    throw new Error(
      `Precondition Failed: Competition '${cupConfig.name}' already has ${existingFixSnap.size} existing fixtures. Bracket regeneration is blocked to protect match records. Force overwrite is strictly prohibited.`
    );
  }
  const preview = await previewDomesticCupBracket(competitionId, seasonId);
  if (!preview.canGenerate) {
    throw new Error(preview.blockReason || "Bracket generation preconditions failed.");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const batch = db.batch();
  for (const m of preview.previewMatches) {
    const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(m.fixtureId);
    batch.create(fixRef, {
      id: m.fixtureId,
      seasonId,
      competitionId,
      competitionName: cupConfig.name,
      matchday: m.roundNumber,
      roundName: m.roundName,
      homeClubId: m.homeClubId ?? null,
      awayClubId: m.awayClubId ?? null,
      scheduledAt: now,
      status: "SCHEDULED",
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      sourceFixtureId: m.sourceFixtureId ?? null,
      sourceWinnerSlot: m.sourceWinnerSlot ?? null,
      homeSourceFixtureId: m.homeSourceFixtureId ?? null,
      awaySourceFixtureId: m.awaySourceFixtureId ?? null,
      homeSourceWinnerSlot: m.homeSourceWinnerSlot ?? null,
      awaySourceWinnerSlot: m.awaySourceWinnerSlot ?? null,
      createdAt: now,
      updatedAt: now
    });
  }
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  batch.set(compRef, {
    status: "active",
    hasFixtures: true,
    fixtureCount: preview.previewMatches.length,
    fixturesCount: preview.previewMatches.length,
    generationStatus: "generated",
    updatedAt: now
  }, { merge: true });
  await batch.commit();
  for (const m of preview.previewMatches) {
    try {
      queryRun(
        `INSERT OR IGNORE INTO fixtures (id, season_id, competition_id, matchday, round_name, home_club_id, away_club_id, status, scheduled_at, source_fixture_id, source_winner_slot, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.fixtureId,
          seasonId,
          competitionId,
          m.roundNumber,
          m.roundName,
          m.homeClubId ?? null,
          m.awayClubId ?? null,
          "SCHEDULED",
          now,
          m.sourceFixtureId ?? null,
          m.sourceWinnerSlot ?? null,
          now,
          now
        ]
      );
    } catch {
    }
  }
  await invalidateDataset(`cup:bracket:${competitionId}:${seasonId}`);
  await invalidateFixtureReadModels(competitionId, seasonId);
  await createAuditLog(
    options.adminUserId,
    "CUP_BRACKET_GENERATED",
    "COMPETITION",
    competitionId,
    void 0,
    {
      competitionId,
      competitionName: cupConfig.name,
      generatedFixtures: preview.previewMatches.length,
      totalRounds: preview.totalRounds,
      timestamp: now
    },
    void 0,
    options.adminUsername || "admin",
    `Generated ${preview.previewMatches.length} safe knockout bracket fixtures for ${cupConfig.name}.`
  );
  return {
    success: true,
    generated: preview.previewMatches.length,
    rounds: preview.totalRounds,
    message: `Safely generated ${preview.previewMatches.length} fixtures for ${cupConfig.name} across ${preview.totalRounds} rounds without overwriting existing data.`
  };
}
async function advanceDomesticCupWinnerSafe(fixtureId, options) {
  const db = getFirestoreDb();
  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();
  if (!fixDoc.exists) {
    throw new Error(`Fixture '${fixtureId}' not found.`);
  }
  const fixture = fixDoc.data();
  validateDomesticCupId(fixture.competitionId);
  if (fixture.status !== "CONFIRMED") {
    throw new Error(`Cannot advance knockout winner: match status is '${fixture.status}'. Must be 'CONFIRMED'.`);
  }
  if (!fixture.winnerClubId) {
    throw new Error("Cannot advance knockout winner: no winnerClubId is recorded for this fixture.");
  }
  const winnerClubId = fixture.winnerClubId;
  const compId = fixture.competitionId;
  let targetFixtureId = "";
  let isHomeSlot = true;
  const r1Match = fixture.id.match(/-r1-m(\d+)$/);
  const r2Match = fixture.id.match(/-r2-m(\d+)$/);
  const r3Match = fixture.id.match(/-r3-m(\d+)$/);
  const r4Match = fixture.id.match(/-r4-m(\d+)$/);
  const cupConfigEntry = DOMESTIC_CUPS[compId];
  const expectedTeams = cupConfigEntry?.expectedTeams || (compId.includes("bundesliga") || compId.includes("dfb") || compId.includes("ligue-1") || compId.includes("coupe") ? 18 : 20);
  const is18Teams = expectedTeams === 18;
  const is16Teams = expectedTeams === 16;
  const pureByeMatches = is18Teams ? 6 : 4;
  if (r1Match) {
    const idx = parseInt(r1Match[1], 10);
    if (is16Teams) {
      targetFixtureId = `fix-${compId}-r2-m${Math.floor(idx / 2)}`;
      isHomeSlot = idx % 2 === 0;
    } else {
      const r16Index = pureByeMatches + idx;
      targetFixtureId = `fix-${compId}-r2-m${r16Index}`;
      isHomeSlot = false;
    }
  } else if (r2Match) {
    const idx = parseInt(r2Match[1], 10);
    targetFixtureId = `fix-${compId}-r3-m${Math.floor(idx / 2)}`;
    isHomeSlot = idx % 2 === 0;
  } else if (r3Match) {
    const idx = parseInt(r3Match[1], 10);
    if (is16Teams) {
      targetFixtureId = `fix-${compId}-r4-m0`;
      isHomeSlot = idx === 0;
    } else {
      targetFixtureId = `fix-${compId}-r4-m${Math.floor(idx / 2)}`;
      isHomeSlot = idx % 2 === 0;
    }
  } else if (r4Match) {
    const idx = parseInt(r4Match[1], 10);
    if (is16Teams) {
      return {
        success: true,
        advanced: false,
        message: "This match was the Final. Winner has been crowned champion."
      };
    }
    targetFixtureId = `fix-${compId}-r5-m0`;
    isHomeSlot = idx === 0;
  } else {
    return {
      success: true,
      advanced: false,
      message: "This match was the Final. Winner has been crowned champion."
    };
  }
  const targetRef = db.collection(COLLECTIONS.FIXTURES).doc(targetFixtureId);
  const txResult = await db.runTransaction(async (transaction) => {
    const sourceDoc = await transaction.get(fixRef);
    const source = sourceDoc.data();
    if (!source || source.status !== "CONFIRMED" || source.winnerClubId !== winnerClubId || source.competitionId !== compId || source.seasonId !== fixture.seasonId || ![source.homeClubId, source.awayClubId].includes(winnerClubId)) {
      throw Object.assign(new Error("SOURCE_FIXTURE_CHANGED"), { statusCode: 409 });
    }
    const targetDoc = await transaction.get(targetRef);
    if (!targetDoc.exists) {
      const err = new Error(`Target round fixture '${targetFixtureId}' does not exist.`);
      err.statusCode = 404;
      err.code = "NOT_FOUND";
      throw err;
    }
    const targetFixture = targetDoc.data();
    if (targetFixture.competitionId !== compId || targetFixture.seasonId !== source.seasonId) {
      throw Object.assign(new Error("TARGET_COMPETITION_MISMATCH"), { statusCode: 409 });
    }
    const existingWinner = isHomeSlot ? targetFixture.homeClubId : targetFixture.awayClubId;
    if (existingWinner === winnerClubId) {
      return {
        alreadyAdvanced: true,
        success: true,
        advanced: false,
        isNoop: true,
        targetFixtureId,
        winnerClubId,
        message: "Winner already advanced."
      };
    }
    const protectedStatuses = [
      "PLAYING",
      "IN_PROGRESS",
      "AWAITING_RESULT",
      "PENDING_CONFIRMATION",
      "DISPUTED",
      "CONFIRMED"
    ];
    if (protectedStatuses.includes(targetFixture.status)) {
      const statusErr = new Error(
        `Cannot advance winner: Target round fixture '${targetFixtureId}' has status '${targetFixture.status}'. Matches that are started, submitted, disputed, or confirmed cannot be modified.`
      );
      statusErr.statusCode = 400;
      statusErr.code = "TARGET_MATCH_LOCKED";
      throw statusErr;
    }
    const currentOccupant = isHomeSlot ? targetFixture.homeClubId : targetFixture.awayClubId;
    if (currentOccupant === winnerClubId) {
      return {
        alreadyAdvanced: true,
        success: true,
        advanced: false,
        isNoop: true,
        targetFixtureId,
        winnerClubId,
        message: `Winner '${winnerClubId}' has already been advanced to ${targetFixtureId} as ${isHomeSlot ? "Home" : "Away"} club. Repeated advancement is a no-op.`
      };
    }
    if (currentOccupant && currentOccupant !== winnerClubId && currentOccupant !== "TBD") {
      const conflictErr = new Error(
        `Conflict: Target round fixture '${targetFixtureId}' ${isHomeSlot ? "home" : "away"} slot is already occupied by club '${currentOccupant}', which conflicts with advancing winner '${winnerClubId}'.`
      );
      conflictErr.statusCode = 409;
      conflictErr.code = "TARGET_SLOT_OCCUPIED_CONFLICT";
      throw conflictErr;
    }
    const updatePayload = {
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (isHomeSlot) {
      updatePayload.homeClubId = winnerClubId;
    } else {
      updatePayload.awayClubId = winnerClubId;
    }
    transaction.update(targetRef, updatePayload);
    return {
      alreadyAdvanced: false,
      success: true,
      advanced: true,
      isNoop: false,
      targetFixtureId,
      winnerClubId,
      message: `Advanced ${winnerClubId} to ${targetFixtureId} as ${isHomeSlot ? "Home" : "Away"} club.`
    };
  });
  if (txResult.alreadyAdvanced) {
    return {
      success: true,
      advanced: false,
      isNoop: true,
      targetFixtureId: txResult.targetFixtureId,
      winnerClubId: txResult.winnerClubId,
      message: txResult.message
    };
  }
  try {
    if (isHomeSlot) {
      queryRun("UPDATE fixtures SET home_club_id = ?, updated_at = ? WHERE id = ?", [
        winnerClubId,
        (/* @__PURE__ */ new Date()).toISOString(),
        targetFixtureId
      ]);
    } else {
      queryRun("UPDATE fixtures SET away_club_id = ?, updated_at = ? WHERE id = ?", [
        winnerClubId,
        (/* @__PURE__ */ new Date()).toISOString(),
        targetFixtureId
      ]);
    }
  } catch {
  }
  const cacheKey = `cup:bracket:${compId}:${fixture.seasonId || "season-2026-27"}`;
  await invalidateDataset(cacheKey);
  await refreshChangedFixtureReadModel(targetFixtureId).catch(() => invalidateFixtureReadModels(compId, fixture.seasonId || "season-2026-27"));
  await createAuditLog(
    options.adminUserId,
    "KNOCKOUT_ROUND_ADVANCED",
    "FIXTURE",
    targetFixtureId,
    void 0,
    {
      sourceFixtureId: fixtureId,
      targetFixtureId,
      slot: isHomeSlot ? "home" : "away",
      winnerClubId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    },
    void 0,
    options.adminUsername || "admin",
    `Advanced winner ${winnerClubId} from ${fixtureId} to ${targetFixtureId} (${isHomeSlot ? "home" : "away"}).`
  );
  return {
    success: true,
    advanced: true,
    isNoop: false,
    targetFixtureId,
    winnerClubId,
    message: `Advanced ${winnerClubId} to ${targetFixtureId} as ${isHomeSlot ? "Home" : "Away"} club.`
  };
}
var DOMESTIC_CUPS;
var init_domesticCupService = __esm({
  "src/server/tournament/domesticCupService.ts"() {
    init_admin();
    init_collections();
    init_adminService();
    init_readModelStore();
    init_seed();
    init_db();
    init_firestoreStore();
    DOMESTIC_CUPS = {
      "comp-fa-cup-2026": {
        id: "comp-fa-cup-2026",
        name: "FA Cup",
        country: "England",
        leagueId: "league-premier-league",
        expectedTeams: 20
      },
      "comp-copa-del-rey-2026": {
        id: "comp-copa-del-rey-2026",
        name: "Copa del Rey",
        country: "Spain",
        leagueId: "league-la-liga",
        expectedTeams: 20
      },
      "comp-coppa-italia-2026": {
        id: "comp-coppa-italia-2026",
        name: "Coppa Italia",
        country: "Italy",
        leagueId: "league-serie-a",
        expectedTeams: 20
      },
      "comp-dfb-pokal-2026": {
        id: "comp-dfb-pokal-2026",
        name: "DFB-Pokal",
        country: "Germany",
        leagueId: "league-bundesliga",
        expectedTeams: 18
      },
      "comp-coupe-de-france-2026": {
        id: "comp-coupe-de-france-2026",
        name: "Coupe de France",
        country: "France",
        leagueId: "league-ligue-1",
        expectedTeams: 18
      }
    };
  }
});

// src/server/tournament/knockoutEngine.ts
var knockoutEngine_exports = {};
__export(knockoutEngine_exports, {
  advanceKnockoutWinner: () => advanceKnockoutWinner,
  advanceKnockoutWinnerFirestore: () => advanceKnockoutWinnerFirestore,
  generateKnockoutBracket: () => generateKnockoutBracket,
  generateKnockoutBracketFirestore: () => generateKnockoutBracketFirestore,
  generateUCLKnockoutBracket: () => generateUCLKnockoutBracket,
  generateUCLKnockoutBracketFirestore: () => generateUCLKnockoutBracketFirestore
});
async function generateKnockoutBracket(competitionId, options = {}) {
  const db = getFirestoreDb();
  const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }
  const comp = compDoc.data();
  const existingFixSnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", competitionId).get();
  if (!existingFixSnap.empty) {
    if (options.force) {
      const deleteBatch = db.batch();
      for (const fix of existingFixSnap.docs) {
        deleteBatch.delete(fix.ref);
      }
      await deleteBatch.commit();
    } else {
      return { generated: existingFixSnap.size, rounds: 0 };
    }
  }
  let clubIds = options.participants ? [...options.participants] : [];
  if (clubIds.length === 0) {
    const partSnap = await db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where("competitionId", "==", competitionId).get();
    if (!partSnap.empty) {
      const sortedParts = partSnap.docs.map((d) => d.data()).sort((a, b) => (a.seedNumber ?? 0) - (b.seedNumber ?? 0));
      clubIds = sortedParts.map((p) => p.clubId);
    }
  }
  if (clubIds.length === 0 && comp.leagueId) {
    const leagueClubsSnap = await db.collection(COLLECTIONS.CLUBS).where("leagueId", "==", comp.leagueId).where("isActive", "==", true).get();
    const sorted = leagueClubsSnap.docs.map((d) => d.data()).sort((a, b) => a.name.localeCompare(b.name));
    clubIds = sorted.map((c) => c.id);
  }
  if (clubIds.length < 2) {
    throw new Error(`Cannot generate knockout bracket with fewer than 2 teams (found ${clubIds.length}).`);
  }
  if (comp.type === "EUROPEAN_LEAGUE_PHASE" || comp.type === "EUROPEAN_KNOCKOUT" || competitionId.includes("champions") || competitionId.includes("europa") || competitionId.includes("ucl") || competitionId.includes("uel")) {
    if (clubIds.length >= 24) {
      const standingsSnap = await db.collection(COLLECTIONS.STANDINGS).where("competitionId", "==", competitionId).get();
      let ranked = clubIds;
      if (!standingsSnap.empty) {
        const sortedStandings = standingsSnap.docs.map((d) => d.data()).sort((a, b) => {
          if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
          return (b.goalDifference || 0) - (a.goalDifference || 0);
        });
        ranked = sortedStandings.map((s) => s.clubId);
      }
      const uclRes = await generateUCLKnockoutBracket(competitionId, ranked);
      return { generated: uclRes.generated, rounds: 5 };
    }
  }
  if (isDomesticCup(competitionId)) {
    const { generateDomesticCupBracketSafe: generateDomesticCupBracketSafe2 } = await Promise.resolve().then(() => (init_domesticCupService(), domesticCupService_exports));
    const res = await generateDomesticCupBracketSafe2(competitionId, {
      adminUserId: "system",
      adminUsername: "system",
      confirmation: true,
      seasonId: comp.seasonId
    });
    return { generated: res.generated, rounds: res.rounds };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let totalGenerated = 0;
  let totalRounds = 0;
  const batch = db.batch();
  if (clubIds.length > 16 && clubIds.length < 32) {
    totalRounds = 5;
    const totalTeams = clubIds.length;
    const prelimMatches = totalTeams - 16;
    const prelimTeamsCount = prelimMatches * 2;
    const byeTeamsCount = totalTeams - prelimTeamsCount;
    const prelimPairs = Math.ceil(prelimMatches / 2);
    for (let i = 0; i < prelimMatches; i++) {
      const fixtureId = `fix-${competitionId}-r1-m${i}`;
      const homeClubId = clubIds[byeTeamsCount + i * 2] || null;
      const awayClubId = clubIds[byeTeamsCount + i * 2 + 1] || null;
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
      batch.set(fixRef, {
        id: fixtureId,
        seasonId: comp.seasonId,
        competitionId,
        competitionName: comp.name,
        matchday: 1,
        roundName: "Preliminary Round",
        homeClubId,
        awayClubId,
        scheduledAt: now,
        status: "SCHEDULED",
        homeScore: null,
        awayScore: null,
        winnerClubId: null,
        resultConfirmedAt: null,
        createdAt: now,
        updatedAt: now
      });
      totalGenerated++;
    }
    for (let i = 0; i < 8; i++) {
      const fixtureId = `fix-${competitionId}-r2-m${i}`;
      let homeClubId = null;
      let awayClubId = null;
      if (i >= prelimPairs) {
        const byeIdx = (i - prelimPairs) * 2;
        homeClubId = clubIds[byeIdx] || null;
        awayClubId = clubIds[byeIdx + 1] || null;
      }
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
      batch.set(fixRef, {
        id: fixtureId,
        seasonId: comp.seasonId,
        competitionId,
        competitionName: comp.name,
        matchday: 2,
        roundName: "Round of 16",
        homeClubId,
        awayClubId,
        scheduledAt: now,
        status: "SCHEDULED",
        homeScore: null,
        awayScore: null,
        winnerClubId: null,
        resultConfirmedAt: null,
        createdAt: now,
        updatedAt: now
      });
      totalGenerated++;
    }
    for (let m = 0; m < 4; m++) {
      const fixtureId = `fix-${competitionId}-r3-m${m}`;
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
      batch.set(fixRef, {
        id: fixtureId,
        seasonId: comp.seasonId,
        competitionId,
        competitionName: comp.name,
        matchday: 3,
        roundName: "Quarter-Finals",
        homeClubId: null,
        awayClubId: null,
        scheduledAt: now,
        status: "SCHEDULED",
        homeScore: null,
        awayScore: null,
        winnerClubId: null,
        resultConfirmedAt: null,
        createdAt: now,
        updatedAt: now
      });
      totalGenerated++;
    }
    for (let m = 0; m < 2; m++) {
      const fixtureId = `fix-${competitionId}-r4-m${m}`;
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
      batch.set(fixRef, {
        id: fixtureId,
        seasonId: comp.seasonId,
        competitionId,
        competitionName: comp.name,
        matchday: 4,
        roundName: "Semi-Finals",
        homeClubId: null,
        awayClubId: null,
        scheduledAt: now,
        status: "SCHEDULED",
        homeScore: null,
        awayScore: null,
        winnerClubId: null,
        resultConfirmedAt: null,
        createdAt: now,
        updatedAt: now
      });
      totalGenerated++;
    }
    const finalFixtureId = `fix-${competitionId}-r5-m0`;
    const finalRef = db.collection(COLLECTIONS.FIXTURES).doc(finalFixtureId);
    batch.set(finalRef, {
      id: finalFixtureId,
      seasonId: comp.seasonId,
      competitionId,
      competitionName: comp.name,
      matchday: 5,
      roundName: "Final",
      homeClubId: null,
      awayClubId: null,
      scheduledAt: now,
      status: "SCHEDULED",
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      createdAt: now,
      updatedAt: now
    });
    totalGenerated++;
  } else {
    let bracketSize = 2;
    while (bracketSize < clubIds.length) {
      bracketSize *= 2;
    }
    totalRounds = Math.log2(bracketSize);
    const getRoundName = (roundNum) => {
      const remainingTeams = Math.pow(2, totalRounds - roundNum + 1);
      if (remainingTeams === 2) return "Final";
      if (remainingTeams === 4) return "Semi-Finals";
      if (remainingTeams === 8) return "Quarter-Finals";
      if (remainingTeams === 16) return "Round of 16";
      if (remainingTeams === 32) return "Round of 32";
      return `Round of ${remainingTeams}`;
    };
    const firstRoundMatches = bracketSize / 2;
    for (let i = 0; i < firstRoundMatches; i++) {
      const homeClubId = clubIds[i * 2] || null;
      const awayClubId = clubIds[i * 2 + 1] || null;
      const fixtureId = `fix-${competitionId}-r1-m${i}`;
      const roundName = getRoundName(1);
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
      batch.set(fixRef, {
        id: fixtureId,
        seasonId: comp.seasonId,
        competitionId,
        competitionName: comp.name,
        matchday: 1,
        roundName,
        homeClubId,
        awayClubId,
        scheduledAt: now,
        status: "SCHEDULED",
        homeScore: null,
        awayScore: null,
        winnerClubId: null,
        resultConfirmedAt: null,
        createdAt: now,
        updatedAt: now
      });
      totalGenerated++;
    }
    for (let round = 2; round <= totalRounds; round++) {
      const matchesInRound = Math.pow(2, totalRounds - round);
      const roundName = getRoundName(round);
      for (let m = 0; m < matchesInRound; m++) {
        const fixtureId = `fix-${competitionId}-r${round}-m${m}`;
        const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
        batch.set(fixRef, {
          id: fixtureId,
          seasonId: comp.seasonId,
          competitionId,
          competitionName: comp.name,
          matchday: round,
          roundName,
          homeClubId: null,
          awayClubId: null,
          scheduledAt: now,
          status: "SCHEDULED",
          homeScore: null,
          awayScore: null,
          winnerClubId: null,
          resultConfirmedAt: null,
          createdAt: now,
          updatedAt: now
        });
        totalGenerated++;
      }
    }
  }
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  batch.update(compRef, {
    status: "active",
    hasFixtures: true,
    fixtureCount: totalGenerated,
    fixturesCount: totalGenerated,
    generationStatus: "generated",
    updatedAt: now
  });
  await batch.commit();
  return { generated: totalGenerated, rounds: totalRounds };
}
async function generateUCLKnockoutBracket(competitionId, rankedClubIds) {
  if (rankedClubIds.length < 24) {
    throw new Error(`European Knockout Phase requires at least 24 ranked clubs (found ${rankedClubIds.length}).`);
  }
  const db = getFirestoreDb();
  const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }
  const comp = compDoc.data();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let totalGenerated = 0;
  const batch = db.batch();
  const directQualifiers = rankedClubIds.slice(0, 8);
  const playoffClubs = rankedClubIds.slice(8, 24);
  for (let i = 0; i < 8; i++) {
    const seededClubId = playoffClubs[i];
    const unseededClubId = playoffClubs[15 - i];
    const fixtureId = `fix-${competitionId}-po-m${i}`;
    const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
    batch.set(fixRef, {
      id: fixtureId,
      seasonId: comp.seasonId,
      competitionId,
      competitionName: comp.name,
      matchday: 9,
      roundName: "Knockout Play-offs",
      homeClubId: unseededClubId,
      awayClubId: seededClubId,
      scheduledAt: now,
      status: "SCHEDULED",
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      createdAt: now,
      updatedAt: now
    });
    totalGenerated++;
  }
  for (let i = 0; i < 8; i++) {
    const directClubId = directQualifiers[i];
    const fixtureId = `fix-${competitionId}-r16-m${i}`;
    const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
    batch.set(fixRef, {
      id: fixtureId,
      seasonId: comp.seasonId,
      competitionId,
      competitionName: comp.name,
      matchday: 10,
      roundName: "Round of 16",
      homeClubId: directClubId,
      awayClubId: "TBD",
      scheduledAt: now,
      status: "SCHEDULED",
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      createdAt: now,
      updatedAt: now
    });
    totalGenerated++;
  }
  for (let i = 0; i < 4; i++) {
    const fixtureId = `fix-${competitionId}-qf-m${i}`;
    const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
    batch.set(fixRef, {
      id: fixtureId,
      seasonId: comp.seasonId,
      competitionId,
      competitionName: comp.name,
      matchday: 11,
      roundName: "Quarter-Finals",
      homeClubId: "TBD",
      awayClubId: "TBD",
      scheduledAt: now,
      status: "SCHEDULED",
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      createdAt: now,
      updatedAt: now
    });
    totalGenerated++;
  }
  for (let i = 0; i < 2; i++) {
    const fixtureId = `fix-${competitionId}-sf-m${i}`;
    const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
    batch.set(fixRef, {
      id: fixtureId,
      seasonId: comp.seasonId,
      competitionId,
      competitionName: comp.name,
      matchday: 12,
      roundName: "Semi-Finals",
      homeClubId: "TBD",
      awayClubId: "TBD",
      scheduledAt: now,
      status: "SCHEDULED",
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      createdAt: now,
      updatedAt: now
    });
    totalGenerated++;
  }
  const finalFixtureId = `fix-${competitionId}-final-m0`;
  const finalRef = db.collection(COLLECTIONS.FIXTURES).doc(finalFixtureId);
  batch.set(finalRef, {
    id: finalFixtureId,
    seasonId: comp.seasonId,
    competitionId,
    competitionName: comp.name,
    matchday: 13,
    roundName: "Final",
    homeClubId: "TBD",
    awayClubId: "TBD",
    scheduledAt: now,
    status: "SCHEDULED",
    homeScore: null,
    awayScore: null,
    winnerClubId: null,
    resultConfirmedAt: null,
    createdAt: now,
    updatedAt: now
  });
  totalGenerated++;
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  batch.update(compRef, {
    status: "active",
    hasFixtures: true,
    fixtureCount: totalGenerated,
    fixturesCount: totalGenerated,
    generationStatus: "generated",
    updatedAt: now
  });
  await batch.commit();
  return { generated: totalGenerated, playoffFixtures: 8, r16Fixtures: 8 };
}
async function advanceKnockoutWinner(fixtureId) {
  const db = getFirestoreDb();
  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();
  if (!fixDoc.exists) return { advanced: false };
  const fixture = fixDoc.data();
  if (fixture.status !== "CONFIRMED" || !fixture.winnerClubId) {
    return { advanced: false };
  }
  const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(fixture.competitionId).get();
  if (!compDoc.exists) return { advanced: false };
  const comp = compDoc.data();
  const compId = comp.id || fixture.competitionId;
  if (comp.type !== "KNOCKOUT" && comp.type !== "SUPER_CUP" && comp.type !== "EUROPEAN_KNOCKOUT" && comp.type !== "EUROPEAN_LEAGUE_PHASE") {
    return { advanced: false };
  }
  if (isDomesticCup(compId)) {
    const { advanceDomesticCupWinnerSafe: advanceDomesticCupWinnerSafe2 } = await Promise.resolve().then(() => (init_domesticCupService(), domesticCupService_exports));
    const res = await advanceDomesticCupWinnerSafe2(fixtureId, { adminUserId: "system" });
    return { advanced: res.advanced, targetFixtureId: res.targetFixtureId };
  }
  let nextFixtureId = "";
  let isHomeSlot = true;
  let nextRound = 0;
  const uclPoMatch = fixture.id.match(/-po-m(\d+)$/);
  const uclR16Match = fixture.id.match(/-r16-m(\d+)$/);
  const uclQfMatch = fixture.id.match(/-qf-m(\d+)$/);
  const uclSfMatch = fixture.id.match(/-sf-m(\d+)$/);
  const uclFinalMatch = fixture.id.match(/-final-m(\d+)$/);
  if (uclPoMatch) {
    const poIndex = parseInt(uclPoMatch[1], 10);
    nextFixtureId = `fix-${compId}-r16-m${poIndex}`;
    isHomeSlot = false;
    nextRound = 10;
  } else if (uclR16Match) {
    const r16Index = parseInt(uclR16Match[1], 10);
    const qfIndex = Math.floor(r16Index / 2);
    nextFixtureId = `fix-${compId}-qf-m${qfIndex}`;
    isHomeSlot = r16Index % 2 === 0;
    nextRound = 11;
  } else if (uclQfMatch) {
    const qfIndex = parseInt(uclQfMatch[1], 10);
    const sfIndex = Math.floor(qfIndex / 2);
    nextFixtureId = `fix-${compId}-sf-m${sfIndex}`;
    isHomeSlot = qfIndex % 2 === 0;
    nextRound = 12;
  } else if (uclSfMatch) {
    const sfIndex = parseInt(uclSfMatch[1], 10);
    nextFixtureId = `fix-${compId}-final-m0`;
    isHomeSlot = sfIndex === 0;
    nextRound = 13;
  } else if (uclFinalMatch) {
    nextFixtureId = "";
  } else {
    const match = fixture.id.match(/-r(\d+)-m(\d+)$/);
    if (!match) {
      return { advanced: false };
    }
    const currentRound = parseInt(match[1], 10);
    const currentMatchIndex = parseInt(match[2], 10);
    nextRound = currentRound + 1;
    const nextMatchIndex = Math.floor(currentMatchIndex / 2);
    isHomeSlot = currentMatchIndex % 2 === 0;
    nextFixtureId = `fix-${compId}-r${nextRound}-m${nextMatchIndex}`;
  }
  const nextFixRef = nextFixtureId ? db.collection(COLLECTIONS.FIXTURES).doc(nextFixtureId) : null;
  const nextFixDoc = nextFixRef ? await nextFixRef.get() : null;
  if (!nextFixDoc || !nextFixDoc.exists) {
    const championClubDoc = await db.collection(COLLECTIONS.CLUBS).doc(fixture.winnerClubId).get();
    const championClub = championClubDoc.exists ? championClubDoc.data() : null;
    if (championClub) {
      await createAuditLog(
        "system",
        "TOURNAMENT_CHAMPION_CROWNED",
        "competitions",
        comp.id,
        null,
        { championClubId: championClub.id, championName: championClub.name }
      );
      const occDoc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${comp.seasonId}_${championClub.id}`).get();
      if (occDoc.exists && occDoc.data()?.userId) {
        await createNotification(
          occDoc.data().userId,
          "TOURNAMENT_CHAMPION",
          `\u{1F3C6} Champion of ${comp.name}!`,
          `Congratulations! ${championClub.name} has won the ${comp.name} title!`
        );
      }
    }
    return { advanced: true, winnerClubId: fixture.winnerClubId };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const updateData = {
    updatedAt: now
  };
  if (isHomeSlot) {
    updateData.homeClubId = fixture.winnerClubId;
  } else {
    updateData.awayClubId = fixture.winnerClubId;
  }
  await nextFixRef.update(updateData);
  const updatedNextDoc = await nextFixRef.get();
  const updatedNext = updatedNextDoc.data();
  if (updatedNext.homeClubId && updatedNext.homeClubId !== "TBD" && updatedNext.awayClubId && updatedNext.awayClubId !== "TBD") {
    const homeOccDoc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${comp.seasonId}_${updatedNext.homeClubId}`).get();
    const awayOccDoc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${comp.seasonId}_${updatedNext.awayClubId}`).get();
    const notifMsg = `Your next match in ${comp.name} (${updatedNext.roundName}) is scheduled!`;
    if (homeOccDoc.exists && homeOccDoc.data()?.userId) {
      await createNotification(homeOccDoc.data().userId, "NEXT_ROUND_MATCH", `Next Round in ${comp.name}`, notifMsg);
    }
    if (awayOccDoc.exists && awayOccDoc.data()?.userId) {
      await createNotification(awayOccDoc.data().userId, "NEXT_ROUND_MATCH", `Next Round in ${comp.name}`, notifMsg);
    }
  }
  await createAuditLog(
    "system",
    "KNOCKOUT_ADVANCE",
    "fixtures",
    nextFixtureId,
    { previousFixtureId: fixture.id },
    { round: nextRound, slot: isHomeSlot ? "HOME" : "AWAY", advancedClubId: fixture.winnerClubId }
  );
  try {
    const curMd = fixture.matchday || 1;
    const roundSnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", comp.id).where("matchday", "==", curMd).get();
    const allRoundConfirmed = !roundSnap.empty && roundSnap.docs.every((d) => d.data()?.status === "CONFIRMED");
    if (allRoundConfirmed) {
      const nextMatchday = curMd + 1;
      await db.collection(COLLECTIONS.COMPETITIONS).doc(comp.id).update({
        currentMatchday: nextMatchday,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  } catch (roundErr) {
    console.warn("[KNOCKOUT_ADVANCE] Could not check round completion:", roundErr);
  }
  return { advanced: true, targetFixtureId: nextFixtureId, winnerClubId: fixture.winnerClubId };
}
var generateKnockoutBracketFirestore, generateUCLKnockoutBracketFirestore, advanceKnockoutWinnerFirestore;
var init_knockoutEngine = __esm({
  "src/server/tournament/knockoutEngine.ts"() {
    init_admin();
    init_collections();
    init_notificationService();
    init_adminService();
    init_domesticCupService();
    generateKnockoutBracketFirestore = generateKnockoutBracket;
    generateUCLKnockoutBracketFirestore = generateUCLKnockoutBracket;
    advanceKnockoutWinnerFirestore = advanceKnockoutWinner;
  }
});

// src/server/firebase/firestoreStore.ts
var firestoreStore_exports = {};
__export(firestoreStore_exports, {
  ClubConflictError: () => ClubConflictError,
  ClubNotFoundError: () => ClubNotFoundError,
  adminApproveFixtureResultFirestore: () => adminApproveFixtureResultFirestore,
  adminAssignClubFirestore: () => adminAssignClubFirestore,
  adminDeleteFixtureFirestore: () => adminDeleteFixtureFirestore,
  adminDeleteFixtureResultFirestore: () => adminDeleteFixtureResultFirestore,
  adminDeleteResultSubmissionFirestore: () => adminDeleteResultSubmissionFirestore,
  adminDeleteUserFirestore: () => adminDeleteUserFirestore,
  adminEditFixtureResultFirestore: () => adminEditFixtureResultFirestore,
  adminGetResultSubmissionsFirestore: () => adminGetResultSubmissionsFirestore,
  adminGetUserDetailFirestore: () => adminGetUserDetailFirestore,
  adminReleaseClubFirestore: () => adminReleaseClubFirestore,
  adminSetUserAdminFirestore: () => adminSetUserAdminFirestore,
  adminSetUserSuspensionFirestore: () => adminSetUserSuspensionFirestore,
  advanceCompetitionMatchdayFirestore: () => advanceCompetitionMatchdayFirestore,
  assertMatchdayPlayableFirestore: () => assertMatchdayPlayableFirestore,
  assertNoSyntheticIdsInProduction: () => assertNoSyntheticIdsInProduction,
  assertTestEnvironmentSafe: () => assertTestEnvironmentSafe,
  calculateCompetitionStandingsFirestore: () => calculateCompetitionStandingsFirestore,
  claimClubAtomicFirestore: () => claimClubAtomicFirestore,
  computeAndSortStandings: () => computeAndSortStandings,
  createAuditLogFirestore: () => createAuditLogFirestore,
  createNotificationFirestore: () => createNotificationFirestore,
  enrichStandingsWithActiveOwners: () => enrichStandingsWithActiveOwners,
  executeAdminFixturesPagedFallback: () => executeAdminFixturesPagedFallback,
  firestoreCircuitBreaker: () => firestoreCircuitBreaker,
  generateCompetitionFixturesFirestore: () => generateCompetitionFixturesFirestore,
  getActiveOccupanciesForSeason: () => getActiveOccupanciesForSeason,
  getActiveSeasonFirestore: () => getActiveSeasonFirestore,
  getAdminFixturesPagedFirestore: () => getAdminFixturesPagedFirestore,
  getAllCompetitionsFirestore: () => getAllCompetitionsFirestore,
  getAllLeaguesFirestore: () => getAllLeaguesFirestore,
  getAllSeasonsFirestore: () => getAllSeasonsFirestore,
  getAllUsersFirestore: () => getAllUsersFirestore,
  getAnyCached: () => getAnyCached,
  getAuditLogsFirestore: () => getAuditLogsFirestore,
  getAvailableClubsFirestore: () => getAvailableClubsFirestore,
  getCanonicalTelegramUserId: () => getCanonicalTelegramUserId,
  getClubByIdFirestore: () => getClubByIdFirestore,
  getClubsByLeagueFirestore: () => getClubsByLeagueFirestore,
  getCompetitionByIdFirestore: () => getCompetitionByIdFirestore,
  getCompetitionMatchdayLocksFirestore: () => getCompetitionMatchdayLocksFirestore,
  getCompetitionParticipantsFirestore: () => getCompetitionParticipantsFirestore,
  getCompetitionStandingsFirestore: () => getCompetitionStandingsFirestore,
  getDisputesFirestore: () => getDisputesFirestore,
  getFirestoreTelemetry: () => getFirestoreTelemetry,
  getFixtureByIdFirestore: () => getFixtureByIdFirestore,
  getFixturesFirestore: () => getFixturesFirestore,
  getFromCache: () => getFromCache,
  getLocalDisputes: () => getLocalDisputes,
  getLocalPendingResults: () => getLocalPendingResults,
  getLocalSubmissions: () => getLocalSubmissions,
  getMatchdayLockFirestore: () => getMatchdayLockFirestore,
  getMatchdayLockKey: () => getMatchdayLockKey,
  getOrCreateDevUserFirestore: () => getOrCreateDevUserFirestore,
  getOrCreateTelegramUserFirestore: () => getOrCreateTelegramUserFirestore,
  getPendingResultsFirestore: () => getPendingResultsFirestore,
  getRawClubFixturesFirestore: () => getRawClubFixturesFirestore,
  getReadMetrics: () => getReadMetrics,
  getUserActiveClubFirestore: () => getUserActiveClubFirestore,
  getUserByIdFirestore: () => getUserByIdFirestore,
  getUserNotificationsFirestore: () => getUserNotificationsFirestore,
  guardAgainstTestEntityCreation: () => guardAgainstTestEntityCreation,
  invalidateFirestoreCache: () => invalidateFirestoreCache,
  invalidateMatchdayLockCache: () => invalidateMatchdayLockCache,
  invalidateOwnershipCache: () => invalidateOwnershipCache,
  isMatchdayPlayableKey: () => isMatchdayPlayableKey,
  lastKnownGoodFixtures: () => lastKnownGoodFixtures,
  lastKnownGoodStandings: () => lastKnownGoodStandings,
  markNotificationsReadFirestore: () => markNotificationsReadFirestore,
  markSingleNotificationReadFirestore: () => markSingleNotificationReadFirestore,
  openCompetitionMatchdayNowFirestore: () => openCompetitionMatchdayNowFirestore,
  rebuildCompetitionStandingsFirestore: () => rebuildCompetitionStandingsFirestore2,
  recordEndpointCall: () => recordEndpointCall,
  recordFallbackUsage: () => recordFallbackUsage,
  reopenFixtureFirestore: () => reopenFixtureFirestore,
  resetReadMetrics: () => resetReadMetrics,
  resolveClubOwnersForSeason: () => resolveClubOwnersForSeason,
  resolveDisputeFirestore: () => resolveDisputeFirestore,
  setCompetitionMatchdayOverrideFirestore: () => setCompetitionMatchdayOverrideFirestore,
  setCompetitionMatchdayTimerFirestore: () => setCompetitionMatchdayTimerFirestore,
  setInCache: () => setInCache,
  setMatchdayLockFirestore: () => setMatchdayLockFirestore,
  submitFixtureResultFirestore: () => submitFixtureResultFirestore,
  syncFirestoreClubCrests: () => syncFirestoreClubCrests,
  trackFirestoreRead: () => trackFirestoreRead,
  trackFirestoreWrite: () => trackFirestoreWrite,
  validateDomesticFixturesFirestore: () => validateDomesticFixturesFirestore,
  verifyUserClubConsistency: () => verifyUserClubConsistency
});
function trackFirestoreRead(collectionName, count = 1, caller = "unknown") {
  readMetrics.sessionReads += count;
  readMetrics.readsByCollection[collectionName] = (readMetrics.readsByCollection[collectionName] || 0) + count;
  readMetrics.readsByFunction[caller] = (readMetrics.readsByFunction[caller] || 0) + count;
}
function trackFirestoreWrite(collectionName, count = 1, caller = "unknown") {
  readMetrics.sessionWrites += count;
  readMetrics.readsByFunction[`write:${caller}`] = (readMetrics.readsByFunction[`write:${caller}`] || 0) + count;
}
function recordEndpointCall(endpoint, category, estimatedReads = 0) {
  readMetrics.classifications[category] = (readMetrics.classifications[category] || 0) + 1;
  if (!readMetrics.endpointMetrics[endpoint]) {
    readMetrics.endpointMetrics[endpoint] = {
      requestCount: 0,
      category,
      estimatedReads: 0
    };
  }
  readMetrics.endpointMetrics[endpoint].requestCount += 1;
  readMetrics.endpointMetrics[endpoint].estimatedReads += estimatedReads;
}
function recordFallbackUsage() {
  readMetrics.fallbackCount += 1;
}
function getReadMetrics() {
  const elapsedMs = Math.max(1e3, Date.now() - new Date(readMetrics.startedAt).getTime());
  const elapsedMinutes = elapsedMs / 6e4;
  const projectedDailyConsumption = Math.round(readMetrics.sessionReads / Math.max(0.1, elapsedMinutes) * 1440);
  let highestReadEndpoint = "None";
  let maxReads = -1;
  for (const [ep, meta] of Object.entries(readMetrics.endpointMetrics)) {
    if (meta.estimatedReads > maxReads) {
      maxReads = meta.estimatedReads;
      highestReadEndpoint = ep;
    }
  }
  const freeTierDailyLimit = 5e4;
  const percentageConsumed = Number((readMetrics.sessionReads / freeTierDailyLimit * 100).toFixed(3));
  const queueStats = getQueueStats();
  const circuit = firestoreCircuitBreaker.getStatus();
  return {
    totalReads: readMetrics.sessionReads,
    sessionReads: readMetrics.sessionReads,
    sessionWrites: readMetrics.sessionWrites,
    readsByCollection: { ...readMetrics.readsByCollection },
    readsByFunction: { ...readMetrics.readsByFunction },
    cacheHits: readMetrics.cacheHits,
    cacheMisses: readMetrics.cacheMisses,
    fallbackCount: readMetrics.fallbackCount,
    resourceExhaustedCount: circuit.resourceExhaustedCount,
    pendingMutationsCount: queueStats.pending,
    successfulSyncs: queueStats.synced,
    failedSyncs: queueStats.failed,
    circuitBreaker: circuit,
    classifications: { ...readMetrics.classifications },
    endpointMetrics: { ...readMetrics.endpointMetrics },
    budget: {
      freeTierDailyLimit,
      estimatedReadsToday: readMetrics.sessionReads,
      percentageConsumed,
      projectedDailyConsumption,
      highestReadEndpoint,
      estimatedReadsPerUserSession: 2,
      estimatedReadsPerAdminSession: 8
    },
    startedAt: readMetrics.startedAt
  };
}
function resetReadMetrics() {
  readMetrics.sessionReads = 0;
  readMetrics.sessionWrites = 0;
  readMetrics.readsByCollection = {};
  readMetrics.readsByFunction = {};
  readMetrics.cacheHits = 0;
  readMetrics.cacheMisses = 0;
  readMetrics.fallbackCount = 0;
  readMetrics.classifications = {
    STATIC: 0,
    DYNAMIC: 0,
    MUTATION: 0,
    ADMIN: 0
  };
  readMetrics.endpointMetrics = {};
  readMetrics.startedAt = (/* @__PURE__ */ new Date()).toISOString();
}
function invalidateFirestoreCache(prefix) {
  if (!prefix) {
    serverCache.clear();
    return;
  }
  for (const key of serverCache.keys()) {
    if (key.startsWith(prefix) || key.includes(prefix)) {
      serverCache.delete(key);
    }
  }
}
function invalidateOwnershipCache(seasonId = "season-2026-27", clubId) {
  invalidateFirestoreCache(`firestore:occupancies:${seasonId}`);
  invalidateFirestoreCache("firestore:clubs:league:");
  invalidateFirestoreCache(clubId ? `firestore:club:${clubId}` : "firestore:club:");
  invalidateFirestoreCache("firestore:admin_paged_fixtures:");
  invalidateFirestoreCache("firestore:admin_fixtures_count:");
}
function getFromCache(key) {
  const entry = serverCache.get(key);
  if (entry && Date.now() - entry.timestamp < entry.ttlMs) {
    readMetrics.cacheHits++;
    return entry.data;
  }
  readMetrics.cacheMisses++;
  return null;
}
function getAnyCached(key) {
  const entry = serverCache.get(key);
  if (entry && entry.data !== void 0 && entry.data !== null) {
    return entry.data;
  }
  return null;
}
function setInCache(key, data, ttlMs = 6e4) {
  if (data === null || data === void 0) {
    return;
  }
  if (Array.isArray(data) && data.length === 0) {
    const existing = serverCache.get(key);
    if (existing && Array.isArray(existing.data) && existing.data.length > 0) {
      console.warn(`[CACHE_PRESERVATION] Preserving healthy non-empty cache for '${key}' instead of overwriting with empty array.`);
      return;
    }
  }
  serverCache.set(key, {
    data,
    timestamp: Date.now(),
    ttlMs
  });
}
async function getActiveSeasonFirestore() {
  const active = SEED_SEASONS.find((s) => s.status === "active") || SEED_SEASON;
  return {
    id: active.id,
    name: active.name,
    status: active.status?.toLowerCase() || "active",
    startDate: active.startDate,
    endDate: active.endDate,
    createdAt: ""
  };
}
async function getAllSeasonsFirestore() {
  return SEED_SEASONS.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status?.toLowerCase() || "active",
    startDate: s.startDate,
    endDate: s.endDate,
    createdAt: ""
  }));
}
async function getAllLeaguesFirestore() {
  const cacheKey = "firestore:all_leagues";
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  const res = SEED_LEAGUES.map((l) => ({
    id: l.id,
    name: l.name,
    country: l.country,
    tier: l.tier,
    logoUrl: l.logoUrl,
    createdAt: ""
  }));
  setInCache(cacheKey, res, 864e5);
  return res;
}
async function getActiveOccupanciesForSeason(seasonId = "season-2026-27") {
  const cacheKey = `firestore:occupancies:${seasonId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  if (!firestoreCircuitBreaker.canExecute()) {
    recordFallbackUsage();
    return getLocalFallbackOccupancies(seasonId, cacheKey);
  }
  try {
    const db = getFirestoreDb();
    const occupanciesSnap = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where("seasonId", "==", seasonId).where("status", "==", "active").get();
    firestoreCircuitBreaker.recordSuccess();
    trackFirestoreRead(
      COLLECTIONS.CLUB_OCCUPANCIES,
      occupanciesSnap.empty ? 1 : occupanciesSnap.docs.length,
      "getActiveOccupanciesForSeason"
    );
    const clubOccupancyMap = /* @__PURE__ */ new Map();
    const docDataList = [];
    for (const doc of occupanciesSnap.docs) {
      const data = doc.data();
      docDataList.push(data);
      if (data.clubId && data.userId) {
        clubOccupancyMap.set(data.clubId, { userId: data.userId });
      }
    }
    try {
      syncOccupanciesFromFirestoreDocs(seasonId, docDataList);
    } catch {
    }
    const userIds = Array.from(new Set(Array.from(clubOccupancyMap.values()).map((o) => o.userId)));
    const usernameMap = /* @__PURE__ */ new Map();
    const userMap = /* @__PURE__ */ new Map();
    if (userIds.length > 0) {
      const missingUserIds = [];
      for (const uid of userIds) {
        const cachedUser = getFromCache(`firestore:user:${uid}`);
        if (cachedUser) {
          const uname = cachedUser.username || cachedUser.firstName || uid;
          usernameMap.set(uid, uname);
          const displayName = `${cachedUser.firstName || ""} ${cachedUser.lastName || ""}`.trim() || cachedUser.username || uid;
          userMap.set(uid, { id: uid, username: cachedUser.username || "", displayName });
        } else {
          missingUserIds.push(uid);
        }
      }
      if (missingUserIds.length > 0) {
        for (let i = 0; i < missingUserIds.length; i += 30) {
          const chunk = missingUserIds.slice(i, i + 30);
          const usersSnap = await db.collection(COLLECTIONS.USERS).where("id", "in", chunk).get().catch(() => null);
          if (usersSnap) {
            trackFirestoreRead(
              COLLECTIONS.USERS,
              usersSnap.empty ? 1 : usersSnap.docs.length,
              "getActiveOccupanciesForSeason:users"
            );
            for (const uDoc of usersSnap.docs) {
              const uData = uDoc.data();
              const uname = uData.username || uData.firstName || uDoc.id;
              usernameMap.set(uDoc.id, uname);
              const displayName = `${uData.firstName || ""} ${uData.lastName || ""}`.trim() || uData.username || uDoc.id;
              userMap.set(uDoc.id, { id: uDoc.id, username: uData.username || "", displayName });
              setInCache(
                `firestore:user:${uDoc.id}`,
                {
                  id: uDoc.id,
                  telegramId: uData.telegramId || "",
                  username: uData.username || "",
                  firstName: uData.firstName || "",
                  lastName: uData.lastName || "",
                  photoUrl: uData.photoUrl || "",
                  isAdmin: Boolean(uData.isAdmin),
                  isSuspended: Boolean(uData.isSuspended),
                  createdAt: uData.createdAt || "",
                  updatedAt: uData.updatedAt || ""
                },
                3e5
              );
            }
          }
        }
      }
    }
    const result = { clubOccupancyMap, usernameMap, userMap };
    setInCache(cacheKey, result, 6e4);
    return result;
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    recordFallbackUsage();
    console.warn("[FIRESTORE FALLBACK] getActiveOccupanciesForSeason:", err.message);
    return getLocalFallbackOccupancies(seasonId, cacheKey);
  }
}
function getLocalFallbackOccupancies(seasonId, cacheKey) {
  const clubOccupancyMap = /* @__PURE__ */ new Map();
  const usernameMap = /* @__PURE__ */ new Map();
  const userMap = /* @__PURE__ */ new Map();
  try {
    const snapshot = getLocalOccupancySnapshot(seasonId);
    for (const snap of snapshot) {
      if (snap.claimedByUserId && snap.status === "active") {
        clubOccupancyMap.set(snap.clubId, { userId: snap.claimedByUserId });
      }
    }
  } catch {
  }
  try {
    const rows = queryAll(
      `SELECT cm.club_id, cm.user_id, u.username as manager_username, u.first_name, u.last_name
       FROM club_memberships cm
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE cm.season_id = ? AND cm.status = 'active'`,
      [seasonId]
    );
    for (const r of rows) {
      clubOccupancyMap.set(r.club_id, { userId: r.user_id });
      if (r.manager_username) {
        usernameMap.set(r.user_id, r.manager_username);
      }
      const displayName = `${r.first_name || ""} ${r.last_name || ""}`.trim() || r.manager_username || r.user_id;
      userMap.set(r.user_id, { id: r.user_id, username: r.manager_username || "", displayName });
    }
  } catch {
  }
  const result = { clubOccupancyMap, usernameMap, userMap };
  setInCache(cacheKey, result, 6e4);
  return result;
}
async function getClubsByLeagueFirestore(leagueId, seasonId = "season-2026-27", currentUserId) {
  const cacheKey = `firestore:clubs:league:${leagueId}:${seasonId}`;
  const cached = getFromCache(cacheKey);
  if (cached && cached.length > 0) {
    return cached.map((c) => {
      const isCurrentUserClub = Boolean(currentUserId && c.claimedByUserId === currentUserId);
      const isTaken = c.isTaken;
      return {
        ...c,
        isCurrentUserClub,
        occupancy: {
          ...c.occupancy,
          status: isCurrentUserClub ? "owned" : isTaken ? "occupied" : "available"
        }
      };
    });
  }
  try {
    const staticLeagueClubs = SEED_CLUBS.filter((c) => c.leagueId === leagueId);
    const { clubOccupancyMap, usernameMap } = await getActiveOccupanciesForSeason(seasonId);
    const clubs = staticLeagueClubs.map((seed) => {
      const occupancy = clubOccupancyMap.get(seed.id);
      const isTaken = Boolean(occupancy);
      const isCurrentUserClub = Boolean(currentUserId && occupancy && occupancy.userId === currentUserId);
      const managerUsername = occupancy ? usernameMap.get(occupancy.userId) : void 0;
      const claimedByUserId = occupancy ? occupancy.userId : null;
      const claimedByUsername = managerUsername || null;
      const occupancyStatus = isCurrentUserClub ? "owned" : isTaken ? "occupied" : "available";
      return {
        id: seed.id,
        name: seed.name,
        shortName: seed.shortName,
        leagueId: seed.leagueId,
        country: seed.country,
        logoUrl: seed.logoUrl,
        active: true,
        createdAt: "",
        isTaken,
        isCurrentUserClub,
        claimedByUserId,
        claimedByUsername,
        managerUsername,
        occupancy: {
          status: occupancyStatus,
          userId: occupancy ? occupancy.userId : void 0,
          username: managerUsername
        }
      };
    });
    const sortedClubs = clubs.sort((a, b) => a.name.localeCompare(b.name));
    if (sortedClubs.length > 0) {
      const neutralClubsForCache = sortedClubs.map((c) => ({
        ...c,
        isCurrentUserClub: false,
        occupancy: {
          ...c.occupancy,
          status: c.isTaken ? "occupied" : "available"
        }
      }));
      setInCache(cacheKey, neutralClubsForCache, 6e4);
    }
    return sortedClubs;
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getClubsByLeagueFirestore:", err.message);
    const rows = queryAll(
      `SELECT c.*, cm.user_id as claimed_by_user_id, u.username as manager_username
       FROM clubs c
       LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = ? AND cm.status = 'active'
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE c.league_id = ? AND c.active = 1
       ORDER BY c.name ASC`,
      [seasonId, leagueId]
    );
    const fallbackClubs = rows.map((r) => {
      const isTaken = Boolean(r.claimed_by_user_id);
      const isCurrentUserClub = Boolean(currentUserId && r.claimed_by_user_id === currentUserId);
      return {
        id: r.id,
        name: r.name,
        shortName: r.short_name,
        leagueId: r.league_id,
        country: r.country,
        logoUrl: r.logo_url,
        active: Boolean(r.active),
        createdAt: r.created_at,
        isTaken,
        isCurrentUserClub,
        claimedByUserId: r.claimed_by_user_id || null,
        claimedByUsername: r.manager_username || null,
        managerUsername: r.manager_username || void 0,
        occupancy: {
          status: isCurrentUserClub ? "owned" : isTaken ? "occupied" : "available",
          userId: r.claimed_by_user_id || void 0,
          username: r.manager_username || void 0
        }
      };
    });
    if (fallbackClubs.length > 0) {
      setInCache(cacheKey, fallbackClubs, 6e4);
    }
    return fallbackClubs;
  }
}
async function getAvailableClubsFirestore(seasonId = "season-2026-27", currentUserId) {
  const cacheKey = `firestore:clubs:available:${seasonId}`;
  const cached = getFromCache(cacheKey);
  if (cached && cached.length > 0) return cached;
  try {
    const { clubOccupancyMap } = await getActiveOccupanciesForSeason(seasonId);
    const availableClubs = SEED_CLUBS.filter((c) => !clubOccupancyMap.has(c.id)).map((seed) => ({
      id: seed.id,
      name: seed.name,
      shortName: seed.shortName,
      leagueId: seed.leagueId,
      country: seed.country,
      logoUrl: seed.logoUrl,
      active: true,
      createdAt: "",
      isTaken: false,
      isCurrentUserClub: false,
      occupancy: {
        status: "available"
      }
    }));
    const sortedClubs = availableClubs.sort((a, b) => a.name.localeCompare(b.name));
    if (sortedClubs.length > 0) {
      setInCache(cacheKey, sortedClubs, 6e4);
    }
    return sortedClubs;
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getAvailableClubsFirestore:", err.message);
    const rows = queryAll(
      `SELECT c.* FROM clubs c
       LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = ? AND cm.status = 'active'
       WHERE c.active = 1 AND cm.id IS NULL
       ORDER BY c.name ASC`,
      [seasonId]
    );
    const fallbackClubs = rows.map((r) => ({
      id: r.id,
      name: r.name,
      shortName: r.short_name,
      leagueId: r.league_id,
      country: r.country,
      logoUrl: r.logo_url,
      active: Boolean(r.active),
      createdAt: r.created_at,
      isTaken: false,
      isCurrentUserClub: false,
      occupancy: {
        status: "available"
      }
    }));
    if (fallbackClubs.length > 0) {
      setInCache(cacheKey, fallbackClubs, 6e4);
    }
    return fallbackClubs;
  }
}
async function getClubByIdFirestore(clubId, seasonId = "season-2026-27", currentUserId) {
  const cacheKey = `firestore:club:${clubId}:${seasonId}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    const isCurrentUserClub2 = Boolean(currentUserId && cached.claimedByUserId === currentUserId);
    return {
      ...cached,
      isCurrentUserClub: isCurrentUserClub2,
      occupancy: {
        ...cached.occupancy,
        status: isCurrentUserClub2 ? "owned" : cached.isTaken ? "occupied" : "available"
      }
    };
  }
  const seed = SEED_CLUB_MAP.get(clubId);
  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      trackFirestoreRead(COLLECTIONS.CLUB_OCCUPANCIES, 1, "getClubByIdFirestore");
      const occDoc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`).get().catch(() => null);
      firestoreCircuitBreaker.recordSuccess();
      let occUserId2 = null;
      if (occDoc && occDoc.exists && occDoc.data()?.status === "active") {
        occUserId2 = occDoc.data().userId;
      }
      let isTaken2 = false;
      let managerUsername2;
      let isCurrentUserClub2 = false;
      if (occUserId2) {
        isTaken2 = true;
        isCurrentUserClub2 = Boolean(currentUserId && currentUserId === occUserId2);
        const user = await getUserByIdFirestore(occUserId2);
        managerUsername2 = user?.username;
      }
      const occupancyStatus = isCurrentUserClub2 ? "owned" : isTaken2 ? "occupied" : "available";
      const clubRes = {
        id: clubId,
        name: seed?.name || clubId,
        shortName: seed?.shortName || clubId,
        leagueId: seed?.leagueId || "",
        country: seed?.country || "",
        logoUrl: seed?.logoUrl || "",
        active: true,
        createdAt: "",
        isTaken: isTaken2,
        isCurrentUserClub: isCurrentUserClub2,
        claimedByUserId: occUserId2,
        claimedByUsername: managerUsername2 || null,
        managerUsername: managerUsername2,
        occupancy: {
          status: occupancyStatus,
          userId: occUserId2 || void 0,
          username: managerUsername2
        }
      };
      setInCache(cacheKey, clubRes, 6e4);
      return clubRes;
    } catch (err) {
      firestoreCircuitBreaker.recordFailure(err);
      recordFallbackUsage();
      console.warn("[FIRESTORE FALLBACK] getClubByIdFirestore:", err.message);
    }
  } else {
    recordFallbackUsage();
  }
  let occUserId = null;
  const localSnap = getLocalOccupancySnapshot(seasonId);
  const matched = localSnap.find((s) => s.clubId === clubId && s.status === "active");
  if (matched?.claimedByUserId) {
    occUserId = matched.claimedByUserId;
  }
  const r = queryGet(
    `SELECT c.*, cm.user_id as claimed_by_user_id, u.username as manager_username
     FROM clubs c
     LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = ? AND cm.status = 'active'
     LEFT JOIN users u ON cm.user_id = u.id
     WHERE c.id = ?`,
    [seasonId, clubId]
  );
  const finalClaimedBy = occUserId || r?.claimed_by_user_id || null;
  const isTaken = Boolean(finalClaimedBy);
  const isCurrentUserClub = Boolean(currentUserId && finalClaimedBy === currentUserId);
  const managerUsername = r?.manager_username || void 0;
  const fallbackRes = {
    id: clubId,
    name: r?.name || seed?.name || clubId,
    shortName: r?.short_name || seed?.shortName || clubId,
    leagueId: r?.league_id || seed?.leagueId || "",
    country: r?.country || seed?.country || "",
    logoUrl: r?.logo_url || seed?.logoUrl || "",
    active: r ? Boolean(r.active) : true,
    createdAt: r?.created_at || "",
    isTaken,
    isCurrentUserClub,
    claimedByUserId: finalClaimedBy,
    claimedByUsername: managerUsername || null,
    managerUsername,
    occupancy: {
      status: isCurrentUserClub ? "owned" : isTaken ? "occupied" : "available",
      userId: finalClaimedBy || void 0,
      username: managerUsername
    }
  };
  setInCache(cacheKey, fallbackRes, 6e4);
  return fallbackRes;
}
async function getUserActiveClubFirestore(userId, seasonId = "season-2026-27") {
  const cacheKey = `firestore:user_active_club:${userId}:${seasonId}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    if ("noClub" in cached) return null;
    return cached;
  }
  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      trackFirestoreRead(COLLECTIONS.USER_MEMBERSHIPS, 1, "getUserActiveClubFirestore");
      const userMemDoc = await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userId}`).get().catch(() => null);
      firestoreCircuitBreaker.recordSuccess();
      if (userMemDoc && userMemDoc.exists && userMemDoc.data()?.status === "active") {
        const clubId = userMemDoc.data().clubId;
        const seed = SEED_CLUB_MAP.get(clubId);
        const user = await getUserByIdFirestore(userId);
        const c = {
          id: clubId,
          name: seed?.name || clubId,
          shortName: seed?.shortName || clubId,
          leagueId: seed?.leagueId || "",
          country: seed?.country || "",
          logoUrl: seed?.logoUrl || "",
          active: true,
          createdAt: "",
          isTaken: true,
          isCurrentUserClub: true,
          claimedByUserId: userId,
          claimedByUsername: user?.username || null,
          managerUsername: user?.username,
          occupancy: {
            status: "owned",
            userId,
            username: user?.username
          }
        };
        setInCache(cacheKey, c, 6e4);
        return c;
      } else {
        setInCache(cacheKey, { noClub: true }, 6e4);
        return null;
      }
    } catch (err) {
      firestoreCircuitBreaker.recordFailure(err);
      recordFallbackUsage();
      console.warn("[FIRESTORE FALLBACK] getUserActiveClubFirestore:", err.message);
    }
  } else {
    recordFallbackUsage();
  }
  const localClubId = getUserOccupiedClubIdLocally(seasonId, userId);
  if (localClubId) {
    const c = await getClubByIdFirestore(localClubId, seasonId, userId);
    if (c) {
      setInCache(cacheKey, c, 6e4);
      return c;
    }
  }
  const mem = queryGet(
    `SELECT club_id FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = 'active' LIMIT 1`,
    [userId, seasonId]
  );
  if (mem) {
    const c = await getClubByIdFirestore(mem.club_id, seasonId, userId);
    if (c) {
      setInCache(cacheKey, c, 6e4);
      return c;
    }
  }
  setInCache(cacheKey, { noClub: true }, 6e4);
  return null;
}
async function claimClubAtomicFirestore(userId, clubId, seasonId = "season-2026-27", options) {
  assertNoSyntheticIdsInProduction("claimClubAtomicFirestore", [userId, clubId, seasonId]);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      const claimResult = await db.runTransaction(async (transaction) => {
        const userMemRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userId}`);
        const clubOccRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`);
        const membershipRef = db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${clubId}`);
        const clubRef = db.collection(COLLECTIONS.CLUBS).doc(clubId);
        const clubDoc = await transaction.get(clubRef);
        if (!clubDoc.exists) {
          throw new ClubNotFoundError(`Club with ID '${clubId}' does not exist.`);
        }
        const clubData = clubDoc.data();
        const clubOccDoc = await transaction.get(clubOccRef);
        const userMemDoc = await transaction.get(userMemRef);
        if (userMemDoc.exists) {
          const userMemData = userMemDoc.data();
          if (userMemData?.clubId && !["released", "archived", "inactive"].includes(userMemData.status)) {
            if (userMemData.clubId === clubId) {
              if (!clubOccDoc.exists || clubOccDoc.data()?.userId !== userId || ["released", "inactive"].includes(clubOccDoc.data()?.status)) {
                throw new ClubConflictError("Club membership and occupancy disagree. Admin review is required.", "OWNERSHIP_INCONSISTENT");
              }
              return {
                success: true,
                club: {
                  id: clubDoc.id,
                  name: clubData.name,
                  shortName: clubData.shortName,
                  leagueId: clubData.leagueId,
                  country: clubData.country,
                  logoUrl: clubData.logo,
                  active: clubData.isActive,
                  createdAt: clubData.createdAt,
                  isTaken: true,
                  isCurrentUserClub: true,
                  claimedByUserId: userId,
                  occupancy: {
                    status: "owned",
                    userId
                  }
                }
              };
            }
            throw new ClubConflictError(
              `Your club selection is locked for this season. You have already claimed another club.`,
              "CLUB_SELECTION_LOCKED"
            );
          }
        }
        if (clubOccDoc.exists) {
          const clubOccData = clubOccDoc.data();
          if (clubOccData?.userId && !["released", "inactive"].includes(clubOccData.status) && clubOccData.userId !== userId) {
            throw new ClubConflictError(
              `This club has already been selected by another player for this season.`,
              "CLUB_OCCUPIED"
            );
          }
        }
        const membershipPayload = {
          id: `cm-${seasonId}-${clubId}`,
          seasonId,
          clubId,
          userId,
          claimedAt: now,
          status: "active",
          updatedAt: now
        };
        transaction.set(userMemRef, {
          userId,
          clubId,
          seasonId,
          status: "active",
          claimedAt: now,
          updatedAt: now
        });
        transaction.set(clubOccRef, {
          clubId,
          userId,
          seasonId,
          status: "active",
          claimedAt: now,
          updatedAt: now
        });
        transaction.set(membershipRef, membershipPayload);
        transaction.update(clubRef, {
          isTaken: true,
          claimedByUserId: userId
        });
        trackFirestoreWrite(COLLECTIONS.CLUB_OCCUPANCIES, 4, "claimClubAtomicFirestore");
        return {
          success: true,
          club: {
            id: clubDoc.id,
            name: clubData.name,
            shortName: clubData.shortName,
            leagueId: clubData.leagueId,
            country: clubData.country,
            logoUrl: clubData.logo,
            active: clubData.isActive,
            createdAt: clubData.createdAt,
            isTaken: true,
            isCurrentUserClub: true,
            claimedByUserId: userId,
            occupancy: {
              status: "owned",
              userId
            }
          }
        };
      });
      const verifyOcc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`).get();
      if (!verifyOcc.exists || verifyOcc.data()?.status !== "active") {
        throw new Error(`OCCUPANCY_PERSISTENCE_FAILED: Failed to verify club occupancy record at '${COLLECTIONS.CLUB_OCCUPANCIES}/${seasonId}_${clubId}'.`);
      }
      firestoreCircuitBreaker.recordSuccess();
      try {
        updateOccupancyRecord({
          clubId,
          seasonId,
          status: "active",
          claimedByUserId: userId,
          claimedAt: now,
          updatedAt: now
        });
        queryRun(
          `INSERT OR REPLACE INTO club_memberships (id, season_id, club_id, user_id, claimed_at, status, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?)`,
          [`cm-${seasonId}-${clubId}`, seasonId, clubId, userId, now, now]
        );
      } catch {
      }
      invalidateFirestoreCache();
      return {
        ...claimResult,
        authoritative: true,
        isFallback: false
      };
    } catch (err) {
      if (err instanceof ClubConflictError || err instanceof ClubNotFoundError) {
        throw err;
      }
      if (options?.authoritativeOnly || isHostedEnvironment()) {
        throw err;
      }
      firestoreCircuitBreaker.recordFailure(err);
      recordFallbackUsage();
      console.warn("[FIRESTORE FALLBACK] claimClubAtomicFirestore:", err.message);
    }
  } else {
    if (options?.authoritativeOnly || isHostedEnvironment()) {
      throw new Error("CIRCUIT_OPEN: Firestore circuit breaker is OPEN. Authoritative write cannot execute.");
    }
    recordFallbackUsage();
  }
  return dbTransaction(() => {
    const seed = SEED_CLUB_MAP.get(clubId);
    const club = queryGet("SELECT * FROM clubs WHERE id = ?", [clubId]);
    if (!club && !seed) {
      throw new ClubNotFoundError(`Club with ID '${clubId}' does not exist.`);
    }
    const existingMem = queryGet(
      "SELECT * FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = 'active'",
      [userId, seasonId]
    );
    if (existingMem) {
      if (existingMem.club_id === clubId) {
        const c = getClubByIdFirestore(clubId, seasonId, userId);
        return { success: true, club: c, authoritative: false, isFallback: true };
      }
      throw new ClubConflictError(
        "Your club selection is locked for this season. You have already claimed another club.",
        "CLUB_SELECTION_LOCKED"
      );
    }
    const snapOccUserId = getClubOccupantUserIdLocally(seasonId, clubId);
    if (snapOccUserId && snapOccUserId !== userId) {
      throw new ClubConflictError(
        "This club has already been selected by another player for this season.",
        "CLUB_OCCUPIED"
      );
    }
    const occupied = queryGet(
      "SELECT * FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = 'active'",
      [clubId, seasonId]
    );
    if (occupied && occupied.user_id !== userId) {
      throw new ClubConflictError(
        "This club has already been selected by another player for this season.",
        "CLUB_OCCUPIED"
      );
    }
    const memId = `cm-${seasonId}-${clubId}`;
    queryRun(
      `INSERT OR REPLACE INTO club_memberships (id, season_id, club_id, user_id, claimed_at, status, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      [memId, seasonId, clubId, userId, now, now]
    );
    updateOccupancyRecord({
      clubId,
      seasonId,
      status: "active",
      claimedByUserId: userId,
      claimedAt: now,
      updatedAt: now
    });
    enqueueMutation({
      mutationId: `claim_${seasonId}_${clubId}_${userId}`,
      entityType: "CLUB_CLAIM",
      entityId: clubId,
      operation: "CLAIM_CLUB",
      payload: { clubId, seasonId, userId, claimedAt: now },
      createdAt: now
    });
    invalidateFirestoreCache();
    const claimedClub = {
      id: clubId,
      name: club?.name || seed?.name || clubId,
      shortName: club?.short_name || seed?.shortName || clubId,
      leagueId: club?.league_id || seed?.leagueId || "",
      country: club?.country || seed?.country || "",
      logoUrl: club?.logo_url || seed?.logoUrl || "",
      active: true,
      createdAt: now,
      isTaken: true,
      isCurrentUserClub: true,
      claimedByUserId: userId,
      occupancy: {
        status: "owned",
        userId
      }
    };
    return { success: true, club: claimedClub, authoritative: false, isFallback: true };
  });
}
async function getAllCompetitionsFirestore(seasonId = "season-2026-27") {
  const cacheKey = `firestore:competitions:${seasonId}`;
  const cached = getFromCache(cacheKey);
  if (cached && cached.length > 0) return cached;
  const validComps = SEED_COMPETITIONS.filter((c) => {
    return !c.id.includes("trophee-des-champions") && !c.id.includes("conference-league") && !c.id.includes("uecl") && !c.id.includes("efl-cup") && c.status !== "inactive" && !c.hidden;
  });
  const competitions = validComps.map((seed) => {
    const override = compOverrideMap.get(seed.id) || {};
    const fixturesCount = override.fixturesCount ?? override.fixtureCount ?? (override.hasFixtures ? 1 : 0);
    const hasFixtures = Boolean(override.hasFixtures || fixturesCount > 0);
    const generationStatus = hasFixtures ? "generated" : "not_generated";
    let totalTeams = 0;
    if (seed.leagueId) {
      totalTeams = SEED_CLUBS.filter((c) => c.leagueId === seed.leagueId).length || 20;
    } else {
      totalTeams = seed.formatConfig?.maxTeams || 32;
    }
    const totalMatchdays = seed.leagueId ? seed.leagueId.includes("bundesliga") || seed.leagueId.includes("ligue-1") ? 17 : 19 : override.totalMatchdays || 8;
    return {
      id: seed.id,
      seasonId: seed.seasonId || seasonId,
      leagueId: seed.leagueId,
      name: seed.name,
      type: seed.type,
      scheduleMode: seed.scheduleMode,
      status: hasFixtures ? "active" : "active",
      totalTeams,
      hasFixtures,
      fixtureCount: fixturesCount,
      fixturesCount,
      generationStatus,
      formatConfig: seed.formatConfig || {},
      currentMatchday: override.currentMatchday || 1,
      totalMatchdays,
      isMatchdayOpen: override.isMatchdayOpen !== false,
      matchdayOpenedAt: override.matchdayOpenedAt,
      matchdayDurationHours: override.matchdayDurationHours || 30,
      nextMatchdayOpenAt: override.nextMatchdayOpenAt,
      adminOverrideStatus: override.adminOverrideStatus || "AUTO",
      createdAt: ""
    };
  });
  setInCache(cacheKey, competitions, 3e5);
  return competitions;
}
async function getCompetitionByIdFirestore(competitionId) {
  const all = await getAllCompetitionsFirestore();
  const comp = all.find((c) => c.id === competitionId);
  return comp || null;
}
async function getRawClubFixturesFirestore(clubId, seasonId = "season-2026-27") {
  const cacheKey = `firestore:club_raw_fixtures:${seasonId}:${clubId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const db = getFirestoreDb();
    const [homeSnap, awaySnap] = await Promise.all([
      db.collection(COLLECTIONS.FIXTURES).where("homeClubId", "==", clubId).get(),
      db.collection(COLLECTIONS.FIXTURES).where("awayClubId", "==", clubId).get()
    ]);
    const reads = (homeSnap.empty ? 1 : homeSnap.docs.length) + (awaySnap.empty ? 1 : awaySnap.docs.length);
    trackFirestoreRead(COLLECTIONS.FIXTURES, reads, "getRawClubFixturesFirestore");
    const docMap = /* @__PURE__ */ new Map();
    homeSnap.docs.forEach((d) => docMap.set(d.id, d.data()));
    awaySnap.docs.forEach((d) => docMap.set(d.id, d.data()));
    const docs = Array.from(docMap.values());
    setInCache(cacheKey, docs, 3e4);
    return docs;
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getRawClubFixturesFirestore:", err.message);
    return [];
  }
}
function checkFixturePlayability(competitionId, seasonId, matchday, fixtureStatus, homeClubId, awayClubId, compData) {
  const activeMatchday = compData?.currentMatchday || 1;
  const adminStatus = compData?.adminOverrideStatus || "AUTO";
  const isMatchdayOpen = compData?.isMatchdayOpen !== false;
  const compType = compData?.type || (competitionId.includes("cup") || competitionId.includes("pokal") || competitionId.includes("rey") || competitionId.includes("italia") ? "KNOCKOUT" : "LEAGUE");
  const isKnockout = compType === "KNOCKOUT" || compType === "SUPER_CUP" || compType === "EUROPEAN_KNOCKOUT";
  if (fixtureStatus === "CONFIRMED") {
    return { isPlayable: false, activeMatchday };
  }
  if (!homeClubId || homeClubId === "TBD" || !awayClubId || awayClubId === "TBD") {
    return { isPlayable: false, activeMatchday };
  }
  if (adminStatus === "FORCE_LOCKED" || adminStatus === "PAUSED") {
    return { isPlayable: false, activeMatchday };
  }
  if (!isMatchdayOpen) {
    return { isPlayable: false, activeMatchday };
  }
  const lock = matchdayLocksCache.get(getMatchdayLockKey(seasonId, competitionId, matchday));
  if (lock) {
    if (lock.overrideStatus === "FORCE_OPEN" || lock.isOpen === true) {
      return { isPlayable: true, activeMatchday };
    }
    if (lock.overrideStatus === "FORCE_LOCKED" || lock.overrideStatus === "PAUSED" || lock.isLocked || lock.isOpen === false) {
      return { isPlayable: false, activeMatchday };
    }
  }
  if (isKnockout) {
    return { isPlayable: true, activeMatchday };
  }
  if (adminStatus === "FORCE_OPEN") {
    return { isPlayable: matchday === activeMatchday, activeMatchday };
  }
  return { isPlayable: matchday === activeMatchday, activeMatchday };
}
async function getFixturesFirestore(filter) {
  const seasonId = filter.seasonId || "season-2026-27";
  let targetClubId = filter.clubId;
  if (filter.userId && !targetClubId) {
    const activeClub = await getUserActiveClubFirestore(filter.userId, seasonId);
    if (!activeClub) {
      return [];
    }
    targetClubId = activeClub.id;
  }
  const cacheKey = targetClubId ? `firestore:fixtures:club:${targetClubId}:md${filter.matchday || "all"}:st${filter.status || "all"}:comp${filter.competitionId || "all"}` : filter.competitionId ? `firestore:fixtures:comp:${filter.competitionId}:md${filter.matchday || "all"}:st${filter.status || "all"}:lim${filter.limit || "all"}` : null;
  if (cacheKey) {
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
  }
  if (!firestoreCircuitBreaker.canExecute()) {
    recordFallbackUsage();
    return executeFixturesFallback(filter, targetClubId, cacheKey);
  }
  try {
    const db = getFirestoreDb();
    let docs = [];
    if (targetClubId) {
      docs = await getRawClubFixturesFirestore(targetClubId, seasonId);
      if (filter.competitionId) {
        docs = docs.filter((f) => f.competitionId === filter.competitionId);
      }
      if (filter.seasonId) {
        docs = docs.filter((f) => !f.seasonId || f.seasonId === filter.seasonId);
      }
      if (filter.matchday) {
        docs = docs.filter((f) => f.matchday === filter.matchday);
      }
      if (filter.status) {
        docs = docs.filter((f) => f.status === filter.status);
      }
    } else {
      let query = db.collection(COLLECTIONS.FIXTURES);
      if (filter.competitionId) {
        query = query.where("competitionId", "==", filter.competitionId);
      } else if (filter.seasonId) {
        query = query.where("seasonId", "==", filter.seasonId);
      }
      if (filter.matchday) {
        query = query.where("matchday", "==", filter.matchday);
      }
      if (filter.status) {
        query = query.where("status", "==", filter.status);
      }
      const snap = await query.get();
      firestoreCircuitBreaker.recordSuccess();
      trackFirestoreRead(
        COLLECTIONS.FIXTURES,
        snap.empty ? 1 : snap.docs.length,
        "getFixturesFirestore:query"
      );
      docs = snap.docs.map((d) => d.data());
    }
    docs.sort((a, b) => a.matchday - b.matchday || new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    if (filter.limit && filter.limit > 0) {
      docs = docs.slice(0, filter.limit);
    }
    const { clubOccupancyMap, usernameMap, userMap } = await getActiveOccupanciesForSeason(filter.seasonId || "season-2026-27");
    const compMap = /* @__PURE__ */ new Map();
    for (const compId of new Set(docs.map((d) => d.competitionId).filter(Boolean))) {
      let comp = compOverrideMap.get(compId);
      if (!comp) {
        try {
          const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(compId).get();
          if (compDoc.exists) {
            comp = compDoc.data();
            compOverrideMap.set(compId, comp);
          }
        } catch {
        }
      }
      if (comp) compMap.set(compId, comp);
    }
    const submissionsMap = /* @__PURE__ */ new Map();
    if (filter.userId && docs.length > 0) {
      const fixtureIds = docs.map((d) => d.id);
      for (let i = 0; i < fixtureIds.length; i += 30) {
        const chunk = fixtureIds.slice(i, i + 30);
        try {
          const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where("fixtureId", "in", chunk).get();
          for (const subDoc of subsSnap.docs) {
            const subData = subDoc.data();
            const arr = submissionsMap.get(subData.fixtureId) || [];
            arr.push({
              id: subDoc.id,
              fixtureId: subData.fixtureId,
              userId: subData.submittedByUserId,
              submittedByUserId: subData.submittedByUserId,
              clubId: subData.clubId,
              homeScore: subData.homeScore,
              awayScore: subData.awayScore,
              proofUrl: subData.proofUrl || null,
              createdAt: subData.createdAt
            });
            submissionsMap.set(subData.fixtureId, arr);
          }
        } catch {
        }
      }
    }
    const fixtures = docs.map((r) => {
      const homeSeed = SEED_CLUB_MAP.get(r.homeClubId);
      const awaySeed = SEED_CLUB_MAP.get(r.awayClubId);
      const comp = compMap.get(r.competitionId);
      const { isPlayable, activeMatchday } = checkFixturePlayability(
        r.competitionId,
        r.seasonId,
        r.matchday,
        r.status,
        r.homeClubId,
        r.awayClubId,
        comp
      );
      const homeOcc = clubOccupancyMap.get(r.homeClubId);
      const homeUser = homeOcc ? userMap?.get(homeOcc.userId) || { id: homeOcc.userId, username: usernameMap.get(homeOcc.userId) || "", displayName: usernameMap.get(homeOcc.userId) || "" } : null;
      const awayOcc = clubOccupancyMap.get(r.awayClubId);
      const awayUser = awayOcc ? userMap?.get(awayOcc.userId) || { id: awayOcc.userId, username: usernameMap.get(awayOcc.userId) || "", displayName: usernameMap.get(awayOcc.userId) || "" } : null;
      const fixtureSubs = submissionsMap.get(r.id) || [];
      const userSubmission = filter.userId ? fixtureSubs.find((s) => s.submittedByUserId === filter.userId) : void 0;
      const opponentSubmission = filter.userId ? fixtureSubs.find((s) => s.submittedByUserId !== filter.userId) : void 0;
      return {
        id: r.id,
        seasonId: r.seasonId,
        competitionId: r.competitionId,
        competitionName: r.competitionName || r.competitionId,
        matchday: r.matchday,
        roundName: r.roundName,
        homeClubId: !r.homeClubId || r.homeClubId === "TBD" ? null : r.homeClubId,
        awayClubId: !r.awayClubId || r.awayClubId === "TBD" ? null : r.awayClubId,
        homeClub: !r.homeClubId || r.homeClubId === "TBD" ? null : {
          id: r.homeClubId,
          name: homeSeed?.name || r.homeClubId,
          shortName: homeSeed?.shortName || r.homeClubId,
          country: homeSeed?.country || "",
          leagueId: homeSeed?.leagueId || "",
          logoUrl: homeSeed?.logoUrl || "",
          active: true,
          isTaken: Boolean(homeOcc),
          claimedByUserId: homeOcc ? homeOcc.userId : null,
          claimedByUsername: homeOcc ? usernameMap.get(homeOcc.userId) || null : null,
          createdAt: ""
        },
        awayClub: !r.awayClubId || r.awayClubId === "TBD" ? null : {
          id: r.awayClubId,
          name: awaySeed?.name || r.awayClubId,
          shortName: awaySeed?.shortName || r.awayClubId,
          country: awaySeed?.country || "",
          leagueId: awaySeed?.leagueId || "",
          logoUrl: awaySeed?.logoUrl || "",
          active: true,
          isTaken: Boolean(awayOcc),
          claimedByUserId: awayOcc ? awayOcc.userId : null,
          claimedByUsername: awayOcc ? usernameMap.get(awayOcc.userId) || null : null,
          createdAt: ""
        },
        homeOwnerId: homeOcc ? homeOcc.userId : r.homeOwnerId,
        awayOwnerId: awayOcc ? awayOcc.userId : r.awayOwnerId,
        homeUser,
        awayUser,
        activeMatchday,
        isPlayable,
        userSubmission,
        opponentSubmission,
        scheduledAt: r.scheduledAt,
        status: r.status,
        homeScore: r.homeScore ?? void 0,
        awayScore: r.awayScore ?? void 0,
        winnerClubId: r.winnerClubId ?? void 0,
        resultConfirmedAt: r.resultConfirmedAt ?? void 0,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      };
    });
    if (cacheKey) {
      setInCache(cacheKey, fixtures, 3e4);
      lastKnownGoodFixtures.set(cacheKey, fixtures);
    }
    return fixtures;
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    recordFallbackUsage();
    console.warn("[FIRESTORE FALLBACK] getFixturesFirestore:", err.message);
    return executeFixturesFallback(filter, targetClubId, cacheKey);
  }
}
async function executeFixturesFallback(filter, targetClubId, cacheKey) {
  if (cacheKey) {
    const memoryCached = lastKnownGoodFixtures.get(cacheKey) || getAnyCached(cacheKey);
    if (memoryCached && memoryCached.length > 0) {
      return memoryCached;
    }
  }
  let sql = `
    SELECT f.*,
           hc.name as home_name, hc.short_name as home_short, hc.country as home_country, hc.league_id as home_league, hc.logo_url as home_logo,
           ac.name as away_name, ac.short_name as away_short, ac.country as away_country, ac.league_id as away_league, ac.logo_url as away_logo
    FROM fixtures f
    LEFT JOIN clubs hc ON f.home_club_id = hc.id
    LEFT JOIN clubs ac ON f.away_club_id = ac.id
    WHERE 1=1
  `;
  const params = [];
  if (filter.competitionId) {
    sql += " AND f.competition_id = ?";
    params.push(filter.competitionId);
  }
  if (filter.seasonId) {
    sql += " AND f.season_id = ?";
    params.push(filter.seasonId);
  }
  if (filter.matchday) {
    sql += " AND f.matchday = ?";
    params.push(filter.matchday);
  }
  if (filter.status) {
    sql += " AND f.status = ?";
    params.push(filter.status);
  }
  if (targetClubId) {
    sql += " AND (f.home_club_id = ? OR f.away_club_id = ?)";
    params.push(targetClubId, targetClubId);
  }
  sql += " ORDER BY f.matchday ASC, f.scheduled_at ASC";
  if (filter.limit && filter.limit > 0) {
    sql += " LIMIT ?";
    params.push(filter.limit);
  }
  const { clubOccupancyMap, usernameMap, userMap } = await getActiveOccupanciesForSeason(filter.seasonId || "season-2026-27");
  const rows = queryAll(sql, params);
  const localSubsMap = /* @__PURE__ */ new Map();
  if (filter.userId && rows.length > 0) {
    try {
      const fixIds = rows.map((r) => r.id);
      const subsRows = queryAll(
        `SELECT * FROM result_submissions WHERE fixture_id IN (${fixIds.map(() => "?").join(",")})`,
        fixIds
      );
      for (const s of subsRows) {
        const arr = localSubsMap.get(s.fixture_id) || [];
        arr.push({
          id: s.id,
          fixtureId: s.fixture_id,
          userId: s.submitted_by_user_id,
          submittedByUserId: s.submitted_by_user_id,
          clubId: s.club_id,
          homeScore: s.home_score,
          awayScore: s.away_score,
          proofUrl: s.proof_url || null,
          createdAt: s.created_at
        });
        localSubsMap.set(s.fixture_id, arr);
      }
    } catch {
    }
  }
  const fallbackFixtures = rows.map((r) => {
    const comp = compOverrideMap.get(r.competition_id);
    const { isPlayable, activeMatchday } = checkFixturePlayability(
      r.competition_id,
      r.season_id,
      r.matchday,
      r.status,
      r.home_club_id,
      r.away_club_id,
      comp
    );
    const homeOcc = clubOccupancyMap.get(r.home_club_id);
    const homeUser = homeOcc ? userMap?.get(homeOcc.userId) || { id: homeOcc.userId, username: usernameMap.get(homeOcc.userId) || "", displayName: usernameMap.get(homeOcc.userId) || "" } : null;
    const awayOcc = clubOccupancyMap.get(r.away_club_id);
    const awayUser = awayOcc ? userMap?.get(awayOcc.userId) || { id: awayOcc.userId, username: usernameMap.get(awayOcc.userId) || "", displayName: usernameMap.get(awayOcc.userId) || "" } : null;
    const fixtureSubs = localSubsMap.get(r.id) || [];
    const userSubmission = filter.userId ? fixtureSubs.find((s) => s.submittedByUserId === filter.userId) : void 0;
    const opponentSubmission = filter.userId ? fixtureSubs.find((s) => s.submittedByUserId !== filter.userId) : void 0;
    return {
      id: r.id,
      seasonId: r.season_id,
      competitionId: r.competition_id,
      competitionName: r.competition_name || r.competition_id,
      matchday: r.matchday,
      roundName: r.round_name,
      homeClubId: !r.home_club_id || r.home_club_id === "TBD" ? null : r.home_club_id,
      awayClubId: !r.away_club_id || r.away_club_id === "TBD" ? null : r.away_club_id,
      homeClub: !r.home_club_id || r.home_club_id === "TBD" ? null : {
        id: r.home_club_id,
        name: r.home_name || r.home_club_id,
        shortName: r.home_short || r.home_club_id,
        country: r.home_country || "",
        leagueId: r.home_league || "",
        logoUrl: r.home_logo || "",
        active: true,
        isTaken: Boolean(homeOcc),
        claimedByUserId: homeOcc ? homeOcc.userId : null,
        claimedByUsername: homeOcc ? usernameMap.get(homeOcc.userId) || null : null,
        createdAt: ""
      },
      awayClub: !r.away_club_id || r.away_club_id === "TBD" ? null : {
        id: r.away_club_id,
        name: r.away_name || r.away_club_id,
        shortName: r.away_short || r.away_club_id,
        country: r.away_country || "",
        leagueId: r.away_league || "",
        logoUrl: r.away_logo || "",
        active: true,
        isTaken: Boolean(awayOcc),
        claimedByUserId: awayOcc ? awayOcc.userId : null,
        claimedByUsername: awayOcc ? usernameMap.get(awayOcc.userId) || null : null,
        createdAt: ""
      },
      homeOwnerId: homeOcc ? homeOcc.userId : r.home_owner_id,
      awayOwnerId: awayOcc ? awayOcc.userId : r.away_owner_id,
      homeUser,
      awayUser,
      activeMatchday,
      isPlayable,
      userSubmission,
      opponentSubmission,
      scheduledAt: r.scheduled_at,
      status: r.status,
      homeScore: r.home_score !== null && r.home_score !== void 0 ? r.home_score : void 0,
      awayScore: r.away_score !== null && r.away_score !== void 0 ? r.away_score : void 0,
      winnerClubId: r.winner_club_id || void 0,
      resultConfirmedAt: r.result_confirmed_at || void 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  });
  if (cacheKey && fallbackFixtures.length > 0) {
    setInCache(cacheKey, fallbackFixtures, 3e4);
    lastKnownGoodFixtures.set(cacheKey, fallbackFixtures);
  }
  return fallbackFixtures;
}
function executeAdminFixturesPagedFallback(options, pageSize) {
  const conditions = ["1=1"];
  const params = [];
  if (options.competitionId) {
    conditions.push("f.competition_id = ?");
    params.push(options.competitionId);
  } else if (options.seasonId) {
    conditions.push("f.season_id = ?");
    params.push(options.seasonId);
  }
  if (options.status) {
    conditions.push("f.status = ?");
    params.push(options.status);
  }
  if (options.matchday) {
    conditions.push("f.matchday = ?");
    params.push(options.matchday);
  }
  const whereStr = conditions.join(" AND ");
  const countRow = queryGet(`SELECT COUNT(*) as count FROM fixtures f WHERE ${whereStr}`, params);
  const total = countRow?.count || 0;
  let querySql = `
    SELECT f.*,
           hc.name as home_name, hc.short_name as home_short, hc.country as home_country, hc.league_id as home_league, hc.logo_url as home_logo,
           ac.name as away_name, ac.short_name as away_short, ac.country as away_country, ac.league_id as away_league, ac.logo_url as away_logo
    FROM fixtures f
    LEFT JOIN clubs hc ON f.home_club_id = hc.id
    LEFT JOIN clubs ac ON f.away_club_id = ac.id
    WHERE ${whereStr}
  `;
  const queryParams = [...params];
  if (options.cursor) {
    querySql += " AND f.id > ?";
    queryParams.push(options.cursor);
  }
  querySql += " ORDER BY f.id ASC LIMIT ?";
  queryParams.push(pageSize + 1);
  const rows = queryAll(querySql, queryParams);
  const hasMore = rows.length > pageSize;
  const pageRows = rows.slice(0, pageSize);
  const nextCursor = hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : void 0;
  const fixtures = pageRows.map((r) => ({
    id: r.id,
    competitionId: r.competition_id,
    seasonId: r.season_id,
    matchday: r.matchday,
    homeClubId: r.home_club_id,
    awayClubId: r.away_club_id,
    homeScore: r.home_score,
    awayScore: r.away_score,
    status: r.status,
    scheduledAt: r.scheduled_at,
    homeClub: {
      id: r.home_club_id,
      name: r.home_name || r.home_club_id,
      shortName: r.home_short || r.home_club_id.substring(0, 3).toUpperCase(),
      country: r.home_country || "England",
      leagueId: r.home_league || "league-premier-league",
      logoUrl: r.home_logo || "",
      active: true,
      createdAt: r.created_at || (/* @__PURE__ */ new Date()).toISOString()
    },
    awayClub: {
      id: r.away_club_id,
      name: r.away_name || r.away_club_id,
      shortName: r.away_short || r.away_club_id.substring(0, 3).toUpperCase(),
      country: r.away_country || "England",
      leagueId: r.away_league || "league-premier-league",
      logoUrl: r.away_logo || "",
      active: true,
      createdAt: r.created_at || (/* @__PURE__ */ new Date()).toISOString()
    },
    createdAt: r.created_at || (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: r.updated_at || (/* @__PURE__ */ new Date()).toISOString()
  }));
  return {
    fixtures,
    total,
    hasMore,
    nextCursor,
    limit: pageSize,
    source: "sqlite",
    degraded: true,
    stale: true,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function getAdminFixturesPagedFirestore(options = {}) {
  const result = await getAdminFixturesFromReadModel({
    seasonId: options.seasonId,
    competitionId: options.competitionId,
    status: options.status,
    matchday: options.matchday,
    clubId: options.clubId,
    userId: options.userId,
    search: options.search,
    cursor: options.cursor,
    limit: options.limit
  });
  return {
    fixtures: result.fixtures,
    total: result.total,
    hasMore: result.hasMore,
    nextCursor: result.nextCursor,
    limit: result.limit,
    source: result.source,
    degraded: result.degraded,
    stale: result.stale,
    errorCode: result.degraded ? "ADMIN_FIXTURES_DEGRADED" : void 0,
    generatedAt: result.generatedAt
  };
}
async function getFixtureByIdFirestore(fixtureId, currentUserId) {
  const cacheKey = `firestore:fixture:${fixtureId}:${currentUserId || "anon"}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      trackFirestoreRead(COLLECTIONS.FIXTURES, 1, "getFixtureByIdFirestore");
      const doc = await db.collection(COLLECTIONS.FIXTURES).doc(fixtureId).get();
      if (doc.exists) {
        firestoreCircuitBreaker.recordSuccess();
        const r2 = doc.data();
        const homeSeed = SEED_CLUB_MAP.get(r2.homeClubId);
        const awaySeed = SEED_CLUB_MAP.get(r2.awayClubId);
        const { clubOccupancyMap: clubOccupancyMap2, usernameMap: usernameMap2, userMap: userMap2 } = await getActiveOccupanciesForSeason(r2.seasonId || "season-2026-27");
        const homeOcc2 = clubOccupancyMap2.get(r2.homeClubId);
        const homeUser2 = homeOcc2 ? userMap2?.get(homeOcc2.userId) || { id: homeOcc2.userId, username: usernameMap2.get(homeOcc2.userId) || "", displayName: usernameMap2.get(homeOcc2.userId) || "" } : null;
        const awayOcc2 = clubOccupancyMap2.get(r2.awayClubId);
        const awayUser2 = awayOcc2 ? userMap2?.get(awayOcc2.userId) || { id: awayOcc2.userId, username: usernameMap2.get(awayOcc2.userId) || "", displayName: usernameMap2.get(awayOcc2.userId) || "" } : null;
        let comp2 = compOverrideMap.get(r2.competitionId);
        if (!comp2 && r2.competitionId) {
          try {
            const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(r2.competitionId).get();
            if (compDoc.exists) {
              comp2 = compDoc.data();
              compOverrideMap.set(r2.competitionId, comp2);
            }
          } catch {
          }
        }
        const { isPlayable: isPlayable2, activeMatchday: activeMatchday2 } = checkFixturePlayability(
          r2.competitionId,
          r2.seasonId,
          r2.matchday,
          r2.status,
          r2.homeClubId,
          r2.awayClubId,
          comp2
        );
        let userSubmission2 = void 0;
        let opponentSubmission2 = void 0;
        try {
          const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where("fixtureId", "==", fixtureId).get();
          if (!subsSnap.empty) {
            for (const sDoc of subsSnap.docs) {
              const sData = sDoc.data();
              const subObj = {
                id: sDoc.id,
                fixtureId: sData.fixtureId,
                userId: sData.submittedByUserId,
                submittedByUserId: sData.submittedByUserId,
                clubId: sData.clubId,
                homeScore: sData.homeScore,
                awayScore: sData.awayScore,
                proofUrl: sData.proofUrl || null,
                createdAt: sData.createdAt
              };
              if (currentUserId && sData.submittedByUserId === currentUserId) {
                userSubmission2 = subObj;
              } else if (currentUserId) {
                opponentSubmission2 = subObj;
              }
            }
          }
        } catch {
        }
        const fix = {
          id: doc.id,
          seasonId: r2.seasonId,
          competitionId: r2.competitionId,
          competitionName: r2.competitionName || r2.competitionId,
          matchday: r2.matchday,
          roundName: r2.roundName,
          homeClubId: !r2.homeClubId || r2.homeClubId === "TBD" ? null : r2.homeClubId,
          awayClubId: !r2.awayClubId || r2.awayClubId === "TBD" ? null : r2.awayClubId,
          homeClub: !r2.homeClubId || r2.homeClubId === "TBD" ? null : {
            id: r2.homeClubId,
            name: homeSeed?.name || r2.homeClubId,
            shortName: homeSeed?.shortName || r2.homeClubId,
            country: homeSeed?.country || "",
            leagueId: homeSeed?.leagueId || "",
            logoUrl: homeSeed?.logoUrl || "",
            active: true,
            isTaken: Boolean(homeOcc2),
            claimedByUserId: homeOcc2 ? homeOcc2.userId : null,
            claimedByUsername: homeOcc2 ? usernameMap2.get(homeOcc2.userId) || null : null,
            createdAt: ""
          },
          awayClub: !r2.awayClubId || r2.awayClubId === "TBD" ? null : {
            id: r2.awayClubId,
            name: awaySeed?.name || r2.awayClubId,
            shortName: awaySeed?.shortName || r2.awayClubId,
            country: awaySeed?.country || "",
            leagueId: awaySeed?.leagueId || "",
            logoUrl: awaySeed?.logoUrl || "",
            active: true,
            isTaken: Boolean(awayOcc2),
            claimedByUserId: awayOcc2 ? awayOcc2.userId : null,
            claimedByUsername: awayOcc2 ? usernameMap2.get(awayOcc2.userId) || null : null,
            createdAt: ""
          },
          sourceFixtureId: r2.sourceFixtureId || null,
          sourceWinnerSlot: r2.sourceWinnerSlot || null,
          homeSourceFixtureId: r2.homeSourceFixtureId || null,
          awaySourceFixtureId: r2.awaySourceFixtureId || null,
          homeSourceWinnerSlot: r2.homeSourceWinnerSlot || null,
          awaySourceWinnerSlot: r2.awaySourceWinnerSlot || null,
          homeOwnerId: homeOcc2 ? homeOcc2.userId : r2.homeOwnerId,
          awayOwnerId: awayOcc2 ? awayOcc2.userId : r2.awayOwnerId,
          homeUser: homeUser2,
          awayUser: awayUser2,
          activeMatchday: activeMatchday2,
          isPlayable: isPlayable2,
          userSubmission: userSubmission2,
          opponentSubmission: opponentSubmission2,
          scheduledAt: r2.scheduledAt,
          status: r2.status,
          homeScore: r2.homeScore ?? void 0,
          awayScore: r2.awayScore ?? void 0,
          winnerClubId: r2.winnerClubId ?? void 0,
          resultConfirmedAt: r2.resultConfirmedAt ?? void 0,
          createdAt: r2.createdAt,
          updatedAt: r2.updatedAt
        };
        setInCache(cacheKey, fix, 3e4);
        return fix;
      }
    } catch (err) {
      firestoreCircuitBreaker.recordFailure(err);
      recordFallbackUsage();
      console.warn("[FIRESTORE FALLBACK] getFixtureByIdFirestore:", err.message);
    }
  } else {
    recordFallbackUsage();
  }
  const r = queryGet(
    `SELECT f.*,
            hc.name as home_name, hc.short_name as home_short, hc.country as home_country, hc.league_id as home_league, hc.logo_url as home_logo,
            ac.name as away_name, ac.short_name as away_short, ac.country as away_country, ac.league_id as away_league, ac.logo_url as away_logo
     FROM fixtures f
     LEFT JOIN clubs hc ON f.home_club_id = hc.id
     LEFT JOIN clubs ac ON f.away_club_id = ac.id
     WHERE f.id = ?`,
    [fixtureId]
  );
  if (!r) return null;
  const { clubOccupancyMap, usernameMap, userMap } = await getActiveOccupanciesForSeason(r.season_id || "season-2026-27");
  const homeOcc = clubOccupancyMap.get(r.home_club_id);
  const homeUser = homeOcc ? userMap?.get(homeOcc.userId) || { id: homeOcc.userId, username: usernameMap.get(homeOcc.userId) || "", displayName: usernameMap.get(homeOcc.userId) || "" } : null;
  const awayOcc = clubOccupancyMap.get(r.away_club_id);
  const awayUser = awayOcc ? userMap?.get(awayOcc.userId) || { id: awayOcc.userId, username: usernameMap.get(awayOcc.userId) || "", displayName: usernameMap.get(awayOcc.userId) || "" } : null;
  let userSubmission = void 0;
  let opponentSubmission = void 0;
  try {
    const localSubs = queryAll("SELECT * FROM result_submissions WHERE fixture_id = ?", [fixtureId]);
    for (const s of localSubs) {
      const sub = {
        id: s.id,
        fixtureId: s.fixture_id,
        userId: s.submitted_by_user_id,
        submittedByUserId: s.submitted_by_user_id,
        clubId: s.club_id,
        homeScore: s.home_score,
        awayScore: s.away_score,
        proofUrl: s.proof_url || null,
        createdAt: s.created_at
      };
      if (currentUserId && s.submitted_by_user_id === currentUserId) {
        userSubmission = sub;
      } else if (currentUserId && s.submitted_by_user_id !== currentUserId) {
        opponentSubmission = sub;
      }
    }
  } catch {
  }
  const comp = compOverrideMap.get(r.competition_id);
  const { isPlayable, activeMatchday } = checkFixturePlayability(
    r.competition_id,
    r.season_id,
    r.matchday,
    r.status,
    r.home_club_id,
    r.away_club_id,
    comp
  );
  const fallbackFix = {
    id: r.id,
    seasonId: r.season_id,
    competitionId: r.competition_id,
    competitionName: r.competition_name || r.competition_id,
    matchday: r.matchday,
    roundName: r.round_name,
    homeClubId: !r.home_club_id || r.home_club_id === "TBD" ? null : r.home_club_id,
    awayClubId: !r.away_club_id || r.away_club_id === "TBD" ? null : r.away_club_id,
    homeClub: !r.home_club_id || r.home_club_id === "TBD" ? null : {
      id: r.home_club_id,
      name: r.home_name || r.home_club_id,
      shortName: r.home_short || r.home_club_id,
      country: r.home_country || "",
      leagueId: r.home_league || "",
      logoUrl: r.home_logo || "",
      active: true,
      isTaken: Boolean(homeOcc),
      claimedByUserId: homeOcc ? homeOcc.userId : null,
      claimedByUsername: homeOcc ? usernameMap.get(homeOcc.userId) || null : null,
      createdAt: ""
    },
    awayClub: !r.away_club_id || r.away_club_id === "TBD" ? null : {
      id: r.away_club_id,
      name: r.away_name || r.away_club_id,
      shortName: r.away_short || r.away_club_id,
      country: r.away_country || "",
      leagueId: r.away_league || "",
      logoUrl: r.away_logo || "",
      active: true,
      isTaken: Boolean(awayOcc),
      claimedByUserId: awayOcc ? awayOcc.userId : null,
      claimedByUsername: awayOcc ? usernameMap.get(awayOcc.userId) || null : null,
      createdAt: ""
    },
    sourceFixtureId: r.source_fixture_id || null,
    sourceWinnerSlot: r.source_winner_slot || null,
    homeOwnerId: homeOcc ? homeOcc.userId : r.home_owner_id,
    awayOwnerId: awayOcc ? awayOcc.userId : r.away_owner_id,
    homeUser,
    awayUser,
    activeMatchday,
    isPlayable,
    userSubmission,
    opponentSubmission,
    scheduledAt: r.scheduled_at,
    status: r.status,
    homeScore: r.home_score !== null && r.home_score !== void 0 ? r.home_score : void 0,
    awayScore: r.away_score !== null && r.away_score !== void 0 ? r.away_score : void 0,
    winnerClubId: r.winner_club_id || void 0,
    resultConfirmedAt: r.result_confirmed_at || void 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
  setInCache(cacheKey, fallbackFix, 3e4);
  return fallbackFix;
}
async function getCompetitionParticipantsFirestore(competitionId) {
  const cacheKey = `firestore:participants:${competitionId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const db = getFirestoreDb();
    trackFirestoreRead(COLLECTIONS.COMPETITION_PARTICIPANTS, 1, "getCompetitionParticipantsFirestore");
    const snap = await db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where("competitionId", "==", competitionId).orderBy("seedNumber", "asc").get();
    if (!snap.empty) {
      const participants = snap.docs.map((d) => {
        const data = d.data();
        const club = SEED_CLUBS.find((c) => c.id === data.clubId);
        return {
          id: d.id,
          competitionId: data.competitionId,
          clubId: data.clubId,
          clubName: club?.name || data.clubId,
          shortName: club?.shortName || data.clubId,
          clubLogoUrl: club?.logoUrl || "",
          ownerUserId: data.ownerUserId,
          ownerUsername: data.ownerUsername,
          sourceCompetitionId: data.sourceCompetitionId,
          sourceCompetitionName: data.sourceCompetitionName,
          sourcePosition: data.sourcePosition,
          qualificationReason: data.qualificationReason,
          seedNumber: data.seedNumber,
          createdAt: data.createdAt
        };
      });
      setInCache(cacheKey, participants, 3e5);
      return participants;
    }
    const sqliteParts = queryAll(
      `SELECT cp.*, c.name as club_name, c.short_name, c.logo_url
       FROM competition_participants cp
       JOIN clubs c ON cp.club_id = c.id
       WHERE cp.competition_id = ?
       ORDER BY cp.seed_number ASC`,
      [competitionId]
    );
    const parts = sqliteParts.map((p) => ({
      id: p.id,
      competitionId: p.competition_id,
      clubId: p.club_id,
      clubName: p.club_name,
      shortName: p.short_name,
      clubLogoUrl: p.logo_url,
      ownerUserId: p.owner_user_id,
      sourceCompetitionId: p.source_competition_id,
      sourcePosition: p.source_position,
      qualificationReason: p.qualification_reason,
      seedNumber: p.seed_number,
      createdAt: p.created_at
    }));
    setInCache(cacheKey, parts, 3e5);
    return parts;
  } catch (err) {
    console.warn("[FIRESTORE] getCompetitionParticipantsFirestore error:", err.message);
    return [];
  }
}
async function generateCompetitionFixturesFirestore(competitionId, options = {}) {
  const db = getFirestoreDb();
  const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }
  const comp = compDoc.data();
  const existingSnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", competitionId).get();
  if (!existingSnap.empty && !options.force) {
    const matchdays = new Set(existingSnap.docs.map((d) => d.data().matchday)).size;
    return { generated: existingSnap.size, matchdays };
  }
  let clubIds = [];
  const partSnap = await db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where("competitionId", "==", competitionId).orderBy("seedNumber", "asc").get();
  if (!partSnap.empty) {
    clubIds = partSnap.docs.map((d) => d.data().clubId);
  } else if (comp.leagueId) {
    const leagueClubsSnap = await db.collection(COLLECTIONS.CLUBS).where("leagueId", "==", comp.leagueId).where("isActive", "==", true).get();
    clubIds = leagueClubsSnap.docs.map((d) => d.id).sort();
  }
  if (clubIds.length < 2) {
    throw new Error(`Not enough clubs (${clubIds.length}) to generate fixtures for ${comp.name}.`);
  }
  const generatedFixtures = [];
  const startDate = /* @__PURE__ */ new Date("2026-08-15T15:00:00.000Z");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let totalRounds = 0;
  if (comp.type === "EUROPEAN_LEAGUE_PHASE" || competitionId.includes("ucl") || competitionId.includes("uel")) {
    const europeanSchedule = generateEuropean32LeaguePhaseSchedule(clubIds);
    totalRounds = 8;
    for (const match of europeanSchedule) {
      const matchDate = new Date(startDate.getTime() + (match.matchday - 1) * 7 * 24 * 60 * 60 * 1e3).toISOString();
      const homeSlug = match.homeClubId.replace("club-", "");
      const awaySlug = match.awayClubId.replace("club-", "");
      const id = `fix-${competitionId}-md${match.matchday}-${homeSlug}-vs-${awaySlug}`;
      generatedFixtures.push({
        id,
        competitionId,
        competitionName: comp.name,
        seasonId: comp.seasonId,
        matchday: match.matchday,
        roundName: `Matchday ${match.matchday}`,
        homeClubId: match.homeClubId,
        awayClubId: match.awayClubId,
        scheduledAt: matchDate,
        status: "SCHEDULED",
        createdAt: now,
        updatedAt: now
      });
    }
  } else {
    const teams = [...clubIds];
    if (teams.length % 2 !== 0) {
      teams.push("BYE");
    }
    const numTeams = teams.length;
    const numRounds = numTeams - 1;
    const halfSize = numTeams / 2;
    totalRounds = numRounds;
    for (let round = 0; round < numRounds; round++) {
      const matchday = round + 1;
      const matchDate = new Date(startDate.getTime() + round * 7 * 24 * 60 * 60 * 1e3).toISOString();
      for (let i = 0; i < halfSize; i++) {
        const home = teams[i];
        const away = teams[numTeams - 1 - i];
        if (home !== "BYE" && away !== "BYE") {
          const isAlternate = (round + i) % 2 === 1;
          const actualHome = isAlternate ? away : home;
          const actualAway = isAlternate ? home : away;
          const homeSlug = actualHome.replace("club-", "");
          const awaySlug = actualAway.replace("club-", "");
          const id = `fix-${competitionId}-md${matchday}-${homeSlug}-vs-${awaySlug}`;
          generatedFixtures.push({
            id,
            competitionId,
            competitionName: comp.name,
            seasonId: comp.seasonId,
            matchday,
            roundName: `Matchday ${matchday}`,
            homeClubId: actualHome,
            awayClubId: actualAway,
            scheduledAt: matchDate,
            status: "SCHEDULED",
            createdAt: now,
            updatedAt: now
          });
        }
      }
      teams.splice(1, 0, teams.pop());
    }
  }
  const toDeleteSnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", competitionId).get();
  const confirmedMap = /* @__PURE__ */ new Map();
  if (!toDeleteSnap.empty) {
    for (const doc of toDeleteSnap.docs) {
      const data = doc.data();
      if (data.status === "CONFIRMED" && data.homeScore !== null && data.homeScore !== void 0) {
        confirmedMap.set(`${data.homeClubId}->${data.awayClubId}`, {
          homeScore: data.homeScore,
          awayScore: data.awayScore ?? 0,
          winnerClubId: data.winnerClubId,
          resultConfirmedAt: data.resultConfirmedAt
        });
      }
    }
    const batchSize2 = 400;
    for (let i = 0; i < toDeleteSnap.docs.length; i += batchSize2) {
      const chunk = toDeleteSnap.docs.slice(i, i + batchSize2);
      const batch = db.batch();
      chunk.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
  }
  for (const fix of generatedFixtures) {
    const key = `${fix.homeClubId}->${fix.awayClubId}`;
    const revKey = `${fix.awayClubId}->${fix.homeClubId}`;
    if (confirmedMap.has(key)) {
      const match = confirmedMap.get(key);
      fix.status = "CONFIRMED";
      fix.homeScore = match.homeScore;
      fix.awayScore = match.awayScore;
      fix.winnerClubId = match.winnerClubId;
      fix.resultConfirmedAt = match.resultConfirmedAt;
    } else if (confirmedMap.has(revKey)) {
      const match = confirmedMap.get(revKey);
      fix.status = "CONFIRMED";
      fix.homeScore = match.awayScore;
      fix.awayScore = match.homeScore;
      fix.winnerClubId = match.winnerClubId;
      fix.resultConfirmedAt = match.resultConfirmedAt;
    }
  }
  const batchSize = 400;
  for (let i = 0; i < generatedFixtures.length; i += batchSize) {
    const chunk = generatedFixtures.slice(i, i + batchSize);
    const batch = db.batch();
    for (const fix of chunk) {
      const ref = db.collection(COLLECTIONS.FIXTURES).doc(fix.id);
      batch.set(ref, fix);
    }
    await batch.commit();
  }
  let verifySnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", competitionId).get();
  if (verifySnap.size !== generatedFixtures.length) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    verifySnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", competitionId).get();
  }
  if (verifySnap.size !== generatedFixtures.length) {
    throw new Error(
      `FIXTURE_PERSISTENCE_FAILED: Expected ${generatedFixtures.length} fixtures, but Firestore has ${verifySnap.size}.`
    );
  }
  const nextOpenAt = new Date(Date.now() + 30 * 3600 * 1e3).toISOString();
  await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).update({
    status: "active",
    hasFixtures: true,
    fixtureCount: verifySnap.size,
    fixturesCount: verifySnap.size,
    generationStatus: "generated",
    currentMatchday: 1,
    totalMatchdays: totalRounds,
    isMatchdayOpen: true,
    matchdayOpenedAt: now,
    matchdayDurationHours: 30,
    nextMatchdayOpenAt: nextOpenAt,
    adminOverrideStatus: "AUTO",
    updatedAt: now
  });
  try {
    for (const fix of generatedFixtures) {
      queryRun(
        `INSERT OR REPLACE INTO fixtures (id, competition_id, season_id, matchday, round_name, home_club_id, away_club_id, scheduled_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fix.id,
          fix.competitionId,
          fix.seasonId,
          fix.matchday,
          fix.roundName,
          fix.homeClubId,
          fix.awayClubId,
          fix.scheduledAt,
          fix.status,
          fix.createdAt,
          fix.updatedAt
        ]
      );
    }
  } catch (sqliteErr) {
    console.warn("[SQLITE SYNC] Fixtures sync warning:", sqliteErr);
  }
  invalidateFirestoreCache("firestore:comp");
  return { generated: verifySnap.size, matchdays: totalRounds };
}
function getMatchdayLockKey(seasonId, competitionId, matchday) {
  return `${seasonId}:${competitionId}:${matchday}`;
}
function invalidateMatchdayLockCache(seasonId, competitionId, matchday) {
  if (matchday !== void 0) {
    const key = getMatchdayLockKey(seasonId, competitionId, matchday);
    matchdayLocksCache.delete(key);
    serverCache.delete(`lock:${key}`);
  } else {
    const prefix = `${seasonId}:${competitionId}:`;
    for (const k of Array.from(matchdayLocksCache.keys())) {
      if (k.startsWith(prefix)) {
        matchdayLocksCache.delete(k);
        serverCache.delete(`lock:${k}`);
      }
    }
  }
}
function ensureMatchdayLocksTable() {
  try {
    queryRun(`
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
      )
    `);
  } catch {
  }
}
async function getCompetitionMatchdayLocksFirestore(seasonId, competitionId) {
  const result = {};
  try {
    const rows = queryAll(
      "SELECT * FROM matchday_locks WHERE season_id = ? AND competition_id = ? ORDER BY matchday ASC",
      [seasonId, competitionId]
    );
    for (const row of rows) {
      const lockDoc = {
        id: row.id,
        seasonId: row.season_id,
        competitionId: row.competition_id,
        matchday: row.matchday,
        overrideStatus: row.override_status,
        isOpen: Boolean(row.is_open),
        isLocked: Boolean(row.is_locked),
        durationHours: row.duration_hours || void 0,
        openedAt: row.opened_at || void 0,
        lockedAt: row.locked_at || void 0,
        expiresAt: row.expires_at || void 0,
        updatedAt: row.updated_at
      };
      result[row.matchday] = lockDoc;
      matchdayLocksCache.set(row.id, lockDoc);
    }
  } catch {
  }
  return result;
}
async function getMatchdayLockFirestore(seasonId, competitionId, matchday) {
  const key = getMatchdayLockKey(seasonId, competitionId, matchday);
  if (matchdayLocksCache.has(key)) {
    return matchdayLocksCache.get(key);
  }
  try {
    const db = getFirestoreDb();
    const docRef = db.collection(COLLECTIONS.MATCHDAY_LOCKS).doc(key);
    const snap = await docRef.get();
    if (snap.exists) {
      const data = snap.data();
      matchdayLocksCache.set(key, data);
      return data;
    }
  } catch {
  }
  try {
    const row = queryGet(
      "SELECT * FROM matchday_locks WHERE season_id = ? AND competition_id = ? AND matchday = ?",
      [seasonId, competitionId, matchday]
    );
    if (row) {
      const data = {
        id: row.id,
        seasonId: row.season_id,
        competitionId: row.competition_id,
        matchday: row.matchday,
        overrideStatus: row.override_status,
        isOpen: Boolean(row.is_open),
        isLocked: Boolean(row.is_locked),
        durationHours: row.duration_hours || void 0,
        openedAt: row.opened_at || void 0,
        lockedAt: row.locked_at || void 0,
        expiresAt: row.expires_at || void 0,
        updatedAt: row.updated_at
      };
      matchdayLocksCache.set(key, data);
      return data;
    }
  } catch {
  }
  return null;
}
async function setMatchdayLockFirestore(seasonId, competitionId, matchday, params) {
  const key = getMatchdayLockKey(seasonId, competitionId, matchday);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const durationHours = params.durationHours || 30;
  const expiresAt = params.overrideStatus === "FORCE_OPEN" || params.overrideStatus === "AUTO" ? new Date(Date.now() + durationHours * 3600 * 1e3).toISOString() : void 0;
  const isOpen = params.overrideStatus === "FORCE_OPEN" || params.overrideStatus === "AUTO";
  const isLocked = params.overrideStatus === "FORCE_LOCKED" || params.overrideStatus === "PAUSED";
  const lockDoc = {
    id: key,
    seasonId,
    competitionId,
    matchday,
    overrideStatus: params.overrideStatus,
    isOpen,
    isLocked,
    durationHours,
    openedAt: isOpen ? now : void 0,
    lockedAt: isLocked ? now : void 0,
    expiresAt,
    updatedAt: now,
    updatedByUserId: params.adminUserId
  };
  matchdayLocksCache.set(key, lockDoc);
  try {
    const db = getFirestoreDb();
    await db.collection(COLLECTIONS.MATCHDAY_LOCKS).doc(key).set(lockDoc, { merge: true });
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] setMatchdayLockFirestore:", err.message);
  }
  try {
    queryRun(
      `INSERT INTO matchday_locks (id, season_id, competition_id, matchday, override_status, is_open, is_locked, duration_hours, opened_at, locked_at, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         override_status = excluded.override_status,
         is_open = excluded.is_open,
         is_locked = excluded.is_locked,
         duration_hours = excluded.duration_hours,
         opened_at = excluded.opened_at,
         locked_at = excluded.locked_at,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at
       WHERE matchday_locks.season_id = excluded.season_id
         AND matchday_locks.competition_id = excluded.competition_id
         AND matchday_locks.matchday = excluded.matchday`,
      [
        key,
        seasonId,
        competitionId,
        matchday,
        params.overrideStatus,
        isOpen ? 1 : 0,
        isLocked ? 1 : 0,
        durationHours,
        lockDoc.openedAt || null,
        lockDoc.lockedAt || null,
        lockDoc.expiresAt || null,
        now
      ]
    );
  } catch {
  }
  try {
    const existingComp = compOverrideMap.get(competitionId);
    if (!existingComp || existingComp.currentMatchday === matchday || !existingComp.currentMatchday) {
      compOverrideMap.set(competitionId, {
        ...existingComp,
        adminOverrideStatus: params.overrideStatus,
        isMatchdayOpen: isOpen
      });
      const db = getFirestoreDb();
      await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).update({
        adminOverrideStatus: params.overrideStatus,
        isMatchdayOpen: isOpen,
        updatedAt: now
      }).catch(() => {
      });
    }
  } catch {
  }
  invalidateMatchdayLockCache(seasonId, competitionId, matchday);
  serverCache.delete(`firestore:comp:${competitionId}`);
  serverCache.delete(`firestore:competitions:${seasonId}`);
  serverCache.delete(`firestore:fixtures:${competitionId}`);
  return lockDoc;
}
function isMatchdayPlayableKey(seasonId, competitionId, matchday, compState) {
  const key = getMatchdayLockKey(seasonId, competitionId, matchday);
  const lock = matchdayLocksCache.get(key);
  if (lock) {
    if (lock.overrideStatus === "FORCE_OPEN") return true;
    if (lock.overrideStatus === "FORCE_LOCKED" || lock.overrideStatus === "PAUSED" || lock.isLocked) return false;
    if (lock.isOpen === false) return false;
    if (lock.isOpen === true) return true;
  }
  const activeMatchday = compState?.currentMatchday || 1;
  const adminStatus = compState?.adminOverrideStatus || "AUTO";
  const isMatchdayOpen = compState?.isMatchdayOpen !== false;
  const compType = compState?.type || (competitionId.includes("cup") || competitionId.includes("pokal") || competitionId.includes("rey") || competitionId.includes("italia") ? "KNOCKOUT" : "LEAGUE");
  const isKnockout = compType === "KNOCKOUT" || compType === "SUPER_CUP" || compType === "EUROPEAN_KNOCKOUT";
  if (adminStatus === "FORCE_LOCKED" || adminStatus === "PAUSED") return false;
  if (isKnockout) {
    return true;
  }
  if (adminStatus === "FORCE_OPEN") return matchday === activeMatchday;
  return isMatchdayOpen && matchday === activeMatchday;
}
async function assertMatchdayPlayableFirestore(seasonId, competitionId, matchday) {
  const key = getMatchdayLockKey(seasonId, competitionId, matchday);
  const lock = await getMatchdayLockFirestore(seasonId, competitionId, matchday);
  if (lock) {
    if (lock.overrideStatus === "FORCE_LOCKED" || lock.overrideStatus === "PAUSED" || lock.isLocked || lock.isOpen === false) {
      const err = new Error(`MATCHDAY_LOCKED: Matchday ${matchday} for competition '${competitionId}' is locked by tournament administration.`);
      err.code = "MATCHDAY_LOCKED";
      err.statusCode = 403;
      throw err;
    }
    if (lock.overrideStatus === "FORCE_OPEN" || lock.isOpen === true) {
      return;
    }
  }
  let comp = compOverrideMap.get(competitionId);
  if (!comp || !comp.type) {
    try {
      const db = getFirestoreDb();
      const doc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
      if (doc.exists) {
        const docData = doc.data();
        comp = { ...comp, ...docData };
        compOverrideMap.set(competitionId, comp);
      }
    } catch {
    }
  }
  if (!comp || !comp.type) {
    try {
      const row = queryGet("SELECT * FROM competitions WHERE id = ?", [competitionId]);
      if (row) {
        comp = {
          ...comp,
          id: row.id,
          seasonId: row.season_id,
          name: row.name,
          type: row.type,
          currentMatchday: comp?.currentMatchday || 1
        };
        compOverrideMap.set(competitionId, comp);
      }
    } catch {
    }
  }
  const activeMatchday = comp?.currentMatchday || 1;
  const adminStatus = comp?.adminOverrideStatus || "AUTO";
  const isMatchdayOpen = comp?.isMatchdayOpen !== false;
  const compType = comp?.type || (competitionId.includes("cup") || competitionId.includes("pokal") || competitionId.includes("rey") || competitionId.includes("italia") ? "KNOCKOUT" : "LEAGUE");
  const isKnockout = compType === "KNOCKOUT" || compType === "SUPER_CUP" || compType === "EUROPEAN_KNOCKOUT";
  if (adminStatus === "FORCE_LOCKED" || adminStatus === "PAUSED") {
    const err = new Error(`MATCHDAY_LOCKED: Submissions for competition '${competitionId}' are locked by tournament administration.`);
    err.code = "MATCHDAY_LOCKED";
    err.statusCode = 403;
    throw err;
  }
  if (isKnockout) {
    return;
  }
  if (adminStatus === "FORCE_OPEN") {
    if (matchday === activeMatchday) {
      return;
    }
    const err = new Error(`MATCHDAY_LOCKED: Matchday ${matchday} is locked. Admin open is active only for Matchday ${activeMatchday} in competition '${competitionId}'.`);
    err.code = "MATCHDAY_LOCKED";
    err.statusCode = 403;
    throw err;
  }
  if (matchday !== activeMatchday) {
    const err = new Error(`MATCHDAY_LOCKED: Matchday ${matchday} is locked. Only active Matchday ${activeMatchday} is open for competition '${competitionId}'.`);
    err.code = "MATCHDAY_LOCKED";
    err.statusCode = 403;
    throw err;
  }
}
async function advanceCompetitionMatchdayFirestore(competitionId, options = {}) {
  const db = getFirestoreDb();
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  const compDoc = await compRef.get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }
  const comp = compDoc.data();
  const seasonId = options.seasonId || comp.seasonId || "season-2026-27";
  const currentMd = comp.currentMatchday || 1;
  const totalMd = comp.totalMatchdays || 19;
  const nextMd = Math.min(totalMd, currentMd + 1);
  const durationHours = options.durationHours || comp.matchdayDurationHours || 30;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const nextOpenAt = new Date(Date.now() + durationHours * 3600 * 1e3).toISOString();
  await compRef.update({
    currentMatchday: nextMd,
    isMatchdayOpen: true,
    matchdayOpenedAt: now,
    matchdayDurationHours: durationHours,
    nextMatchdayOpenAt: nextOpenAt,
    adminOverrideStatus: "AUTO",
    updatedAt: now
  });
  const existingOverride = compOverrideMap.get(competitionId) || {};
  compOverrideMap.set(competitionId, {
    ...existingOverride,
    currentMatchday: nextMd,
    isMatchdayOpen: true,
    adminOverrideStatus: "AUTO"
  });
  await setMatchdayLockFirestore(seasonId, competitionId, nextMd, {
    overrideStatus: "AUTO",
    durationHours
  });
  invalidateFirestoreCache("firestore:comp");
  return {
    success: true,
    currentMatchday: nextMd,
    totalMatchdays: totalMd,
    isMatchdayOpen: true,
    nextMatchdayOpenAt: nextOpenAt
  };
}
async function setCompetitionMatchdayOverrideFirestore(competitionId, overrideStatus, options) {
  const db = getFirestoreDb();
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  const compDoc = await compRef.get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }
  const comp = compDoc.data();
  const seasonId = options?.seasonId || comp.seasonId || "season-2026-27";
  const targetMatchday = options?.matchday || comp.currentMatchday || 1;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const isMatchdayOpen = overrideStatus === "FORCE_OPEN" || overrideStatus === "AUTO";
  const lockDoc = await setMatchdayLockFirestore(seasonId, competitionId, targetMatchday, {
    overrideStatus,
    durationHours: options?.durationHours,
    adminUserId: options?.adminUserId
  });
  if (targetMatchday === (comp.currentMatchday || 1)) {
    await compRef.update({
      adminOverrideStatus: overrideStatus,
      isMatchdayOpen,
      updatedAt: now
    });
    const existingOverride = compOverrideMap.get(competitionId) || {};
    compOverrideMap.set(competitionId, {
      ...existingOverride,
      adminOverrideStatus: overrideStatus,
      isMatchdayOpen
    });
  }
  invalidateMatchdayLockCache(seasonId, competitionId, targetMatchday);
  serverCache.delete(`firestore:comp:${competitionId}`);
  serverCache.delete(`firestore:competitions:${seasonId}`);
  serverCache.delete(`firestore:fixtures:${competitionId}`);
  return {
    success: true,
    adminOverrideStatus: overrideStatus,
    isMatchdayOpen,
    matchdayLock: lockDoc
  };
}
async function openCompetitionMatchdayNowFirestore(competitionId, durationHours = 30, matchday, seasonId = "season-2026-27") {
  const db = getFirestoreDb();
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  const compDoc = await compRef.get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }
  const comp = compDoc.data();
  const targetMd = matchday || comp.currentMatchday || 1;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const nextOpenAt = new Date(Date.now() + durationHours * 3600 * 1e3).toISOString();
  await setMatchdayLockFirestore(seasonId, competitionId, targetMd, {
    overrideStatus: "FORCE_OPEN",
    durationHours
  });
  if (targetMd === (comp.currentMatchday || 1)) {
    await compRef.update({
      isMatchdayOpen: true,
      matchdayOpenedAt: now,
      matchdayDurationHours: durationHours,
      nextMatchdayOpenAt: nextOpenAt,
      adminOverrideStatus: "AUTO",
      updatedAt: now
    });
    const existingOverride = compOverrideMap.get(competitionId) || {};
    compOverrideMap.set(competitionId, {
      ...existingOverride,
      isMatchdayOpen: true,
      adminOverrideStatus: "AUTO"
    });
  }
  invalidateFirestoreCache("firestore:comp");
  return {
    success: true,
    currentMatchday: targetMd,
    isMatchdayOpen: true,
    nextMatchdayOpenAt: nextOpenAt
  };
}
async function setCompetitionMatchdayTimerFirestore(competitionId, params) {
  const db = getFirestoreDb();
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  const compDoc = await compRef.get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }
  const comp = compDoc.data();
  const seasonId = params.seasonId || comp.seasonId || "season-2026-27";
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const updates = {
    updatedAt: now
  };
  if (params.currentMatchday !== void 0) updates.currentMatchday = params.currentMatchday;
  if (params.durationHours !== void 0) updates.matchdayDurationHours = params.durationHours;
  if (params.nextOpenAt !== void 0) updates.nextMatchdayOpenAt = params.nextOpenAt;
  if (params.overrideStatus !== void 0) {
    updates.adminOverrideStatus = params.overrideStatus;
    updates.isMatchdayOpen = params.overrideStatus === "FORCE_OPEN" || params.overrideStatus === "AUTO";
  }
  await compRef.update(updates);
  const existingOverride = compOverrideMap.get(competitionId) || {};
  compOverrideMap.set(competitionId, {
    ...existingOverride,
    ...updates
  });
  if (params.overrideStatus !== void 0) {
    const md = params.currentMatchday || comp.currentMatchday || 1;
    await setMatchdayLockFirestore(seasonId, competitionId, md, {
      overrideStatus: params.overrideStatus,
      durationHours: params.durationHours
    });
  }
  invalidateFirestoreCache("firestore:comp");
  return { success: true, competitionId };
}
async function resolveClubOwnersForSeason(seasonId = "season-2026-27", clubIds) {
  const ownersMap = /* @__PURE__ */ new Map();
  try {
    const { clubOccupancyMap, usernameMap, userMap } = await getActiveOccupanciesForSeason(seasonId);
    for (const [clubId, occ] of clubOccupancyMap.entries()) {
      if (occ?.userId) {
        const u = userMap.get(occ.userId);
        const uname = usernameMap.get(occ.userId) || u?.username || occ.userId;
        ownersMap.set(clubId, {
          userId: occ.userId,
          username: uname,
          displayName: u?.displayName || uname
        });
      }
    }
  } catch (err) {
    console.warn("[RESOLVE_OWNERS] Error from active occupancies:", err.message);
  }
  try {
    const rows = queryAll(
      `SELECT cm.club_id, cm.user_id, u.username, u.first_name, u.last_name
       FROM club_memberships cm
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE cm.season_id = ? AND cm.status = 'active'`,
      [seasonId]
    );
    for (const r of rows) {
      if (!ownersMap.has(r.club_id) && r.user_id) {
        const uname = r.username || r.first_name || r.user_id;
        const displayName = `${r.first_name || ""} ${r.last_name || ""}`.trim() || uname;
        ownersMap.set(r.club_id, {
          userId: r.user_id,
          username: uname,
          displayName
        });
      }
    }
  } catch {
  }
  if (clubIds && clubIds.length > 0) {
    const missingClubIds = clubIds.filter((cid) => !ownersMap.has(cid));
    if (missingClubIds.length > 0) {
      try {
        const db = getFirestoreDb();
        for (let i = 0; i < missingClubIds.length; i += 30) {
          const chunk = missingClubIds.slice(i, i + 30);
          const memSnap = await db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).where("seasonId", "==", seasonId).where("clubId", "in", chunk).where("status", "==", "active").get();
          for (const d of memSnap.docs) {
            const data = d.data();
            if (data.clubId && data.userId && !ownersMap.has(data.clubId)) {
              let uname = data.userId;
              const cachedUser = getFromCache(`firestore:user:${data.userId}`);
              if (cachedUser?.username) {
                uname = cachedUser.username;
              }
              ownersMap.set(data.clubId, {
                userId: data.userId,
                username: uname
              });
            }
          }
        }
      } catch {
      }
    }
  }
  return ownersMap;
}
async function enrichStandingsWithActiveOwners(rows, seasonId = "season-2026-27") {
  if (!rows || rows.length === 0) return rows;
  try {
    const clubIds = rows.map((r) => r.clubId);
    const ownersMap = await resolveClubOwnersForSeason(seasonId, clubIds);
    return rows.map((row) => {
      const owner = ownersMap.get(row.clubId);
      if (owner) {
        return {
          ...row,
          managerUserId: owner.userId || row.managerUserId,
          managerUsername: owner.username || row.managerUsername
        };
      }
      return row;
    });
  } catch (err) {
    console.warn("[ENRICH_STANDINGS] Error enriching standings:", err.message);
    return rows;
  }
}
function computeAndSortStandings(clubs, confirmedFixtures, formatConfig) {
  const pointsForWin = formatConfig.pointsForWin ?? 3;
  const pointsForDraw = formatConfig.pointsForDraw ?? 1;
  const pointsForLoss = formatConfig.pointsForLoss ?? 0;
  const tieBreakers = formatConfig.tieBreakers ?? ["points", "goalDifference", "goalsFor", "headToHead"];
  const statsMap = /* @__PURE__ */ new Map();
  for (const c of clubs) {
    statsMap.set(c.id, {
      clubId: c.id,
      clubName: c.name,
      shortName: c.shortName,
      logoUrl: c.logoUrl,
      managerUserId: c.managerUserId,
      managerUsername: c.managerUsername,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      form: []
    });
  }
  for (const fix of confirmedFixtures) {
    const home = statsMap.get(fix.homeClubId);
    const away = statsMap.get(fix.awayClubId);
    const hScore = fix.homeScore ?? 0;
    const aScore = fix.awayScore ?? 0;
    if (home) {
      home.played += 1;
      home.goalsFor += hScore;
      home.goalsAgainst += aScore;
      if (hScore > aScore) {
        home.won += 1;
        home.points += pointsForWin;
        home.form.push("W");
      } else if (hScore === aScore) {
        home.drawn += 1;
        home.points += pointsForDraw;
        home.form.push("D");
      } else {
        home.lost += 1;
        home.points += pointsForLoss;
        home.form.push("L");
      }
    }
    if (away) {
      away.played += 1;
      away.goalsFor += aScore;
      away.goalsAgainst += hScore;
      if (aScore > hScore) {
        away.won += 1;
        away.points += pointsForWin;
        away.form.push("W");
      } else if (aScore === hScore) {
        away.drawn += 1;
        away.points += pointsForDraw;
        away.form.push("D");
      } else {
        away.lost += 1;
        away.points += pointsForLoss;
        away.form.push("L");
      }
    }
  }
  const rows = Array.from(statsMap.values()).map((row) => {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
    row.form = row.form.slice(-5);
    return row;
  });
  function getH2HPoints(clubAId, clubBId) {
    let pts = 0;
    for (const f of confirmedFixtures) {
      const hs = f.homeScore ?? 0;
      const as = f.awayScore ?? 0;
      if (f.homeClubId === clubAId && f.awayClubId === clubBId) {
        if (hs > as) pts += pointsForWin;
        else if (hs === as) pts += pointsForDraw;
      } else if (f.homeClubId === clubBId && f.awayClubId === clubAId) {
        if (as > hs) pts += pointsForWin;
        else if (as === hs) pts += pointsForDraw;
      }
    }
    return pts;
  }
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    for (const criteria of tieBreakers) {
      if (criteria === "goalDifference") {
        if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      } else if (criteria === "goalsFor") {
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      } else if (criteria === "headToHead") {
        const h2hA = getH2HPoints(a.clubId, b.clubId);
        const h2hB = getH2HPoints(b.clubId, a.clubId);
        if (h2hB !== h2hA) return h2hB - h2hA;
      }
    }
    return (a.clubName || "").localeCompare(b.clubName || "");
  });
  return rows.map((r, index) => ({
    position: index + 1,
    clubId: r.clubId,
    clubName: r.clubName,
    shortName: r.shortName,
    logoUrl: r.logoUrl,
    managerUserId: r.managerUserId || void 0,
    managerUsername: r.managerUsername || null,
    played: r.played,
    won: r.won,
    drawn: r.drawn,
    lost: r.lost,
    goalsFor: r.goalsFor,
    goalsAgainst: r.goalsAgainst,
    goalDifference: r.goalDifference,
    points: r.points,
    form: r.form
  }));
}
function fallbackCalculateStandings(competitionId) {
  try {
    const { refreshMaterializedStandingsForCompetition: refreshMaterializedStandingsForCompetition2 } = (init_sqliteStandings(), __toCommonJS(sqliteStandings_exports));
    const standings = refreshMaterializedStandingsForCompetition2(competitionId);
    if (standings && standings.length > 0) {
      return standings;
    }
  } catch {
  }
  const comp = queryGet("SELECT * FROM competitions WHERE id = ?", [competitionId]);
  if (!comp) return [];
  let formatConfig = {};
  if (comp.format_config_json) {
    try {
      formatConfig = JSON.parse(comp.format_config_json);
    } catch {
      formatConfig = {};
    }
  }
  let clubs = [];
  if (comp.league_id) {
    clubs = queryAll("SELECT * FROM clubs WHERE league_id = ? AND active = 1", [comp.league_id]);
  } else {
    clubs = queryAll(
      `SELECT c.* FROM competition_participants cp
       JOIN clubs c ON cp.club_id = c.id
       WHERE cp.competition_id = ?`,
      [competitionId]
    );
  }
  const confirmedFixtures = queryAll(
    `SELECT * FROM fixtures WHERE competition_id = ? AND status = 'CONFIRMED' AND home_score IS NOT NULL AND away_score IS NOT NULL`,
    [competitionId]
  );
  const compSeasonId = comp?.season_id || "season-2026-27";
  let ownersMap = /* @__PURE__ */ new Map();
  try {
    const memRows = queryAll(
      `SELECT cm.club_id, cm.user_id, u.username, u.first_name
       FROM club_memberships cm
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE cm.season_id = ? AND cm.status = 'active'`,
      [compSeasonId]
    );
    for (const r of memRows) {
      ownersMap.set(r.club_id, { userId: r.user_id, username: r.username || r.first_name || r.user_id });
    }
  } catch {
  }
  const clubList = clubs.map((c) => {
    const owner = ownersMap.get(c.id);
    return {
      id: c.id,
      name: c.name,
      shortName: c.short_name,
      logoUrl: c.logo_url,
      managerUserId: owner?.userId,
      managerUsername: owner?.username
    };
  });
  const fixtureList = confirmedFixtures.map((f) => ({
    homeClubId: f.home_club_id,
    awayClubId: f.away_club_id,
    homeScore: f.home_score ?? 0,
    awayScore: f.away_score ?? 0
  }));
  return computeAndSortStandings(clubList, fixtureList, formatConfig);
}
async function getCompetitionStandingsFirestore(competitionId, options = {}) {
  const seedComp = SEED_COMPETITIONS.find((c) => c.id === competitionId);
  const seasonId = seedComp?.seasonId || "season-2026-27";
  const cacheKey = `firestore:standings:${competitionId}`;
  if (!options.forceRefresh) {
    const cached = getFromCache(cacheKey);
    if (cached) {
      return await enrichStandingsWithActiveOwners(cached, seasonId);
    }
  }
  try {
    const db = getFirestoreDb();
    trackFirestoreRead(COLLECTIONS.STANDINGS, 1, "getCompetitionStandingsFirestore");
    const docRef = db.collection(COLLECTIONS.STANDINGS).doc(competitionId);
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      const data = docSnap.data();
      if (Array.isArray(data.rows) && data.rows.length > 0) {
        const enriched2 = await enrichStandingsWithActiveOwners(data.rows, seasonId);
        setInCache(cacheKey, enriched2, 3e5);
        return enriched2;
      }
    }
    const rawRows = fallbackCalculateStandings(competitionId);
    const enriched = await enrichStandingsWithActiveOwners(rawRows, seasonId);
    setInCache(cacheKey, enriched, 3e5);
    return enriched;
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getCompetitionStandingsFirestore:", err.message);
    const rawRows = fallbackCalculateStandings(competitionId);
    const enriched = await enrichStandingsWithActiveOwners(rawRows, seasonId);
    setInCache(cacheKey, enriched, 3e5);
    return enriched;
  }
}
async function rebuildCompetitionStandingsFirestore2(competitionId) {
  const cacheKey = `firestore:standings:${competitionId}`;
  try {
    const db = getFirestoreDb();
    const seedComp = SEED_COMPETITIONS.find((c) => c.id === competitionId);
    const formatConfig = seedComp?.formatConfig || {};
    const leagueId = seedComp?.leagueId;
    let seedClubs = [];
    if (leagueId) {
      seedClubs = SEED_CLUBS.filter((c) => c.leagueId === leagueId);
    } else {
      const partSnap = await db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where("competitionId", "==", competitionId).orderBy("seedNumber", "asc").get();
      if (!partSnap.empty) {
        const participantClubIds = partSnap.docs.map(
          (d) => d.data().clubId
        );
        seedClubs = participantClubIds.map((cid) => {
          const club = SEED_CLUBS.find((c) => c.id === cid);
          return club || { id: cid, name: cid, shortName: cid, logoUrl: "" };
        });
      } else {
        const sqlParts = queryAll(
          `SELECT cp.club_id, c.name, c.short_name, c.logo_url
           FROM competition_participants cp
           JOIN clubs c ON cp.club_id = c.id
           WHERE cp.competition_id = ?
           ORDER BY cp.seed_number ASC`,
          [competitionId]
        );
        if (sqlParts.length > 0) {
          seedClubs = sqlParts.map((p) => ({
            id: p.club_id,
            name: p.name,
            shortName: p.short_name,
            logoUrl: p.logo_url
          }));
        } else {
          seedClubs = SEED_CLUBS;
        }
      }
    }
    const fixSnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", competitionId).where("status", "==", "CONFIRMED").get();
    trackFirestoreRead(
      COLLECTIONS.FIXTURES,
      fixSnap.empty ? 1 : fixSnap.docs.length,
      "rebuildCompetitionStandingsFirestore"
    );
    const seasonId = seedComp?.seasonId || "season-2026-27";
    const ownersMap = await resolveClubOwnersForSeason(seasonId, seedClubs.map((c) => c.id));
    const confirmedFixtures = fixSnap.docs.map((d) => d.data()).filter((f) => f.homeScore !== null && f.homeScore !== void 0 && f.awayScore !== null && f.awayScore !== void 0).map((f) => ({
      homeClubId: f.homeClubId,
      awayClubId: f.awayClubId,
      homeScore: f.homeScore ?? 0,
      awayScore: f.awayScore ?? 0
    }));
    const rankedRows = computeAndSortStandings(
      seedClubs.map((c) => {
        const owner = ownersMap.get(c.id);
        return {
          id: c.id,
          name: c.name,
          shortName: c.shortName,
          logoUrl: c.logoUrl,
          managerUserId: owner?.userId,
          managerUsername: owner?.username
        };
      }),
      confirmedFixtures,
      formatConfig
    );
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const standingsDoc = {
      competitionId,
      seasonId,
      updatedAt: now,
      rows: rankedRows,
      confirmedFixtureIds: fixSnap.docs.map((d) => d.id),
      totalPlayed: confirmedFixtures.length
    };
    await db.collection(COLLECTIONS.STANDINGS).doc(competitionId).set(standingsDoc);
    setInCache(cacheKey, rankedRows, 3e5);
    return rankedRows;
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] rebuildCompetitionStandingsFirestore:", err.message);
    const rawRows = fallbackCalculateStandings(competitionId);
    const enriched = await enrichStandingsWithActiveOwners(rawRows);
    setInCache(cacheKey, enriched, 3e5);
    return enriched;
  }
}
async function calculateCompetitionStandingsFirestore(competitionId) {
  return getCompetitionStandingsFirestore(competitionId);
}
async function submitFixtureResultFirestore(userId, fixtureId, homeScore, awayScore, proofUrl) {
  assertNoSyntheticIdsInProduction("submitFixtureResultFirestore", [userId, fixtureId]);
  guardAgainstTestEntityCreation("submission", fixtureId, userId);
  if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
    throw new Error("Scores must be non-negative integers.");
  }
  const db = getFirestoreDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const submissionId = `sub-${fixtureId}-${userId}`;
  const executeFallbackSubmit = async () => {
    console.log("[RESULT_SUBMISSION_FALLBACK] Executing resilient SQLite fallback persistence for fixture:", fixtureId);
    const row = queryGet("SELECT * FROM fixtures WHERE id = ?", [fixtureId]);
    if (!row) {
      throw new Error(`Fixture with ID '${fixtureId}' not found.`);
    }
    await assertMatchdayPlayableFirestore(row.season_id || "season-2026-27", row.competition_id, row.matchday);
    if (row.status === "CONFIRMED") {
      throw new Error("This match result is already CONFIRMED and cannot be modified.");
    }
    if (row.home_club_id === "TBD" || row.away_club_id === "TBD" || !row.home_club_id || !row.away_club_id) {
      const err = new Error("This match has undetermined participants (TBD) and cannot be played yet.");
      err.code = "FIXTURE_NOT_READY";
      err.statusCode = 400;
      throw err;
    }
    let userClubId = null;
    const localOccClubId = getUserOccupiedClubIdLocally(row.season_id || "season-2026-27", userId);
    if (localOccClubId && (localOccClubId === row.home_club_id || localOccClubId === row.away_club_id)) {
      userClubId = localOccClubId;
    } else {
      const memRow = queryGet('SELECT * FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = "active"', [
        userId,
        row.season_id
      ]) || queryGet("SELECT * FROM season_league_clubs WHERE owner_user_id = ? AND season_id = ?", [
        userId,
        row.season_id
      ]);
      userClubId = memRow?.club_id || memRow?.clubId;
    }
    if (!userClubId || userClubId !== row.home_club_id && userClubId !== row.away_club_id) {
      throw new Error("You do not own either the home or away club in this fixture.");
    }
    queryRun(
      `INSERT OR REPLACE INTO result_submissions (id, fixture_id, submitted_by_user_id, club_id, home_score, away_score, proof_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [submissionId, fixtureId, userId, userClubId, homeScore, awayScore, proofUrl || null, now]
    );
    const existingSubs = queryAll("SELECT * FROM result_submissions WHERE fixture_id = ?", [fixtureId]);
    let newStatus = existingSubs.length === 1 ? "PENDING_CONFIRMATION" : "AWAITING_RESULT";
    let confirmedHomeScore = null;
    let confirmedAwayScore = null;
    let winnerClubId = null;
    let confirmedAt = null;
    if (existingSubs.length >= 2) {
      const [sub1, sub2] = existingSubs;
      if (sub1.home_score === sub2.home_score && sub1.away_score === sub2.away_score) {
        newStatus = "CONFIRMED";
        confirmedHomeScore = sub1.home_score;
        confirmedAwayScore = sub1.away_score;
        confirmedAt = now;
        if (confirmedHomeScore > confirmedAwayScore) winnerClubId = row.home_club_id;
        else if (confirmedAwayScore > confirmedHomeScore) winnerClubId = row.away_club_id;
      } else {
        newStatus = "DISPUTED";
      }
    }
    queryRun(
      `UPDATE fixtures SET status = ?, home_score = ?, away_score = ?, winner_club_id = ?, result_confirmed_at = ?, updated_at = ? WHERE id = ?`,
      [newStatus, confirmedHomeScore, confirmedAwayScore, winnerClubId, confirmedAt, now, fixtureId]
    );
    enqueueMutation({
      mutationId: `sub_${fixtureId}_${userId}`,
      entityType: "RESULT_SUBMISSION",
      entityId: fixtureId,
      operation: "SUBMIT_RESULT",
      payload: {
        fixtureId,
        userId,
        userClubId,
        homeScore,
        awayScore,
        proofUrl: proofUrl || null,
        submissionId,
        createdAt: now
      },
      createdAt: now
    });
    invalidateFirestoreCache("firestore:fixtures");
    invalidateFirestoreCache("firestore:comp");
    const fallbackFixture = await getFixtureByIdFirestore(fixtureId, userId);
    if (fallbackFixture) {
      fallbackFixture.pendingSync = true;
    }
    return fallbackFixture;
  };
  if (!firestoreCircuitBreaker.canExecute()) {
    recordFallbackUsage();
    return await executeFallbackSubmit();
  }
  try {
    const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
    trackFirestoreRead(COLLECTIONS.FIXTURES, 1, "submitFixtureResultFirestore:fixture");
    const fixDoc = await fixRef.get();
    if (!fixDoc.exists) {
      throw new Error(`Fixture with ID '${fixtureId}' not found.`);
    }
    const fixture = fixDoc.data();
    if (fixture.competitionId && fixture.matchday) {
      await assertMatchdayPlayableFirestore(
        fixture.seasonId || "season-2026-27",
        fixture.competitionId,
        fixture.matchday
      );
    }
    if (fixture.status === "CONFIRMED") {
      throw new Error("This match result is already CONFIRMED and cannot be modified.");
    }
    if (fixture.homeClubId === "TBD" || fixture.awayClubId === "TBD" || !fixture.homeClubId || !fixture.awayClubId) {
      const err = new Error("This match has undetermined participants (TBD) and cannot be played yet.");
      err.code = "FIXTURE_NOT_READY";
      err.statusCode = 400;
      throw err;
    }
    trackFirestoreRead(COLLECTIONS.USER_MEMBERSHIPS, 1, "submitFixtureResultFirestore:membership");
    const userMemDoc = await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${fixture.seasonId}_${userId}`).get();
    if (!userMemDoc.exists || userMemDoc.data()?.status !== "active") {
      throw new Error("You do not own either the home or away club in this fixture.");
    }
    const userClubId = userMemDoc.data().clubId;
    const isHome = userClubId === fixture.homeClubId;
    const isAway = userClubId === fixture.awayClubId;
    if (!isHome && !isAway) {
      throw new Error("You do not own either the home or away club in this fixture.");
    }
    const subRef = db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc(submissionId);
    trackFirestoreWrite(COLLECTIONS.RESULT_SUBMISSIONS, 1, "submitFixtureResultFirestore:setSubmission");
    await subRef.set({
      id: submissionId,
      fixtureId,
      submittedByUserId: userId,
      clubId: userClubId,
      homeScore,
      awayScore,
      proofUrl: proofUrl || null,
      createdAt: now
    });
    trackFirestoreRead(COLLECTIONS.RESULT_SUBMISSIONS, 1, "submitFixtureResultFirestore:allSubs");
    const allSubsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where("fixtureId", "==", fixtureId).get();
    const allSubs = allSubsSnap.docs.map((d) => d.data());
    let newStatus = allSubs.length === 1 ? "PENDING_CONFIRMATION" : "AWAITING_RESULT";
    let confirmedHomeScore = null;
    let confirmedAwayScore = null;
    let winnerClubId = null;
    let confirmedAt = null;
    if (allSubs.length >= 2) {
      const [sub1, sub2] = allSubs;
      if (sub1.homeScore === sub2.homeScore && sub1.awayScore === sub2.awayScore) {
        newStatus = "CONFIRMED";
        confirmedHomeScore = sub1.homeScore;
        confirmedAwayScore = sub1.awayScore;
        confirmedAt = now;
        if (confirmedHomeScore > confirmedAwayScore) winnerClubId = fixture.homeClubId;
        else if (confirmedAwayScore > confirmedHomeScore) winnerClubId = fixture.awayClubId;
      } else {
        newStatus = "DISPUTED";
        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(`disp-${fixtureId}`);
        trackFirestoreWrite(COLLECTIONS.DISPUTES, 1, "submitFixtureResultFirestore:dispute");
        await disputeRef.set({
          id: `disp-${fixtureId}`,
          fixtureId,
          seasonId: fixture.seasonId,
          homeSubmissionId: sub1.id,
          awaySubmissionId: sub2.id,
          status: "OPEN",
          createdAt: now
        });
      }
    } else {
      newStatus = "PENDING_CONFIRMATION";
    }
    trackFirestoreWrite(COLLECTIONS.FIXTURES, 1, "submitFixtureResultFirestore:updateStatus");
    await fixRef.update({
      status: newStatus,
      homeScore: confirmedHomeScore,
      awayScore: confirmedAwayScore,
      winnerClubId,
      resultConfirmedAt: confirmedAt,
      updatedAt: now
    });
    firestoreCircuitBreaker.recordSuccess();
    try {
      queryRun(
        `INSERT OR REPLACE INTO result_submissions (id, fixture_id, submitted_by_user_id, club_id, home_score, away_score, proof_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [submissionId, fixtureId, userId, userClubId, homeScore, awayScore, proofUrl || null, now]
      );
      queryRun(
        `UPDATE fixtures SET status = ?, home_score = ?, away_score = ?, winner_club_id = ?, result_confirmed_at = ?, updated_at = ? WHERE id = ?`,
        [newStatus, confirmedHomeScore, confirmedAwayScore, winnerClubId, confirmedAt, now, fixtureId]
      );
    } catch (sqliteErr) {
      console.warn("[SQLITE_SYNC] Non-blocking SQLite sync error on result submit:", sqliteErr);
    }
    if (newStatus === "CONFIRMED" && winnerClubId) {
      try {
        const { advanceKnockoutWinnerFirestore: advanceKnockoutWinnerFirestore2 } = await Promise.resolve().then(() => (init_knockoutEngine(), knockoutEngine_exports));
        await advanceKnockoutWinnerFirestore2(fixtureId);
      } catch (err) {
        console.warn("[KNOCKOUT_ADVANCE] Non-blocking advance error:", err);
      }
    }
    if (newStatus === "CONFIRMED" && fixture.competitionId) {
      try {
        await rebuildCompetitionStandingsFirestore2(fixture.competitionId);
      } catch (standingsErr) {
        console.warn("[STANDINGS_UPDATE] Non-blocking standings update error on confirmation:", standingsErr);
      }
    }
    invalidateFirestoreCache("firestore:fixtures");
    invalidateFirestoreCache("firestore:comp");
    return await getFixtureByIdFirestore(fixtureId, userId);
  } catch (firestoreErr) {
    const errMsg = firestoreErr?.message || String(firestoreErr);
    console.error(`[RESULT_SUBMISSION] Firestore operation failed: ${errMsg}`);
    if (errMsg.includes("not found") || errMsg.includes("already CONFIRMED") || errMsg.includes("MATCHDAY_LOCKED") || errMsg.includes("locked") || errMsg.includes("paused") || errMsg.includes("do not own") || errMsg.includes("Scores must be")) {
      throw firestoreErr;
    }
    firestoreCircuitBreaker.recordFailure(firestoreErr);
    recordFallbackUsage();
    return await executeFallbackSubmit();
  }
}
async function validateDomesticFixturesFirestore(seasonId = "season-2026-27") {
  const domesticComps = [
    { competitionId: "comp-premier-league-2026", leagueId: "league-premier-league", name: "Premier League", expectedTeams: 20, expectedMDs: 19, expectedFixtures: 190 },
    { competitionId: "comp-la-liga-2026", leagueId: "league-la-liga", name: "La Liga", expectedTeams: 20, expectedMDs: 19, expectedFixtures: 190 },
    { competitionId: "comp-serie-a-2026", leagueId: "league-serie-a", name: "Serie A", expectedTeams: 20, expectedMDs: 19, expectedFixtures: 190 },
    { competitionId: "comp-bundesliga-2026", leagueId: "league-bundesliga", name: "Bundesliga", expectedTeams: 18, expectedMDs: 17, expectedFixtures: 153 },
    { competitionId: "comp-ligue-1-2026", leagueId: "league-ligue-1", name: "Ligue 1", expectedTeams: 18, expectedMDs: 17, expectedFixtures: 153 }
  ];
  const results = [];
  let allValid = true;
  let totalConfirmed = 0;
  let totalPending = 0;
  let actualTotalFixtures = 0;
  let expectedTotalFixtures = 0;
  let totalClubs = 0;
  for (const item of domesticComps) {
    const clubCount = SEED_CLUBS.filter((c) => c.leagueId === item.leagueId).length || item.expectedTeams;
    totalClubs += clubCount;
    expectedTotalFixtures += item.expectedFixtures;
    const fixtures = await getFixturesFirestore({ competitionId: item.competitionId, seasonId });
    actualTotalFixtures += fixtures.length;
    const matchdaySet = /* @__PURE__ */ new Set();
    const directedPairs = /* @__PURE__ */ new Set();
    const undirectedPairs = /* @__PURE__ */ new Set();
    let duplicatePairCount = 0;
    let reverseFixtureCount = 0;
    let invalidMatchdays = 0;
    let confirmedCount = 0;
    let pendingCount = 0;
    const issues = [];
    for (const f of fixtures) {
      if (f.matchday < 1 || f.matchday > item.expectedMDs) {
        invalidMatchdays++;
      }
      matchdaySet.add(f.matchday);
      const directedKey = `${f.homeClubId}->${f.awayClubId}`;
      const undirectedKey = [f.homeClubId, f.awayClubId].sort().join(" <-> ");
      if (directedPairs.has(directedKey)) {
        duplicatePairCount++;
      } else {
        directedPairs.add(directedKey);
      }
      if (undirectedPairs.has(undirectedKey)) {
        reverseFixtureCount++;
      } else {
        undirectedPairs.add(undirectedKey);
      }
      if (f.status === "CONFIRMED") confirmedCount++;
      else if (f.status === "PENDING_CONFIRMATION" || f.status === "AWAITING_RESULT") pendingCount++;
    }
    totalConfirmed += confirmedCount;
    totalPending += pendingCount;
    if (fixtures.length !== item.expectedFixtures) {
      issues.push(`Expected ${item.expectedFixtures} fixtures, found ${fixtures.length}.`);
    }
    if (matchdaySet.size !== item.expectedMDs && fixtures.length > 0) {
      issues.push(`Expected ${item.expectedMDs} matchdays, found ${matchdaySet.size}.`);
    }
    if (duplicatePairCount > 0) {
      issues.push(`Found ${duplicatePairCount} duplicate fixture pairs.`);
    }
    if (reverseFixtureCount > 0) {
      issues.push(`Found ${reverseFixtureCount} reverse fixture pairs (double round-robin).`);
    }
    if (invalidMatchdays > 0) {
      issues.push(`Found ${invalidMatchdays} fixtures with invalid matchdays (outside 1..${item.expectedMDs}).`);
    }
    const isValid = issues.length === 0 && fixtures.length === item.expectedFixtures;
    if (!isValid) allValid = false;
    results.push({
      leagueId: item.leagueId,
      competitionId: item.competitionId,
      name: item.name,
      clubCount,
      expectedMatchdays: item.expectedMDs,
      actualMatchdays: matchdaySet.size,
      expectedFixtureCount: item.expectedFixtures,
      actualFixtureCount: fixtures.length,
      duplicatePairCount,
      reverseFixtureCount,
      invalidMatchdays,
      confirmedResultsCount: confirmedCount,
      pendingResultsCount: pendingCount,
      isValid,
      issues
    });
  }
  return {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    allValid,
    leagues: results,
    summary: {
      totalClubs,
      expectedTotalFixtures,
      actualTotalFixtures,
      totalConfirmed,
      totalPending
    }
  };
}
function getCanonicalTelegramUserId(telegramId) {
  const raw = String(telegramId).trim();
  const cleanId = raw.startsWith("user-") ? raw.slice(5) : raw;
  return `user-${cleanId}`;
}
async function verifyUserClubConsistency(userId, seasonId = "season-2026-27") {
  const db = getFirestoreDb();
  const userMemRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userId}`);
  const userMemDoc = await userMemRef.get();
  let userMembershipClubId = null;
  if (userMemDoc.exists && userMemDoc.data()?.status === "active") {
    userMembershipClubId = userMemDoc.data().clubId;
  }
  if (!userMembershipClubId) {
    return {
      isConsistent: true,
      userMembershipClubId: null,
      clubOccupancyUserId: null
    };
  }
  const clubOccRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${userMembershipClubId}`);
  const clubOccDoc = await clubOccRef.get();
  let clubOccupancyUserId = null;
  if (clubOccDoc.exists && clubOccDoc.data()?.status === "active") {
    clubOccupancyUserId = clubOccDoc.data().userId;
  }
  if (clubOccupancyUserId !== userId) {
    const error = `DATA_INTEGRITY_MISMATCH: user_memberships/${seasonId}_${userId} claims club '${userMembershipClubId}', but club_occupancies/${seasonId}_${userMembershipClubId} has userId '${clubOccupancyUserId}'.`;
    console.warn(`[INTEGRITY] ${error}`);
    return {
      isConsistent: false,
      userMembershipClubId,
      clubOccupancyUserId,
      error
    };
  }
  return {
    isConsistent: true,
    userMembershipClubId,
    clubOccupancyUserId
  };
}
async function getOrCreateTelegramUserFirestore(tgUser) {
  const rawId = String(tgUser.id).trim();
  const telegramId = rawId.startsWith("user-") ? rawId.slice(5) : rawId;
  const docId = getCanonicalTelegramUserId(telegramId);
  const username = tgUser.username || `tg_${telegramId}`;
  const firstName = tgUser.first_name || "Player";
  const lastName = tgUser.last_name || "";
  const photoUrl = tgUser.photo_url || "";
  const adminIds = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((s) => s.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
  const isAdmin = adminIds.includes(telegramId.toLowerCase()) || adminIds.includes(username.toLowerCase());
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const db = getFirestoreDb();
    const userDocRef = db.collection(COLLECTIONS.USERS).doc(docId);
    const userDoc = await userDocRef.get();
    trackFirestoreRead(COLLECTIONS.USERS, 1, "getOrCreateTelegramUserFirestore");
    if (!userDoc.exists) {
      const newUser = {
        id: docId,
        telegramId,
        username,
        firstName,
        lastName,
        photoUrl,
        isAdmin,
        isSuspended: false,
        createdAt: now,
        updatedAt: now
      };
      await userDocRef.set(newUser);
      trackFirestoreWrite(COLLECTIONS.USERS, 1, "getOrCreateTelegramUserFirestore:create");
      const createdUser = {
        id: docId,
        telegramId,
        username,
        firstName,
        lastName,
        photoUrl,
        isAdmin,
        isSuspended: false,
        createdAt: now,
        updatedAt: now
      };
      setInCache(`firestore:user:${docId}`, createdUser, 3e5);
      return createdUser;
    } else {
      const existing = userDoc.data();
      const updatedAdmin = Boolean(existing.isAdmin || isAdmin);
      const changed = existing.username !== username || existing.firstName !== firstName || lastName && (existing.lastName || "") !== lastName || photoUrl && (existing.photoUrl || "") !== photoUrl || Boolean(existing.isAdmin) !== updatedAdmin;
      if (changed) {
        await userDocRef.update({
          username,
          firstName,
          lastName: lastName || existing.lastName || "",
          photoUrl: photoUrl || existing.photoUrl || "",
          isAdmin: updatedAdmin,
          updatedAt: now
        });
        trackFirestoreWrite(COLLECTIONS.USERS, 1, "getOrCreateTelegramUserFirestore:update");
      }
      const returnedUser = {
        id: existing.id || docId,
        telegramId: existing.telegramId || telegramId,
        username: changed ? username : existing.username || username,
        firstName: changed ? firstName : existing.firstName || firstName,
        lastName: changed ? lastName || existing.lastName || "" : existing.lastName || "",
        photoUrl: changed ? photoUrl || existing.photoUrl || "" : existing.photoUrl || "",
        isAdmin: updatedAdmin,
        isSuspended: Boolean(existing.isSuspended),
        createdAt: existing.createdAt || now,
        updatedAt: changed ? now : existing.updatedAt || now
      };
      setInCache(`firestore:user:${docId}`, returnedUser, 3e5);
      return returnedUser;
    }
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getOrCreateTelegramUserFirestore:", err.message);
  }
  const existingUser = queryGet("SELECT * FROM users WHERE id = ?", [docId]);
  if (!existingUser) {
    queryRun(
      `INSERT INTO users (id, telegram_id, username, first_name, last_name, photo_url, is_admin, is_suspended, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [docId, telegramId, username, firstName, lastName, photoUrl, isAdmin ? 1 : 0, now, now]
    );
  } else {
    queryRun(
      `UPDATE users SET username = ?, first_name = ?, last_name = ?, photo_url = ?, is_admin = ?, updated_at = ? WHERE id = ?`,
      [username, firstName, lastName, photoUrl || existingUser.photo_url || "", existingUser.is_admin || isAdmin ? 1 : 0, now, docId]
    );
  }
  return {
    id: docId,
    telegramId,
    username,
    firstName,
    lastName,
    photoUrl,
    isAdmin,
    isSuspended: false,
    createdAt: now,
    updatedAt: now
  };
}
async function getUserByIdFirestore(userId) {
  const cacheKey = `firestore:user:${userId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const db = getFirestoreDb();
    trackFirestoreRead(COLLECTIONS.USERS, 1, "getUserByIdFirestore");
    const doc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (doc.exists) {
      const data = doc.data();
      const user2 = {
        id: doc.id,
        telegramId: data.telegramId || "",
        username: data.username || "",
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        photoUrl: data.photoUrl || "",
        isAdmin: Boolean(data.isAdmin),
        isSuspended: Boolean(data.isSuspended),
        createdAt: data.createdAt || "",
        updatedAt: data.updatedAt || ""
      };
      setInCache(cacheKey, user2, 3e5);
      return user2;
    }
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getUserByIdFirestore:", err.message);
  }
  const row = queryGet("SELECT * FROM users WHERE id = ?", [userId]);
  if (!row) return null;
  const user = {
    id: row.id,
    telegramId: row.telegram_id || "",
    username: row.username || "",
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    photoUrl: row.photo_url || "",
    isAdmin: Boolean(row.is_admin),
    isSuspended: Boolean(row.is_suspended),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
  setInCache(cacheKey, user, 3e5);
  return user;
}
async function getOrCreateDevUserFirestore(devUserId) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const isAdmin = devUserId.includes("admin");
  try {
    const db = getFirestoreDb();
    const docRef = db.collection(COLLECTIONS.USERS).doc(devUserId);
    const doc = await docRef.get();
    if (doc.exists) {
      return doc.data();
    }
    const newUser = {
      id: devUserId,
      telegramId: devUserId.replace(/\D/g, "") || "999",
      username: devUserId.replace("user-", ""),
      firstName: devUserId.includes("admin") ? "Admin" : "Dev User",
      lastName: "Tester",
      photoUrl: "",
      isAdmin,
      isSuspended: false,
      createdAt: now,
      updatedAt: now
    };
    await docRef.set(newUser);
    return newUser;
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getOrCreateDevUserFirestore:", err.message);
    const existing = queryGet("SELECT * FROM users WHERE id = ?", [devUserId]);
    if (existing) {
      return {
        id: existing.id,
        telegramId: existing.telegram_id,
        username: existing.username,
        firstName: existing.first_name,
        lastName: existing.last_name,
        photoUrl: existing.photo_url || "",
        isAdmin: Boolean(existing.is_admin),
        isSuspended: Boolean(existing.is_suspended),
        createdAt: existing.created_at,
        updatedAt: existing.updated_at
      };
    }
    const newUser = {
      id: devUserId,
      telegramId: devUserId.replace(/\D/g, "") || "999",
      username: devUserId.replace("user-", ""),
      firstName: devUserId.includes("admin") ? "Admin" : "Dev User",
      lastName: "Tester",
      photoUrl: "",
      isAdmin,
      isSuspended: false,
      createdAt: now,
      updatedAt: now
    };
    queryRun(
      `INSERT OR REPLACE INTO users (id, telegram_id, username, first_name, last_name, photo_url, is_admin, is_suspended, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [newUser.id, newUser.telegramId, newUser.username, newUser.firstName, newUser.lastName, newUser.photoUrl, isAdmin ? 1 : 0, now, now]
    );
    return newUser;
  }
}
async function reopenFixtureFirestore(adminUserId, fixtureId, notes, options) {
  assertNoSyntheticIdsInProduction("reopenFixtureFirestore", [adminUserId, fixtureId]);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
      const fixDoc = await fixRef.get();
      if (!fixDoc.exists) {
        throw new Error(`Fixture '${fixtureId}' not found.`);
      }
      await fixRef.update({
        status: "SCHEDULED",
        homeScore: null,
        awayScore: null,
        winnerClubId: null,
        resultConfirmedAt: null,
        updatedAt: now
      });
      const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where("fixtureId", "==", fixtureId).get();
      const deleteBatch = db.batch();
      for (const doc of subsSnap.docs) {
        deleteBatch.delete(doc.ref);
      }
      const dispSnap = await db.collection(COLLECTIONS.DISPUTES).where("fixtureId", "==", fixtureId).get();
      for (const doc of dispSnap.docs) {
        deleteBatch.delete(doc.ref);
      }
      await deleteBatch.commit();
      if (fixDoc.data()?.competitionId) {
        try {
          await rebuildCompetitionStandingsFirestore2(fixDoc.data().competitionId);
        } catch (standingsErr) {
          console.warn("[STANDINGS_UPDATE] Non-blocking standings update error on reopen:", standingsErr);
        }
      }
      await db.collection(COLLECTIONS.AUDIT_LOGS).add({
        actorUserId: adminUserId,
        action: "REOPEN_FIXTURE",
        entityType: "fixture",
        entityId: fixtureId,
        notes: notes || null,
        createdAt: now
      });
      invalidateFirestoreCache();
      return { success: true, fixtureId, authoritative: true, isFallback: false };
    } catch (err) {
      if (options?.authoritativeOnly || isHostedEnvironment()) {
        throw err;
      }
      firestoreCircuitBreaker.recordFailure(err);
      recordFallbackUsage();
      console.warn("[FIRESTORE FALLBACK] reopenFixtureFirestore:", err.message);
    }
  } else {
    if (options?.authoritativeOnly || isHostedEnvironment()) {
      throw new Error("CIRCUIT_OPEN: Firestore circuit breaker is OPEN. Authoritative write cannot execute.");
    }
    recordFallbackUsage();
  }
  queryRun(
    `UPDATE fixtures 
     SET status = 'SCHEDULED', home_score = NULL, away_score = NULL, winner_club_id = NULL, result_confirmed_at = NULL, updated_at = ? 
     WHERE id = ?`,
    [now, fixtureId]
  );
  queryRun("DELETE FROM result_submissions WHERE fixture_id = ?", [fixtureId]);
  queryRun("DELETE FROM disputes WHERE fixture_id = ?", [fixtureId]);
  enqueueMutation({
    mutationId: `admin_reject_${fixtureId}`,
    entityType: "ADMIN_DECISION",
    entityId: fixtureId,
    operation: "ADMIN_REJECT_RESULT",
    payload: {
      adminUserId,
      fixtureId,
      notes: notes || "Rejected by tournament administrator (offline queued)"
    },
    createdAt: now
  });
  return { success: true, fixtureId, authoritative: false, isFallback: true };
}
async function resolveDisputeFirestore(adminUserId, disputeId, params) {
  const db = getFirestoreDb();
  const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(disputeId);
  const disputeDoc = await disputeRef.get();
  if (!disputeDoc.exists) {
    throw new Error(`Dispute '${disputeId}' not found.`);
  }
  const dispData = disputeDoc.data();
  const fixtureRef = db.collection(COLLECTIONS.FIXTURES).doc(dispData.fixtureId);
  const fixtureDoc = await fixtureRef.get();
  if (!fixtureDoc.exists) {
    throw new Error(`Fixture '${dispData.fixtureId}' not found.`);
  }
  const fixture = fixtureDoc.data();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let newHomeScore = null;
  let newAwayScore = null;
  let winnerClubId = null;
  let newStatus = "CONFIRMED";
  if (params.action === "MANUAL_SCORE") {
    newHomeScore = params.manualHomeScore ?? 0;
    newAwayScore = params.manualAwayScore ?? 0;
    if (newHomeScore > newAwayScore) winnerClubId = fixture.homeClubId;
    else if (newAwayScore > newHomeScore) winnerClubId = fixture.awayClubId;
  } else if (params.action === "CANCEL_MATCH") {
    newStatus = "POSTPONED";
  }
  await fixtureRef.update({
    status: newStatus,
    homeScore: newHomeScore,
    awayScore: newAwayScore,
    winnerClubId,
    resultConfirmedAt: now,
    updatedAt: now
  });
  if (newStatus === "CONFIRMED" && winnerClubId) {
    try {
      const { advanceKnockoutWinnerFirestore: advanceKnockoutWinnerFirestore2 } = await Promise.resolve().then(() => (init_knockoutEngine(), knockoutEngine_exports));
      await advanceKnockoutWinnerFirestore2(dispData.fixtureId);
    } catch (err) {
      console.warn("[KNOCKOUT_ADVANCE] Non-blocking advance error on dispute resolution:", err);
    }
  }
  if (fixture.competitionId) {
    try {
      await rebuildCompetitionStandingsFirestore2(fixture.competitionId);
    } catch (standingsErr) {
      console.warn("[STANDINGS_UPDATE] Non-blocking standings update error on dispute resolution:", standingsErr);
    }
  }
  const updatedDispute = {
    ...dispData,
    status: "RESOLVED",
    resolvedByUserId: adminUserId,
    resolutionNotes: params.notes || null,
    resolvedAt: now
  };
  await disputeRef.update(updatedDispute);
  await db.collection(COLLECTIONS.AUDIT_LOGS).add({
    actorUserId: adminUserId,
    action: "RESOLVE_DISPUTE",
    entityType: "dispute",
    entityId: disputeId,
    notes: params.notes || null,
    createdAt: now
  });
  return { success: true, dispute: updatedDispute };
}
function getLocalDisputes(status = "OPEN", limitCount = 50) {
  try {
    let sql = "SELECT * FROM disputes";
    const params = [];
    if (status) {
      sql += " WHERE status = ?";
      params.push(status);
    }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limitCount);
    const rows = queryAll(sql, params);
    return rows.map((r) => ({
      id: r.id,
      fixtureId: r.fixture_id,
      seasonId: r.season_id,
      status: r.status,
      resolvedByUserId: r.resolved_by_user_id || void 0,
      resolutionNotes: r.resolution_notes || void 0,
      resolvedAt: r.resolved_at || void 0,
      createdAt: r.created_at
    }));
  } catch {
    return [];
  }
}
async function getDisputesFirestore(status = "OPEN", limitCount = 50) {
  const cacheKey = `firestore:disputes:${status}:${limitCount}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  if (!firestoreCircuitBreaker.canExecute()) {
    recordFallbackUsage();
    return getLocalDisputes(status, limitCount);
  }
  try {
    const db = getFirestoreDb();
    let query = db.collection(COLLECTIONS.DISPUTES);
    if (status) {
      query = query.where("status", "==", status);
    }
    if (limitCount > 0) {
      query = query.limit(limitCount);
    }
    const snap = await query.get();
    trackFirestoreRead(
      COLLECTIONS.DISPUTES,
      snap.empty ? 1 : snap.docs.length,
      "getDisputesFirestore"
    );
    firestoreCircuitBreaker.recordSuccess();
    const disputes = [];
    const fixtureIds = Array.from(new Set(snap.docs.map((d) => d.data().fixtureId).filter(Boolean)));
    const fixturesMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < fixtureIds.length; i += 30) {
      const chunk = fixtureIds.slice(i, i + 30);
      try {
        const fSnap = await db.collection(COLLECTIONS.FIXTURES).where(FirebaseFirestore.FieldPath.documentId(), "in", chunk).get();
        trackFirestoreRead(COLLECTIONS.FIXTURES, fSnap.empty ? 1 : fSnap.docs.length, "getDisputesFirestore:fixturesBatch");
        for (const doc of fSnap.docs) {
          const fData = doc.data();
          const homeClubSeed = SEED_CLUB_MAP.get(fData.homeClubId);
          const awayClubSeed = SEED_CLUB_MAP.get(fData.awayClubId);
          const homeClub = {
            id: fData.homeClubId,
            name: homeClubSeed?.name || fData.homeClubId,
            shortName: homeClubSeed?.shortName || fData.homeClubId.substring(0, 3).toUpperCase(),
            country: homeClubSeed?.country || "England",
            leagueId: homeClubSeed?.leagueId || "league-premier-league",
            logoUrl: homeClubSeed?.logoUrl || "",
            active: true,
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          const awayClub = {
            id: fData.awayClubId,
            name: awayClubSeed?.name || fData.awayClubId,
            shortName: awayClubSeed?.shortName || fData.awayClubId.substring(0, 3).toUpperCase(),
            country: awayClubSeed?.country || "England",
            leagueId: awayClubSeed?.leagueId || "league-premier-league",
            logoUrl: awayClubSeed?.logoUrl || "",
            active: true,
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          fixturesMap.set(doc.id, {
            id: doc.id,
            competitionId: fData.competitionId,
            seasonId: fData.seasonId,
            matchday: fData.matchday,
            homeClubId: fData.homeClubId,
            awayClubId: fData.awayClubId,
            homeScore: fData.homeScore,
            awayScore: fData.awayScore,
            status: fData.status,
            scheduledAt: fData.scheduledAt,
            homeClub,
            awayClub,
            createdAt: fData.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
            updatedAt: fData.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
          });
        }
      } catch (err) {
        console.warn("Batch fixture fetch error in getDisputesFirestore:", err.message);
      }
    }
    for (const doc of snap.docs) {
      const data = doc.data();
      const fixture = fixturesMap.get(data.fixtureId);
      let mappedStatus = "OPEN";
      if (data.status === "RESOLVED") mappedStatus = "RESOLVED";
      else if (data.status === "CANCELLED") mappedStatus = "DISMISSED";
      disputes.push({
        id: doc.id,
        fixtureId: data.fixtureId,
        seasonId: data.seasonId,
        status: mappedStatus,
        resolvedByUserId: data.resolvedByUserId,
        resolutionNotes: data.resolutionNotes,
        resolvedAt: data.resolvedAt,
        createdAt: data.createdAt,
        fixture: fixture || void 0
      });
    }
    setInCache(cacheKey, disputes, 3e4);
    return disputes;
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    return getLocalDisputes(status, limitCount);
  }
}
async function getAllUsersFirestore() {
  const cacheKey = "firestore:all_users";
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  const db = getFirestoreDb();
  const snap = await db.collection(COLLECTIONS.USERS).orderBy("createdAt", "desc").get();
  trackFirestoreRead(
    COLLECTIONS.USERS,
    snap.empty ? 1 : snap.docs.length,
    "getAllUsersFirestore"
  );
  const users = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      telegramId: data.telegramId,
      username: data.username,
      firstName: data.firstName,
      lastName: data.lastName,
      photoUrl: data.photoUrl,
      isAdmin: data.isAdmin,
      isSuspended: data.isSuspended,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    };
  });
  setInCache(cacheKey, users, 3e4);
  return users;
}
async function getAuditLogsFirestore(limit = 50) {
  const cacheKey = `firestore:audit_logs:${limit}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  const db = getFirestoreDb();
  const snap = await db.collection(COLLECTIONS.AUDIT_LOGS).orderBy("createdAt", "desc").limit(limit).get();
  trackFirestoreRead(
    COLLECTIONS.AUDIT_LOGS,
    snap.empty ? 1 : snap.docs.length,
    "getAuditLogsFirestore"
  );
  const logs = snap.docs.map((d) => {
    const data = d.data();
    let parsedOld = void 0;
    let parsedNew = void 0;
    try {
      if (data.oldValueJson) parsedOld = JSON.parse(data.oldValueJson);
    } catch {
      parsedOld = data.oldValueJson;
    }
    try {
      if (data.newValueJson) parsedNew = JSON.parse(data.newValueJson);
    } catch {
      parsedNew = data.newValueJson;
    }
    return {
      id: d.id,
      actorUserId: data.actorUserId,
      actorUsername: data.actorUsername,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      oldValue: parsedOld,
      newValue: parsedNew,
      ipAddress: data.ipAddress || void 0,
      notes: data.notes || void 0,
      createdAt: data.createdAt
    };
  });
  setInCache(cacheKey, logs, 2e4);
  return logs;
}
async function createAuditLogFirestore(actorUserId, action, entityType, entityId, oldValue, newValue, ipAddress, actorUsername, notes) {
  const db = getFirestoreDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    await db.collection(COLLECTIONS.AUDIT_LOGS).add({
      actorUserId,
      actorUsername: actorUsername || null,
      action,
      entityType,
      entityId,
      oldValueJson: oldValue ? JSON.stringify(oldValue) : null,
      newValueJson: newValue ? JSON.stringify(newValue) : null,
      ipAddress: ipAddress || null,
      notes: notes || null,
      createdAt: now
    });
    trackFirestoreWrite(COLLECTIONS.AUDIT_LOGS, 1, "createAuditLogFirestore");
  } catch (err) {
    console.warn("[FIRESTORE AUDIT LOG WARN]:", err.message);
  }
  try {
    queryRun(
      `INSERT INTO audit_logs (id, actor_user_id, actor_username, action, entity_type, entity_id, old_value_json, new_value_json, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditId,
        actorUserId,
        actorUsername || "",
        action,
        entityType,
        entityId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        ipAddress || null,
        now
      ]
    );
  } catch {
  }
}
async function createNotificationFirestore(userId, type, title, message, data) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const db = getFirestoreDb();
    await db.collection(COLLECTIONS.NOTIFICATIONS).add({
      userId,
      type,
      title,
      message,
      data: data || null,
      isRead: false,
      createdAt: now
    });
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] createNotificationFirestore:", err.message);
    const notifId = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    queryRun(
      `INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [notifId, userId, type, title, message, now]
    );
  }
}
async function getUserNotificationsFirestore(userId, limit = 30) {
  const cacheKey = `firestore:notifications:${userId}:${limit}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  const validTypes = [
    "MATCH_SCHEDULED",
    "RESULT_SUBMITTED",
    "RESULT_CONFIRMED",
    "DISPUTE_OPENED",
    "DISPUTE_RESOLVED",
    "CLUB_ASSIGNED",
    "NEXT_ROUND_MATCH",
    "QUALIFICATION_CONFIRMED",
    "COMPETITION_UPDATE",
    "SYSTEM"
  ];
  try {
    const db = getFirestoreDb();
    const snap = await db.collection(COLLECTIONS.NOTIFICATIONS).where("userId", "==", userId).orderBy("createdAt", "desc").limit(limit).get();
    trackFirestoreRead(
      COLLECTIONS.NOTIFICATIONS,
      snap.empty ? 1 : snap.docs.length,
      "getUserNotificationsFirestore"
    );
    const notifications = snap.docs.map((d) => {
      const data = d.data();
      const notifData = data.data || {};
      const notifType = validTypes.includes(data.type) ? data.type : data.type || "SYSTEM";
      return {
        id: d.id,
        userId: data.userId,
        type: notifType,
        title: data.title,
        message: data.message,
        fixtureId: data.fixtureId || notifData.fixtureId || void 0,
        entityType: data.entityType || notifData.entityType || void 0,
        entityId: data.entityId || notifData.entityId || void 0,
        isRead: Boolean(data.isRead),
        createdAt: data.createdAt
      };
    });
    setInCache(cacheKey, notifications, 3e4);
    return notifications;
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getUserNotificationsFirestore:", err.message);
    const rows = queryAll(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    );
    const fallbackNotifs = rows.map((r) => {
      const notifType = validTypes.includes(r.type) ? r.type : r.type || "SYSTEM";
      return {
        id: r.id,
        userId: r.user_id,
        type: notifType,
        title: r.title,
        message: r.message,
        fixtureId: r.fixture_id || void 0,
        isRead: Boolean(r.is_read),
        createdAt: r.created_at
      };
    });
    setInCache(cacheKey, fallbackNotifs, 3e4);
    return fallbackNotifs;
  }
}
async function markSingleNotificationReadFirestore(userId, notificationId) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  invalidateFirestoreCache(`firestore:notifications:${userId}`);
  const localNotif = queryGet("SELECT user_id FROM notifications WHERE id = ?", [notificationId]);
  if (localNotif && localNotif.user_id !== userId) {
    throw new Error(`OWNERSHIP_MISMATCH: User '${userId}' does not own notification '${notificationId}'.`);
  }
  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      const docRef = db.collection(COLLECTIONS.NOTIFICATIONS).doc(notificationId);
      const doc = await docRef.get();
      if (doc.exists) {
        if (doc.data()?.userId !== userId) {
          throw new Error(`OWNERSHIP_MISMATCH: User '${userId}' does not own notification '${notificationId}'.`);
        }
        await docRef.update({ isRead: true, readAt: now });
        try {
          queryRun(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id = ?`, [userId, notificationId]);
        } catch {
        }
        firestoreCircuitBreaker.recordSuccess();
        return;
      }
    } catch (err) {
      if (err.message?.includes("OWNERSHIP_MISMATCH")) {
        throw err;
      }
      console.warn("[FIRESTORE FALLBACK] markSingleNotificationReadFirestore:", err.message);
      firestoreCircuitBreaker.recordFailure(err);
    }
  }
  try {
    queryRun(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id = ?`, [userId, notificationId]);
  } catch {
  }
  enqueueMutation({
    mutationId: `notif_read_${notificationId}_${userId}`,
    entityType: "NOTIFICATION_READ",
    entityId: notificationId,
    operation: "MARK_READ",
    payload: { userId, notificationId, readAt: now },
    createdAt: now
  });
}
async function markNotificationsReadFirestore(userId) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  invalidateFirestoreCache(`firestore:notifications:${userId}`);
  try {
    queryRun(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [userId]);
  } catch {
  }
  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      const snap = await db.collection(COLLECTIONS.NOTIFICATIONS).where("userId", "==", userId).where("isRead", "==", false).get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach((doc) => batch.update(doc.ref, { isRead: true, readAt: now }));
        await batch.commit();
        firestoreCircuitBreaker.recordSuccess();
        return;
      }
    } catch (err) {
      console.warn("[FIRESTORE FALLBACK] markNotificationsReadFirestore:", err.message);
      firestoreCircuitBreaker.recordFailure(err);
    }
  }
  enqueueMutation({
    mutationId: `notif_read_all_${userId}_${Date.now()}`,
    entityType: "NOTIFICATION_READ_ALL",
    entityId: userId,
    operation: "MARK_ALL_READ",
    payload: { userId, readAt: now },
    createdAt: now
  });
}
async function syncFirestoreClubCrests() {
  try {
    const db = getFirestoreDb();
    let updatedClubs = 0;
    let updatedLeagues = 0;
    const leagueBatch = db.batch();
    for (const league of SEED_LEAGUES) {
      const ref = db.collection(COLLECTIONS.LEAGUES).doc(league.id);
      leagueBatch.set(
        ref,
        {
          id: league.id,
          name: league.name,
          country: league.country,
          tier: league.tier,
          logo: league.logoUrl,
          logoUrl: league.logoUrl
        },
        { merge: true }
      );
      updatedLeagues++;
    }
    await leagueBatch.commit();
    const chunkSize = 400;
    for (let i = 0; i < SEED_CLUBS.length; i += chunkSize) {
      const chunk = SEED_CLUBS.slice(i, i + chunkSize);
      const batch = db.batch();
      for (const club of chunk) {
        const ref = db.collection(COLLECTIONS.CLUBS).doc(club.id);
        batch.set(
          ref,
          {
            id: club.id,
            name: club.name,
            shortName: club.shortName,
            country: club.country,
            leagueId: club.leagueId,
            logo: club.logoUrl,
            logoUrl: club.logoUrl,
            isActive: true
          },
          { merge: true }
        );
        updatedClubs++;
      }
      await batch.commit();
    }
    invalidateFirestoreCache();
    console.log(
      `[FIRESTORE SYNC] Synchronized ${updatedClubs} club crests and ${updatedLeagues} league logos to Firestore.`
    );
    return { updatedClubs, updatedLeagues, totalClubs: SEED_CLUBS.length };
  } catch (err) {
    console.error("[FIRESTORE SYNC ERROR] Failed to sync club crests to Firestore:", err.message);
    throw err;
  }
}
async function adminReleaseClubFirestore(adminUserId, clubId, seasonId = "season-2026-27", options) {
  assertNoSyntheticIdsInProduction("adminReleaseClubFirestore", [adminUserId, clubId, seasonId]);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const db = getFirestoreDb();
    const clubRef = db.collection(COLLECTIONS.CLUBS).doc(clubId);
    const clubOccRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`);
    const clubOccDoc = await clubOccRef.get();
    const previousUserId = clubOccDoc.exists ? clubOccDoc.data()?.userId : null;
    const batch = db.batch();
    batch.set(clubOccRef, {
      clubId,
      userId: null,
      seasonId,
      status: "released",
      releasedByUserId: adminUserId,
      releasedAt: now,
      updatedAt: now
    }, { merge: true });
    if (previousUserId) {
      const userMemRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${previousUserId}`);
      batch.set(userMemRef, {
        status: "released",
        releasedAt: now,
        updatedAt: now
      }, { merge: true });
    }
    batch.update(clubRef, {
      isTaken: false,
      claimedByUserId: null,
      updatedAt: now
    });
    const auditRef = db.collection(COLLECTIONS.AUDIT_LOGS).doc();
    batch.set(auditRef, {
      actorUserId: adminUserId,
      action: "ADMIN_RELEASE_CLUB",
      entityType: "club",
      entityId: clubId,
      notes: `Admin released ownership from previous user '${previousUserId || "none"}'`,
      createdAt: now
    });
    await batch.commit();
    invalidateFirestoreCache();
    const updatedClub2 = await getClubByIdFirestore(clubId, seasonId);
    return {
      success: true,
      message: `Club '${updatedClub2?.name || clubId}' has been released and is now available.`,
      club: updatedClub2,
      authoritative: true,
      isFallback: false
    };
  } catch (err) {
    if (options?.authoritativeOnly || isHostedEnvironment()) {
      throw err;
    }
    console.warn("[FIRESTORE FALLBACK] adminReleaseClubFirestore:", err.message);
  }
  try {
    queryRun(
      "UPDATE club_memberships SET status = 'released', updated_at = ? WHERE club_id = ? AND season_id = ? AND status = 'active'",
      [now, clubId, seasonId]
    );
  } catch {
  }
  invalidateFirestoreCache();
  const updatedClub = await getClubByIdFirestore(clubId, seasonId);
  return {
    success: true,
    message: `Club '${updatedClub?.name || clubId}' has been released and is now available.`,
    club: updatedClub,
    authoritative: false,
    isFallback: true
  };
}
async function adminAssignClubFirestore(adminUserId, clubId, targetUserId, seasonId = "season-2026-27", options) {
  assertNoSyntheticIdsInProduction("adminAssignClubFirestore", [adminUserId, clubId, targetUserId, seasonId]);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const db = getFirestoreDb();
    const clubRef = db.collection(COLLECTIONS.CLUBS).doc(clubId);
    const clubDoc = await clubRef.get();
    if (!clubDoc.exists) {
      throw new ClubNotFoundError(`Club with ID '${clubId}' not found.`);
    }
    const clubOccRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`);
    const userMemRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${targetUserId}`);
    const membershipRef = db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${clubId}`);
    const existingUserMem = await userMemRef.get();
    if (existingUserMem.exists && existingUserMem.data()?.status === "active") {
      const prevClubId = existingUserMem.data().clubId;
      if (prevClubId && prevClubId !== clubId) {
        const prevOccRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${prevClubId}`);
        const prevClubRef = db.collection(COLLECTIONS.CLUBS).doc(prevClubId);
        await prevOccRef.set({ status: "released", updatedAt: now }, { merge: true });
        await prevClubRef.update({ isTaken: false, claimedByUserId: null, updatedAt: now });
      }
    }
    const batch = db.batch();
    batch.set(clubOccRef, {
      clubId,
      userId: targetUserId,
      seasonId,
      status: "active",
      claimedAt: now,
      updatedAt: now
    });
    batch.set(userMemRef, {
      userId: targetUserId,
      clubId,
      seasonId,
      status: "active",
      claimedAt: now,
      updatedAt: now
    });
    batch.set(membershipRef, {
      id: `cm-${seasonId}-${clubId}`,
      seasonId,
      clubId,
      userId: targetUserId,
      claimedAt: now,
      status: "active",
      updatedAt: now
    });
    batch.update(clubRef, {
      isTaken: true,
      claimedByUserId: targetUserId,
      updatedAt: now
    });
    const auditRef = db.collection(COLLECTIONS.AUDIT_LOGS).doc();
    batch.set(auditRef, {
      actorUserId: adminUserId,
      action: "ADMIN_ASSIGN_CLUB",
      entityType: "club",
      entityId: clubId,
      notes: `Admin assigned club to user '${targetUserId}'`,
      createdAt: now
    });
    await batch.commit();
    invalidateFirestoreCache();
    const updatedClub2 = await getClubByIdFirestore(clubId, seasonId);
    return {
      success: true,
      message: `Club '${updatedClub2?.name || clubId}' assigned to player '${targetUserId}'.`,
      club: updatedClub2,
      authoritative: true,
      isFallback: false
    };
  } catch (err) {
    if (options?.authoritativeOnly || isHostedEnvironment()) {
      throw err;
    }
    console.warn("[FIRESTORE FALLBACK] adminAssignClubFirestore:", err.message);
  }
  try {
    queryRun(
      "UPDATE club_memberships SET status = 'released', updated_at = ? WHERE user_id = ? AND season_id = ? AND status = 'active'",
      [now, targetUserId, seasonId]
    );
    queryRun(
      `INSERT OR REPLACE INTO club_memberships (id, season_id, club_id, user_id, claimed_at, status, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      [`cm-${seasonId}-${clubId}`, seasonId, clubId, targetUserId, now, now]
    );
  } catch {
  }
  invalidateFirestoreCache();
  const updatedClub = await getClubByIdFirestore(clubId, seasonId);
  return {
    success: true,
    message: `Club '${updatedClub?.name || clubId}' assigned to player '${targetUserId}'.`,
    club: updatedClub,
    authoritative: false,
    isFallback: true
  };
}
function getLocalPendingResults(seasonId, limitCount = 50) {
  try {
    const rows = queryAll(
      `SELECT * FROM fixtures WHERE season_id = ? AND status IN ('PENDING_CONFIRMATION', 'DISPUTED') ORDER BY matchday ASC LIMIT ?`,
      [seasonId, limitCount]
    );
    const fixturesWithSubmissions = rows.map((r) => {
      const homeSeed = SEED_CLUB_MAP.get(r.home_club_id);
      const awaySeed = SEED_CLUB_MAP.get(r.away_club_id);
      const subRows = queryAll(
        `SELECT * FROM result_submissions WHERE fixture_id = ? ORDER BY created_at ASC`,
        [r.id]
      );
      const submissions = subRows.map((s) => ({
        id: s.id,
        submittedByUserId: s.submitted_by_user_id,
        submitterUsername: s.submitted_by_user_id,
        submitterName: s.submitted_by_user_id,
        clubId: s.club_id,
        homeScore: s.home_score,
        awayScore: s.away_score,
        proofUrl: s.proof_url,
        createdAt: s.created_at,
        status: "PENDING_SYNC"
      }));
      return {
        id: r.id,
        seasonId: r.season_id,
        competitionId: r.competition_id,
        competitionName: r.competition_id,
        matchday: r.matchday,
        roundName: r.round_name,
        homeClubId: !r.home_club_id || r.home_club_id === "TBD" ? null : r.home_club_id,
        awayClubId: !r.away_club_id || r.away_club_id === "TBD" ? null : r.away_club_id,
        homeClub: !r.home_club_id || r.home_club_id === "TBD" ? null : {
          id: r.home_club_id,
          name: homeSeed?.name || r.home_club_id,
          shortName: homeSeed?.shortName || r.home_club_id,
          country: homeSeed?.country || "",
          leagueId: homeSeed?.leagueId || "",
          logoUrl: homeSeed?.logoUrl || "",
          active: true,
          createdAt: ""
        },
        awayClub: !r.away_club_id || r.away_club_id === "TBD" ? null : {
          id: r.away_club_id,
          name: awaySeed?.name || r.away_club_id,
          shortName: awaySeed?.shortName || r.away_club_id,
          country: awaySeed?.country || "",
          leagueId: awaySeed?.leagueId || "",
          logoUrl: awaySeed?.logoUrl || "",
          active: true,
          createdAt: ""
        },
        homeOwnerId: r.home_owner_id,
        awayOwnerId: r.away_owner_id,
        scheduledAt: r.scheduled_at,
        status: r.status,
        homeScore: r.home_score ?? void 0,
        awayScore: r.away_score ?? void 0,
        winnerClubId: r.winner_club_id ?? void 0,
        resultConfirmedAt: r.result_confirmed_at ?? void 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        submissions
      };
    });
    return {
      pendingFixtures: fixturesWithSubmissions,
      total: fixturesWithSubmissions.length
    };
  } catch (err) {
    console.warn("[LOCAL_PENDING_FALLBACK] Error loading local pending fixtures:", err.message);
    return { pendingFixtures: [], total: 0 };
  }
}
async function adminApproveFixtureResultFirestore(adminUserId, fixtureId, homeScore, awayScore, notes, options) {
  assertNoSyntheticIdsInProduction("adminApproveFixtureResultFirestore", [adminUserId, fixtureId]);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let winnerClubId = null;
  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
      const fixDoc = await fixRef.get();
      if (!fixDoc.exists) {
        throw new Error(`Fixture '${fixtureId}' not found.`);
      }
      const fixture = fixDoc.data();
      if (homeScore > awayScore) winnerClubId = fixture.homeClubId;
      else if (awayScore > homeScore) winnerClubId = fixture.awayClubId;
      await fixRef.update({
        status: "CONFIRMED",
        homeScore,
        awayScore,
        winnerClubId,
        resultConfirmedAt: now,
        updatedAt: now
      });
      const disputesSnap = await db.collection(COLLECTIONS.DISPUTES).where("fixtureId", "==", fixtureId).get();
      for (const d of disputesSnap.docs) {
        await d.ref.update({
          status: "RESOLVED",
          resolvedByUserId: adminUserId,
          resolutionNotes: notes || "Approved by tournament administrator",
          resolvedAt: now
        });
      }
      if (winnerClubId) {
        try {
          const { advanceKnockoutWinnerFirestore: advanceKnockoutWinnerFirestore2 } = await Promise.resolve().then(() => (init_knockoutEngine(), knockoutEngine_exports));
          await advanceKnockoutWinnerFirestore2(fixtureId);
        } catch (err) {
          console.warn("[KNOCKOUT_ADVANCE] Non-blocking advance error on admin approval:", err);
        }
      }
      if (fixture.competitionId) {
        try {
          await rebuildCompetitionStandingsFirestore2(fixture.competitionId);
        } catch (standingsErr) {
          console.warn("[STANDINGS_UPDATE] Non-blocking standings update error on admin approval:", standingsErr);
        }
      }
      await db.collection(COLLECTIONS.AUDIT_LOGS).add({
        actorUserId: adminUserId,
        action: "ADMIN_APPROVE_RESULT",
        entityType: "fixture",
        entityId: fixtureId,
        notes: notes || `Admin confirmed result ${homeScore}-${awayScore}`,
        createdAt: now
      });
      invalidateFirestoreCache();
      const updatedFixture2 = await getFixtureByIdFirestore(fixtureId);
      return {
        success: true,
        message: `Match result (${homeScore} - ${awayScore}) confirmed and standings updated.`,
        fixture: updatedFixture2,
        authoritative: true,
        isFallback: false
      };
    } catch (err) {
      if (options?.authoritativeOnly || isHostedEnvironment()) {
        throw err;
      }
      firestoreCircuitBreaker.recordFailure(err);
      recordFallbackUsage();
      console.warn("[FIRESTORE FALLBACK] adminApproveFixtureResultFirestore:", err.message);
    }
  } else {
    if (options?.authoritativeOnly || isHostedEnvironment()) {
      throw new Error("CIRCUIT_OPEN: Firestore circuit breaker is OPEN. Authoritative write cannot execute.");
    }
    recordFallbackUsage();
  }
  const localFix = queryGet("SELECT * FROM fixtures WHERE id = ?", [fixtureId]);
  if (!localFix) {
    throw new Error(`Fixture '${fixtureId}' not found in local database.`);
  }
  if (homeScore > awayScore) winnerClubId = localFix.home_club_id;
  else if (awayScore > homeScore) winnerClubId = localFix.away_club_id;
  queryRun(
    `UPDATE fixtures 
     SET status = 'CONFIRMED', home_score = ?, away_score = ?, winner_club_id = ?, result_confirmed_at = ?, updated_at = ? 
     WHERE id = ?`,
    [homeScore, awayScore, winnerClubId, now, now, fixtureId]
  );
  queryRun(
    `UPDATE disputes 
     SET status = 'RESOLVED', resolved_by_user_id = ?, resolution_notes = ?, resolved_at = ? 
     WHERE fixture_id = ?`,
    [adminUserId, notes || "Approved by tournament administrator (offline queued)", now, fixtureId]
  );
  enqueueMutation({
    mutationId: `admin_approve_${fixtureId}`,
    entityType: "ADMIN_DECISION",
    entityId: fixtureId,
    operation: "ADMIN_APPROVE_RESULT",
    payload: {
      adminUserId,
      fixtureId,
      homeScore,
      awayScore,
      notes: notes || "Approved by tournament administrator (offline queued)"
    },
    createdAt: now
  });
  const updatedFixture = await getFixtureByIdFirestore(fixtureId);
  return {
    success: true,
    message: `Match result (${homeScore} - ${awayScore}) confirmed locally (queued for background sync).`,
    fixture: updatedFixture,
    authoritative: false,
    isFallback: true
  };
}
async function getPendingResultsFirestore(seasonId = "season-2026-27") {
  const cacheKey = `firestore:admin_pending_results:${seasonId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  if (!firestoreCircuitBreaker.canExecute()) {
    recordFallbackUsage();
    return getLocalPendingResults(seasonId);
  }
  try {
    const db = getFirestoreDb();
    const [pendingSnap, disputedSnap] = await Promise.all([
      db.collection(COLLECTIONS.FIXTURES).where("seasonId", "==", seasonId).where("status", "==", "PENDING_CONFIRMATION").get(),
      db.collection(COLLECTIONS.FIXTURES).where("seasonId", "==", seasonId).where("status", "==", "DISPUTED").get()
    ]);
    const fixReads = (pendingSnap.empty ? 1 : pendingSnap.docs.length) + (disputedSnap.empty ? 1 : disputedSnap.docs.length);
    trackFirestoreRead(COLLECTIONS.FIXTURES, fixReads, "getPendingResultsFirestore:fixtures");
    const allDocs = [...pendingSnap.docs, ...disputedSnap.docs];
    if (allDocs.length === 0) {
      const emptyResult = { pendingFixtures: [], total: 0 };
      setInCache(cacheKey, emptyResult, 3e4);
      return emptyResult;
    }
    const fixtureIds = allDocs.map((d) => d.id);
    const submissionsMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < fixtureIds.length; i += 30) {
      const chunk = fixtureIds.slice(i, i + 30);
      const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where("fixtureId", "in", chunk).get();
      trackFirestoreRead(
        COLLECTIONS.RESULT_SUBMISSIONS,
        subsSnap.empty ? 1 : subsSnap.docs.length,
        "getPendingResultsFirestore:submissions"
      );
      for (const subDoc of subsSnap.docs) {
        const subData = subDoc.data();
        const arr = submissionsMap.get(subData.fixtureId) || [];
        arr.push({
          id: subDoc.id,
          submittedByUserId: subData.submittedByUserId,
          submitterUsername: subData.submittedByUserId,
          submitterName: subData.submittedByUserId,
          clubId: subData.clubId,
          homeScore: subData.homeScore,
          awayScore: subData.awayScore,
          proofUrl: subData.proofUrl,
          createdAt: subData.createdAt
        });
        submissionsMap.set(subData.fixtureId, arr);
      }
    }
    const fixturesWithSubmissions = allDocs.map((doc) => {
      const r = doc.data();
      const homeSeed = SEED_CLUB_MAP.get(r.homeClubId);
      const awaySeed = SEED_CLUB_MAP.get(r.awayClubId);
      const submissions = submissionsMap.get(doc.id) || [];
      return {
        id: doc.id,
        seasonId: r.seasonId,
        competitionId: r.competitionId,
        competitionName: r.competitionName || r.competitionId,
        matchday: r.matchday,
        roundName: r.roundName,
        homeClubId: !r.homeClubId || r.homeClubId === "TBD" ? null : r.homeClubId,
        awayClubId: !r.awayClubId || r.awayClubId === "TBD" ? null : r.awayClubId,
        homeClub: !r.homeClubId || r.homeClubId === "TBD" ? null : {
          id: r.homeClubId,
          name: homeSeed?.name || r.homeClubId,
          shortName: homeSeed?.shortName || r.homeClubId,
          country: homeSeed?.country || "",
          leagueId: homeSeed?.leagueId || "",
          logoUrl: homeSeed?.logoUrl || "",
          active: true,
          createdAt: ""
        },
        awayClub: !r.awayClubId || r.awayClubId === "TBD" ? null : {
          id: r.awayClubId,
          name: awaySeed?.name || r.awayClubId,
          shortName: awaySeed?.shortName || r.awayClubId,
          country: awaySeed?.country || "",
          leagueId: awaySeed?.leagueId || "",
          logoUrl: awaySeed?.logoUrl || "",
          active: true,
          createdAt: ""
        },
        homeOwnerId: r.homeOwnerId,
        awayOwnerId: r.awayOwnerId,
        scheduledAt: r.scheduledAt,
        status: r.status,
        homeScore: r.homeScore ?? void 0,
        awayScore: r.awayScore ?? void 0,
        winnerClubId: r.winnerClubId ?? void 0,
        resultConfirmedAt: r.resultConfirmedAt ?? void 0,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        submissions
      };
    });
    const result = {
      pendingFixtures: fixturesWithSubmissions,
      total: fixturesWithSubmissions.length
    };
    setInCache(cacheKey, result, 3e4);
    return result;
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    recordFallbackUsage();
    console.warn("[FIRESTORE FALLBACK] getPendingResultsFirestore:", err.message);
    return getLocalPendingResults(seasonId);
  }
}
async function adminEditFixtureResultFirestore(adminUserId, adminUsername, fixtureId, params) {
  if (params.homeScore < 0 || params.awayScore < 0) {
    throw new Error("Scores must be non-negative integers.");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const db = getFirestoreDb();
  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();
  if (!fixDoc.exists) {
    throw new Error(`Fixture '${fixtureId}' not found.`);
  }
  const existing = fixDoc.data();
  const oldScore = {
    homeScore: existing.homeScore,
    awayScore: existing.awayScore,
    status: existing.status,
    winnerClubId: existing.winnerClubId
  };
  let winnerClubId = null;
  if (params.homeScore > params.awayScore) winnerClubId = existing.homeClubId;
  else if (params.awayScore > params.homeScore) winnerClubId = existing.awayClubId;
  const targetStatus = params.status || "CONFIRMED";
  await fixRef.update({
    status: targetStatus,
    homeScore: params.homeScore,
    awayScore: params.awayScore,
    winnerClubId,
    resultConfirmedAt: targetStatus === "CONFIRMED" ? now : null,
    updatedAt: now
  });
  try {
    queryRun(
      `UPDATE fixtures 
       SET status = ?, home_score = ?, away_score = ?, winner_club_id = ?, result_confirmed_at = ?, updated_at = ? 
       WHERE id = ?`,
      [
        targetStatus,
        params.homeScore,
        params.awayScore,
        winnerClubId,
        targetStatus === "CONFIRMED" ? now : null,
        now,
        fixtureId
      ]
    );
  } catch (err) {
    console.warn("[SQLITE UPDATE FIXTURE]:", err.message);
  }
  if (winnerClubId && targetStatus === "CONFIRMED") {
    try {
      const { advanceKnockoutWinnerFirestore: advanceKnockoutWinnerFirestore2 } = await Promise.resolve().then(() => (init_knockoutEngine(), knockoutEngine_exports));
      await advanceKnockoutWinnerFirestore2(fixtureId);
    } catch (err) {
      console.warn("[KNOCKOUT_ADVANCE]:", err);
    }
  }
  if (existing.competitionId) {
    try {
      await rebuildCompetitionStandingsFirestore2(existing.competitionId);
    } catch (err) {
      console.warn("[STANDINGS_REBUILD]:", err);
    }
  }
  const actionName = existing.status === "CONFIRMED" || existing.homeScore != null ? "ADMIN_EDIT_RESULT" : "ADMIN_SET_RESULT";
  await createAuditLogFirestore(
    adminUserId,
    actionName,
    "fixture",
    fixtureId,
    oldScore,
    { homeScore: params.homeScore, awayScore: params.awayScore, winnerClubId, status: targetStatus },
    void 0,
    adminUsername,
    params.notes || `Admin set result ${params.homeScore}-${params.awayScore}`
  );
  invalidateFirestoreCache();
  const updated = await getFixtureByIdFirestore(fixtureId);
  return {
    success: true,
    message: `Result updated to ${params.homeScore}-${params.awayScore} (${targetStatus}) and standings recalculated.`,
    fixture: updated
  };
}
async function adminDeleteFixtureResultFirestore(adminUserId, adminUsername, fixtureId, options) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const db = getFirestoreDb();
  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();
  if (!fixDoc.exists) {
    throw new Error(`Fixture '${fixtureId}' not found.`);
  }
  const existing = fixDoc.data();
  const oldScore = {
    homeScore: existing.homeScore,
    awayScore: existing.awayScore,
    status: existing.status,
    winnerClubId: existing.winnerClubId
  };
  await fixRef.update({
    status: "SCHEDULED",
    homeScore: null,
    awayScore: null,
    winnerClubId: null,
    resultConfirmedAt: null,
    updatedAt: now
  });
  try {
    queryRun(
      `UPDATE fixtures 
       SET status = 'SCHEDULED', home_score = NULL, away_score = NULL, winner_club_id = NULL, result_confirmed_at = NULL, updated_at = ? 
       WHERE id = ?`,
      [now, fixtureId]
    );
  } catch (err) {
    console.warn("[SQLITE DELETE RESULT]:", err.message);
  }
  if (options?.deleteSubmissions) {
    try {
      const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where("fixtureId", "==", fixtureId).get();
      const batch = db.batch();
      subsSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      queryRun("DELETE FROM result_submissions WHERE fixture_id = ?", [fixtureId]);
    } catch (err) {
      console.warn("[DELETE SUBMISSIONS]:", err.message);
    }
  }
  if (existing.competitionId) {
    try {
      await rebuildCompetitionStandingsFirestore2(existing.competitionId);
    } catch (err) {
      console.warn("[STANDINGS_REBUILD]:", err);
    }
  }
  await createAuditLogFirestore(
    adminUserId,
    "ADMIN_DELETE_RESULT",
    "fixture",
    fixtureId,
    oldScore,
    { status: "SCHEDULED", homeScore: null, awayScore: null },
    void 0,
    adminUsername,
    options?.notes || "Admin deleted match result and reset status to SCHEDULED"
  );
  invalidateFirestoreCache();
  const updated = await getFixtureByIdFirestore(fixtureId);
  return {
    success: true,
    message: "Match result deleted and status reset to SCHEDULED. Standings recalculated.",
    fixture: updated
  };
}
async function adminDeleteFixtureFirestore(adminUserId, adminUsername, fixtureId, reason) {
  if (!reason || reason.trim().length < 3) {
    throw new Error("A reason of at least 3 characters is required to delete a fixture.");
  }
  const db = getFirestoreDb();
  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();
  if (!fixDoc.exists) {
    throw new Error(`Fixture '${fixtureId}' not found.`);
  }
  const existing = fixDoc.data();
  const snapshot = { ...existing, id: fixtureId };
  await fixRef.delete();
  try {
    const [subsSnap, dispSnap] = await Promise.all([
      db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where("fixtureId", "==", fixtureId).get(),
      db.collection(COLLECTIONS.DISPUTES).where("fixtureId", "==", fixtureId).get()
    ]);
    const batch = db.batch();
    subsSnap.docs.forEach((d) => batch.delete(d.ref));
    dispSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch (err) {
    console.warn("[DELETE SUBMISSIONS/DISPUTES]:", err.message);
  }
  try {
    queryRun("DELETE FROM fixtures WHERE id = ?", [fixtureId]);
    queryRun("DELETE FROM result_submissions WHERE fixture_id = ?", [fixtureId]);
    queryRun("DELETE FROM disputes WHERE fixture_id = ?", [fixtureId]);
  } catch (err) {
    console.warn("[SQLITE DELETE FIXTURE]:", err.message);
  }
  if (existing.competitionId && existing.status === "CONFIRMED") {
    try {
      await rebuildCompetitionStandingsFirestore2(existing.competitionId);
    } catch (err) {
      console.warn("[STANDINGS_REBUILD]:", err);
    }
  }
  await createAuditLogFirestore(
    adminUserId,
    "ADMIN_DELETE_FIXTURE",
    "fixture",
    fixtureId,
    snapshot,
    null,
    void 0,
    adminUsername,
    reason
  );
  invalidateFirestoreCache();
  return {
    success: true,
    message: `Fixture '${fixtureId}' deleted successfully.`
  };
}
async function adminSetUserAdminFirestore(adminUserId, adminUsername, targetUserId, isAdmin) {
  const db = getFirestoreDb();
  const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throw new Error(`User '${targetUserId}' not found.`);
  }
  const userData = userDoc.data();
  if (!isAdmin) {
    const allUsers = await getAllUsersFirestore();
    const adminCount = allUsers.filter((u) => u.isAdmin).length;
    if (adminCount <= 1 && userData.isAdmin) {
      throw new Error("PROTECTION_ERROR: Cannot remove the last administrator from the system.");
    }
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await userRef.update({
    isAdmin,
    updatedAt: now
  });
  try {
    queryRun("UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?", [isAdmin ? 1 : 0, now, targetUserId]);
  } catch (err) {
    console.warn("[SQLITE USER ADMIN UPDATE]:", err.message);
  }
  await createAuditLogFirestore(
    adminUserId,
    isAdmin ? "ADMIN_MAKE_ADMIN" : "ADMIN_REMOVE_ADMIN",
    "user",
    targetUserId,
    { isAdmin: userData.isAdmin },
    { isAdmin },
    void 0,
    adminUsername,
    `Admin changed role of @${userData.username || targetUserId} to ${isAdmin ? "ADMIN" : "PLAYER"}`
  );
  invalidateFirestoreCache();
  const updatedUser = {
    id: targetUserId,
    telegramId: userData.telegramId,
    username: userData.username,
    firstName: userData.firstName,
    lastName: userData.lastName,
    photoUrl: userData.photoUrl,
    isAdmin,
    isSuspended: Boolean(userData.isSuspended),
    createdAt: userData.createdAt,
    updatedAt: now
  };
  return {
    success: true,
    message: `@${userData.username || targetUserId} is now ${isAdmin ? "an Administrator" : "a Standard Player"}.`,
    user: updatedUser
  };
}
async function adminSetUserSuspensionFirestore(adminUserId, adminUsername, targetUserId, isSuspended, reason) {
  const db = getFirestoreDb();
  const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throw new Error(`User '${targetUserId}' not found.`);
  }
  const userData = userDoc.data();
  if (targetUserId === adminUserId && isSuspended) {
    throw new Error("PROTECTION_ERROR: You cannot suspend your own administrative account.");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await userRef.update({
    isSuspended,
    updatedAt: now
  });
  try {
    queryRun("UPDATE users SET is_suspended = ?, updated_at = ? WHERE id = ?", [isSuspended ? 1 : 0, now, targetUserId]);
  } catch (err) {
    console.warn("[SQLITE USER SUSPEND UPDATE]:", err.message);
  }
  await createAuditLogFirestore(
    adminUserId,
    isSuspended ? "ADMIN_SUSPEND_USER" : "ADMIN_UNSUSPEND_USER",
    "user",
    targetUserId,
    { isSuspended: Boolean(userData.isSuspended) },
    { isSuspended },
    void 0,
    adminUsername,
    reason || (isSuspended ? "User account suspended by administrator" : "User account reinstated")
  );
  invalidateFirestoreCache();
  const updatedUser = {
    id: targetUserId,
    telegramId: userData.telegramId,
    username: userData.username,
    firstName: userData.firstName,
    lastName: userData.lastName,
    photoUrl: userData.photoUrl,
    isAdmin: Boolean(userData.isAdmin),
    isSuspended,
    createdAt: userData.createdAt,
    updatedAt: now
  };
  return {
    success: true,
    message: `@${userData.username || targetUserId} has been ${isSuspended ? "suspended" : "unsuspended"}.`,
    user: updatedUser
  };
}
async function adminDeleteUserFirestore(adminUserId, adminUsername, targetUserId, reason) {
  const db = getFirestoreDb();
  const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throw new Error(`User '${targetUserId}' not found.`);
  }
  const userData = userDoc.data();
  if (targetUserId === adminUserId) {
    throw new Error("PROTECTION_ERROR: You cannot delete your own administrative account.");
  }
  if (userData.isAdmin) {
    const allUsers = await getAllUsersFirestore();
    const adminCount = allUsers.filter((u) => u.isAdmin).length;
    if (adminCount <= 1) {
      throw new Error("PROTECTION_ERROR: Cannot delete the last administrator.");
    }
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const userSnapshot = { ...userData, id: targetUserId };
  try {
    const occSnap = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where("userId", "==", targetUserId).get();
    const batch = db.batch();
    for (const d of occSnap.docs) {
      const data = d.data();
      batch.update(d.ref, {
        userId: null,
        status: "released",
        releasedAt: now,
        releasedByUserId: adminUserId,
        updatedAt: now
      });
      if (data.clubId) {
        const clubRef = db.collection(COLLECTIONS.CLUBS).doc(data.clubId);
        batch.update(clubRef, {
          isTaken: false,
          claimedByUserId: null,
          updatedAt: now
        });
      }
    }
    const memSnap = await db.collection(COLLECTIONS.USER_MEMBERSHIPS).where("userId", "==", targetUserId).get();
    for (const d of memSnap.docs) {
      batch.update(d.ref, {
        status: "released",
        releasedAt: now,
        updatedAt: now
      });
    }
    const notifSnap = await db.collection(COLLECTIONS.NOTIFICATIONS).where("userId", "==", targetUserId).get();
    for (const d of notifSnap.docs) {
      batch.delete(d.ref);
    }
    batch.delete(userRef);
    await batch.commit();
  } catch (err) {
    console.warn("[DELETE USER FIRESTORE BATCH]:", err.message);
  }
  try {
    queryRun("UPDATE club_memberships SET status = 'released', updated_at = ? WHERE user_id = ?", [now, targetUserId]);
    queryRun("DELETE FROM notifications WHERE user_id = ?", [targetUserId]);
    queryRun("DELETE FROM users WHERE id = ?", [targetUserId]);
  } catch (err) {
    console.warn("[SQLITE DELETE USER]:", err.message);
  }
  await createAuditLogFirestore(
    adminUserId,
    "ADMIN_DELETE_USER",
    "user",
    targetUserId,
    userSnapshot,
    null,
    void 0,
    adminUsername,
    reason || `User @${userData.username || targetUserId} deleted safely`
  );
  invalidateFirestoreCache();
  return {
    success: true,
    message: `User @${userData.username || targetUserId} deleted safely. Historical fixtures and results remain intact.`
  };
}
function getLocalSubmissions(filter) {
  try {
    let sql = "SELECT * FROM result_submissions WHERE 1=1";
    const params = [];
    if (filter?.fixtureId) {
      sql += " AND fixture_id = ?";
      params.push(filter.fixtureId);
    }
    if (filter?.userId) {
      sql += " AND submitted_by_user_id = ?";
      params.push(filter.userId);
    }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(filter?.limit || 100);
    const rows = queryAll(sql, params);
    return rows.map((r) => ({
      id: r.id,
      fixtureId: r.fixture_id,
      submittedByUserId: r.submitted_by_user_id,
      clubId: r.club_id,
      homeScore: r.home_score,
      awayScore: r.away_score,
      proofUrl: r.proof_url || null,
      createdAt: r.created_at
    }));
  } catch {
    return [];
  }
}
async function adminGetUserDetailFirestore(targetUserId) {
  let user = null;
  try {
    user = await getUserByIdFirestore(targetUserId);
  } catch {
  }
  if (!user) {
    const localUser = queryGet("SELECT * FROM users WHERE id = ?", [targetUserId]);
    if (localUser) {
      user = {
        id: localUser.id,
        telegramId: localUser.telegram_id,
        username: localUser.username,
        firstName: localUser.first_name,
        lastName: localUser.last_name || "",
        photoUrl: localUser.photo_url || "",
        isAdmin: Boolean(localUser.is_admin),
        isSuspended: Boolean(localUser.is_suspended),
        createdAt: localUser.created_at,
        updatedAt: localUser.updated_at
      };
    }
  }
  if (!user) {
    throw new Error(`User '${targetUserId}' not found.`);
  }
  const activeClub = await getUserActiveClubFirestore(targetUserId, "season-2026-27");
  let memberships = [];
  try {
    if (firestoreCircuitBreaker.canExecute()) {
      const db = getFirestoreDb();
      const memSnap = await db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).where("userId", "==", targetUserId).get();
      memberships = memSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } else {
      memberships = queryAll("SELECT * FROM club_memberships WHERE user_id = ?", [targetUserId]);
    }
  } catch {
    try {
      memberships = queryAll("SELECT * FROM club_memberships WHERE user_id = ?", [targetUserId]);
    } catch {
    }
  }
  let submissions = [];
  try {
    submissions = await adminGetResultSubmissionsFirestore({ userId: targetUserId, limit: 30 });
  } catch {
  }
  let auditLogs = [];
  try {
    if (firestoreCircuitBreaker.canExecute()) {
      const db = getFirestoreDb();
      const auditSnap = await db.collection(COLLECTIONS.AUDIT_LOGS).where("entityId", "==", targetUserId).limit(20).get();
      auditLogs = auditSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  } catch {
  }
  return {
    user,
    activeClub,
    memberships,
    submissionsCount: submissions.length,
    recentSubmissions: submissions,
    auditLogs,
    notificationsCount: 0
  };
}
async function adminGetResultSubmissionsFirestore(filter) {
  if (!firestoreCircuitBreaker.canExecute()) {
    return getLocalSubmissions(filter);
  }
  try {
    const db = getFirestoreDb();
    let query = db.collection(COLLECTIONS.RESULT_SUBMISSIONS);
    if (filter?.fixtureId) {
      query = query.where("fixtureId", "==", filter.fixtureId);
    }
    if (filter?.userId) {
      query = query.where("submittedByUserId", "==", filter.userId);
    }
    query = query.limit(filter?.limit || 100);
    const snap = await query.get();
    trackFirestoreRead(
      COLLECTIONS.RESULT_SUBMISSIONS,
      snap.empty ? 1 : snap.docs.length,
      "adminGetResultSubmissionsFirestore"
    );
    const submissions = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      submissions.push({
        id: doc.id,
        fixtureId: data.fixtureId,
        submittedByUserId: data.submittedByUserId || data.userId,
        clubId: data.clubId,
        homeScore: data.homeScore,
        awayScore: data.awayScore,
        proofUrl: data.proofUrl || null,
        createdAt: data.createdAt
      });
    }
    return submissions;
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    return getLocalSubmissions(filter);
  }
}
async function adminDeleteResultSubmissionFirestore(adminUserId, adminUsername, submissionId, notes) {
  const db = getFirestoreDb();
  const subRef = db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc(submissionId);
  const subDoc = await subRef.get();
  if (!subDoc.exists) {
    throw new Error(`Submission '${submissionId}' not found.`);
  }
  const subData = subDoc.data();
  await subRef.delete();
  try {
    queryRun("DELETE FROM result_submissions WHERE id = ?", [submissionId]);
  } catch {
  }
  await createAuditLogFirestore(
    adminUserId,
    "ADMIN_DELETE_SUBMISSION",
    "submission",
    submissionId,
    subData,
    null,
    void 0,
    adminUsername,
    notes || "Admin deleted invalid score submission"
  );
  return {
    success: true,
    message: `Result submission '${submissionId}' has been deleted.`
  };
}
var SEED_CLUB_MAP, ClubConflictError, ClubNotFoundError, serverCache, lastKnownGoodStandings, lastKnownGoodFixtures, readMetrics, getFirestoreTelemetry, compOverrideMap, matchdayLocksCache;
var init_firestoreStore = __esm({
  "src/server/firebase/firestoreStore.ts"() {
    init_admin();
    init_db();
    init_seed();
    init_circuitBreaker();
    init_circuitBreaker();
    init_occupancySnapshot();
    init_mutationQueue();
    init_fixtureEngine();
    init_readModelStore();
    init_collections();
    init_testGuard();
    SEED_CLUB_MAP = new Map(
      SEED_CLUBS.map((c) => [c.id, c])
    );
    ClubConflictError = class extends Error {
      constructor(message, code = "CLUB_CONFLICT") {
        super(message);
        this.name = "ClubConflictError";
        this.code = code;
      }
    };
    ClubNotFoundError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "ClubNotFoundError";
      }
    };
    serverCache = /* @__PURE__ */ new Map();
    lastKnownGoodStandings = /* @__PURE__ */ new Map();
    lastKnownGoodFixtures = /* @__PURE__ */ new Map();
    readMetrics = {
      sessionReads: 0,
      sessionWrites: 0,
      readsByCollection: {},
      readsByFunction: {},
      cacheHits: 0,
      cacheMisses: 0,
      fallbackCount: 0,
      classifications: {
        STATIC: 0,
        DYNAMIC: 0,
        MUTATION: 0,
        ADMIN: 0
      },
      endpointMetrics: {},
      startedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    getFirestoreTelemetry = getReadMetrics;
    compOverrideMap = /* @__PURE__ */ new Map();
    matchdayLocksCache = /* @__PURE__ */ new Map();
    ensureMatchdayLocksTable();
  }
});

// src/server/services/adminService.ts
async function createAuditLog(actorUserId, action, entityType, entityId, oldValue, newValue, ipAddress, actorUsername, notes) {
  await createAuditLogFirestore(actorUserId, action, entityType, entityId, oldValue, newValue, ipAddress, actorUsername, notes);
}
async function getDisputes(status = "OPEN") {
  return await getDisputesFirestore(status);
}
async function editFixtureResult(adminUserId, adminUsername, fixtureId, params) {
  return await adminEditFixtureResultFirestore(adminUserId, adminUsername, fixtureId, params);
}
async function deleteFixtureResult(adminUserId, adminUsername, fixtureId, options) {
  return await adminDeleteFixtureResultFirestore(adminUserId, adminUsername, fixtureId, options);
}
async function deleteFixture(adminUserId, adminUsername, fixtureId, reason) {
  return await adminDeleteFixtureFirestore(adminUserId, adminUsername, fixtureId, reason);
}
async function getAllAdminUsers() {
  return await getAllUsersFirestore();
}
async function getUserDetail(targetUserId) {
  return await adminGetUserDetailFirestore(targetUserId);
}
async function setUserAdminRole(adminUserId, adminUsername, targetUserId, isAdmin) {
  return await adminSetUserAdminFirestore(adminUserId, adminUsername, targetUserId, isAdmin);
}
async function setUserSuspension(adminUserId, adminUsername, targetUserId, isSuspended, reason) {
  return await adminSetUserSuspensionFirestore(adminUserId, adminUsername, targetUserId, isSuspended, reason);
}
async function deleteUser(adminUserId, adminUsername, targetUserId, reason) {
  return await adminDeleteUserFirestore(adminUserId, adminUsername, targetUserId, reason);
}
async function getResultSubmissions(filter) {
  return await adminGetResultSubmissionsFirestore(filter);
}
async function deleteResultSubmission(adminUserId, adminUsername, submissionId, notes) {
  return await adminDeleteResultSubmissionFirestore(adminUserId, adminUsername, submissionId, notes);
}
async function getAuditLogs(limit = 50) {
  return await getAuditLogsFirestore(limit);
}
var init_adminService = __esm({
  "src/server/services/adminService.ts"() {
    init_firestoreStore();
  }
});

// src/server/app.ts
import express from "express";
import { timingSafeEqual } from "node:crypto";

// src/server/services/telegramNotificationQueue.ts
init_admin();
init_collections();

// src/server/services/telegramBotService.ts
var POSITIVE_MEMBERSHIP_CACHE_TTL_MS = 5 * 60 * 1e3;
var NEGATIVE_MEMBERSHIP_CACHE_TTL_MS = 20 * 1e3;
var membershipCache = /* @__PURE__ */ new Map();
async function verifyTelegramGroupMembership(telegramUserId, forceRefresh) {
  const userIdStr = String(telegramUserId).trim();
  if (!userIdStr) {
    return { isMember: false, status: "empty_user_id" };
  }
  if (!forceRefresh) {
    const cached = membershipCache.get(userIdStr);
    if (cached) {
      const ttl = cached.isMember ? POSITIVE_MEMBERSHIP_CACHE_TTL_MS : NEGATIVE_MEMBERSHIP_CACHE_TTL_MS;
      if (Date.now() - cached.timestamp < ttl) {
        return { isMember: cached.isMember, status: cached.status, cached: true };
      }
    }
  }
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const groupUsername = (process.env.TELEGRAM_GROUP_USERNAME || "@efleagueuz").trim();
  if (!botToken) {
    const isDev = process.env.ENABLE_DEV_AUTH === "true" || process.env.NODE_ENV !== "production";
    if (isDev) {
      console.log(`[TELEGRAM MEMBERSHIP] No TELEGRAM_BOT_TOKEN set in dev environment. Allowing user ${userIdStr} in sandbox.`);
      return { isMember: true, status: "dev_mock_allowed" };
    }
    console.warn(`[TELEGRAM MEMBERSHIP] TELEGRAM_BOT_TOKEN is missing in production.`);
    return { isMember: true, status: "fail_open_no_token" };
  }
  const url = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(groupUsername)}&user_id=${encodeURIComponent(userIdStr)}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6e3);
    const response = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const data = await response.json();
    if (data && data.ok && data.result) {
      const status = data.result.status;
      const isRestrictedMember = status === "restricted" && Boolean(data.result.is_member);
      const isMember = ["creator", "administrator", "member"].includes(status) || isRestrictedMember;
      membershipCache.set(userIdStr, {
        isMember,
        status: status || "unknown",
        timestamp: Date.now()
      });
      return { isMember, status };
    }
    const description = (data?.description || "").toLowerCase();
    if (description.includes("user not found") || description.includes("participant_id_invalid") || description.includes("not a member") || description.includes("chat not found")) {
      membershipCache.set(userIdStr, {
        isMember: false,
        status: "left_or_not_found",
        timestamp: Date.now()
      });
      return { isMember: false, status: "left_or_not_found" };
    }
    console.warn(`[TELEGRAM MEMBERSHIP CHECK] Non-definitive Telegram response for user ${userIdStr}:`, data);
    return { isMember: true, status: "fail_open_transient_error" };
  } catch (err) {
    console.warn(`[TELEGRAM MEMBERSHIP CHECK] Network failure querying Telegram for user ${userIdStr}: ${err.message}`);
    return { isMember: true, status: "fail_open_network_timeout" };
  }
}
async function sendTelegramMessage(chatId, text, options = {}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured" };
  }
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(1e4),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options.parse_mode || "HTML",
        reply_markup: options.reply_markup
      })
    });
    const data = await res.json();
    return { ...data, error: data.description || data.error };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
async function sendTelegramSticker(chatId, stickerFileId) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured" };
  }
  const url = `https://api.telegram.org/bot${botToken}/sendSticker`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        sticker: stickerFileId
      })
    });
    const data = await res.json();
    return data;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
async function handleTelegramStart(chatId, fromUser) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    console.warn("[TELEGRAM BOT /start] Missing TELEGRAM_BOT_TOKEN");
    return { ok: false, messageSent: false, error: "TELEGRAM_BOT_TOKEN is missing" };
  }
  const stickerFileId = process.env.TELEGRAM_WELCOME_STICKER_FILE_ID?.trim();
  let stickerSent = false;
  if (stickerFileId) {
    try {
      const stickerRes = await sendTelegramSticker(chatId, stickerFileId);
      stickerSent = Boolean(stickerRes && stickerRes.ok);
    } catch (err) {
      console.warn("[TELEGRAM BOT] Failed to send welcome sticker:", err.message);
    }
  }
  const rawFirstName = fromUser?.first_name || "Foydalanuvchi";
  const cleanFirstName = rawFirstName.replace(/[<>]/g, "");
  const webAppUrl = process.env.TELEGRAM_WEBAPP_URL?.trim() || process.env.APP_URL?.trim() || "https://efluz.vercel.app";
  const groupUsername = (process.env.TELEGRAM_GROUP_USERNAME || "@efleagueuz").trim();
  const groupUrl = groupUsername.startsWith("@") ? `https://t.me/${groupUsername.slice(1)}` : `https://t.me/${groupUsername}`;
  const welcomeText = `Assalomu alaykum, <b>${cleanFirstName}</b>!

\u26BD <b>EFL UZ</b> \u2014 eFootball O\u2018zbekiston Rasmiy Ligasi platformasiga xush kelibsiz!

\u{1F3C6} <b>Top 5 Yevropa Ligalari:</b>
\u2022 \u{1F1EC}\u{1F1E7} Premier League
\u2022 \u{1F1EA}\u{1F1F8} La Liga
\u2022 \u{1F1EE}\u{1F1F9} Serie A
\u2022 \u{1F1E9}\u{1F1EA} Bundesliga
\u2022 \u{1F1EB}\u{1F1F7} Ligue 1

\u2694\uFE0F <b>Asosiy Imkoniyatlar:</b>
\u2022 Sevimli klubingizni tanlang va boshqaring
\u2022 Real-vaqt matchmarkaz va eFootball bahslari
\u2022 Ikki tomonlama natija tasdiqlash va hakamlik
\u2022 UEFA Chempionlar Ligasi saralash tizimi

Quyidagi tugma orqali ilovani oching va o\u2018z klubingizni band qiling!`;
  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: "\u26BD Ilovani ochish (EFL UZ)",
          web_app: { url: webAppUrl }
        }
      ],
      [
        {
          text: `\u{1F4E2} Rasmiy guruh (${groupUsername})`,
          url: groupUrl
        }
      ]
    ]
  };
  const msgRes = await sendTelegramMessage(chatId, welcomeText, {
    parse_mode: "HTML",
    reply_markup: replyMarkup
  });
  return {
    ok: msgRes.ok,
    stickerSent,
    messageSent: msgRes.ok,
    error: msgRes.error
  };
}

// src/server/services/telegramNotificationQueue.ts
init_adminService();
init_readModelStore();
init_seed();
import crypto2 from "crypto";
var BROADCASTS_KEY = `${KEY_PREFIX}:telegram:broadcasts`;
var QUEUE_KEY = `${KEY_PREFIX}:telegram:queue`;
var PROCESSING_KEY = `${KEY_PREFIX}:telegram:processing`;
var WORKER_LOCK = `${KEY_PREFIX}:telegram:worker-lock`;
var RECIPIENT_DIR_KEY = `${KEY_PREFIX}:private:recipient-directory`;
var memoryBroadcasts = /* @__PURE__ */ new Map();
var memoryRecipientDirectory = /* @__PURE__ */ new Map();
var memoryRecipientSeason = "";
async function syncRecipientDirectory(seasonId = "season-2026-27") {
  const dirMap = /* @__PURE__ */ new Map();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const db = getFirestoreDb();
    const [usersSnap, occSnap] = await Promise.all([
      db.collection(COLLECTIONS.USERS).limit(1001).get(),
      db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where("seasonId", "==", seasonId).get()
    ]);
    if (usersSnap.size > 1e3) throw new Error("RECIPIENT_DIRECTORY_TOO_LARGE");
    const occupancyMap = /* @__PURE__ */ new Map();
    for (const doc of occSnap.docs) {
      const data = doc.data();
      if (data.userId && data.clubId && !["released", "inactive"].includes(data.status)) {
        occupancyMap.set(data.userId, { clubId: data.clubId, claimedAt: data.claimedAt });
      }
    }
    const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));
    const leaguesMap = new Map(SEED_LEAGUES.map((l) => [l.id, l]));
    for (const doc of usersSnap.docs) {
      const u = { ...doc.data(), id: doc.id };
      const occ = occupancyMap.get(u.id);
      const club = occ ? clubsMap.get(occ.clubId) : void 0;
      const league = club ? leaguesMap.get(club.leagueId) : void 0;
      const hasTelegram = Boolean(u.telegramId && String(u.telegramId).trim().length > 0);
      const entry = {
        userId: u.id,
        username: u.username || `player_${u.id.substring(0, 6)}`,
        displayName: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "EFL Player",
        telegramId: u.telegramId || null,
        clubId: club?.id,
        clubName: club?.name,
        leagueId: league?.id,
        leagueName: league?.name,
        messageable: hasTelegram && !u.isSuspended,
        updatedAt: now
      };
      dirMap.set(u.id, entry);
    }
  } catch (error) {
    throw new Error("RECIPIENT_DIRECTORY_UNAVAILABLE: existing directory preserved");
  }
  const entriesArray = Array.from(dirMap.values());
  const client = getUpstashClient();
  if (client) {
    await client.set(`${RECIPIENT_DIR_KEY}:${seasonId}`, entriesArray);
  }
  memoryRecipientDirectory.clear();
  for (const entry of entriesArray) memoryRecipientDirectory.set(entry.userId, entry);
  memoryRecipientSeason = seasonId;
  return entriesArray.length;
}
async function getSafeEligibleRecipients(filter, seasonId = "season-2026-27") {
  if (memoryRecipientSeason !== seasonId) memoryRecipientDirectory.clear();
  const client = getUpstashClient();
  let entries = [];
  if (client) {
    try {
      const cached = await client.get(`${RECIPIENT_DIR_KEY}:${seasonId}`);
      if (Array.isArray(cached) && cached.length > 0) {
        entries = cached;
        memoryRecipientDirectory.clear();
        for (const entry of cached) memoryRecipientDirectory.set(entry.userId, entry);
        memoryRecipientSeason = seasonId;
      }
    } catch {
    }
  }
  if (entries.length === 0) {
    if (memoryRecipientDirectory.size === 0) await syncRecipientDirectory(seasonId);
    entries = Array.from(memoryRecipientDirectory.values());
  }
  let filtered = entries;
  if (filter?.audience === "CLUB_OWNERS") {
    filtered = filtered.filter((r) => Boolean(r.clubId));
  } else if (filter?.audience === "LEAGUE_OWNERS" && filter.leagueId) {
    filtered = filtered.filter((r) => r.leagueId === filter.leagueId && Boolean(r.clubId));
  }
  return filtered.map((r) => ({
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    clubId: r.clubId,
    clubName: r.clubName,
    leagueId: r.leagueId,
    leagueName: r.leagueName,
    hasTelegram: Boolean(r.telegramId),
    messageable: r.messageable
  }));
}
async function enqueueTelegramBroadcast(params) {
  const seasonId = params.seasonId || "season-2026-27";
  const durableClient = getUpstashClient();
  if (!durableClient) throw new Error("REDIS_REQUIRED: durable notification storage is unavailable");
  if (!["ALL_USERS", "CLUB_OWNERS", "LEAGUE_OWNERS", "SELECTED_RECIPIENTS"].includes(params.targetAudience)) throw new Error("INVALID_AUDIENCE");
  if (params.targetAudience === "LEAGUE_OWNERS" && !params.targetLeagueId) throw new Error("LEAGUE_REQUIRED");
  if (typeof params.title !== "string" || typeof params.body !== "string" || !params.title.trim() || !params.body.trim() || params.title.length + params.body.length > 3500) throw new Error("INVALID_MESSAGE");
  await getSafeEligibleRecipients(void 0, seasonId);
  if (params.requestId && !/^[a-zA-Z0-9-]{8,100}$/.test(params.requestId)) throw new Error("INVALID_REQUEST_ID");
  const requestId = params.requestId || crypto2.randomUUID();
  const broadcastId = `bcast-${crypto2.createHash("sha256").update(params.adminUserId + ":" + requestId).digest("hex")}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let targetUserIds = [];
  if (params.targetAudience === "SELECTED_RECIPIENTS") {
    if (!Array.isArray(params.selectedUserIds)) throw new Error("RECIPIENTS_REQUIRED");
    targetUserIds = [...new Set(params.selectedUserIds)];
    if (targetUserIds.some((uid) => typeof uid !== "string" || !memoryRecipientDirectory.has(uid))) throw new Error("UNKNOWN_RECIPIENT");
  } else {
    const safeRecipients = await getSafeEligibleRecipients(
      { audience: params.targetAudience, leagueId: params.targetLeagueId },
      seasonId
    );
    targetUserIds = safeRecipients.map((r) => r.userId);
  }
  if (targetUserIds.length === 0) {
    throw new Error("No eligible recipients found for this broadcast selection.");
  }
  const recipientStatuses = [];
  const jobs = [];
  for (const uid of targetUserIds) {
    const recipient = memoryRecipientDirectory.get(uid);
    const hasTg = Boolean(recipient?.telegramId && recipient.messageable);
    recipientStatuses.push({
      userId: uid,
      username: recipient?.username || "user",
      displayName: recipient?.displayName || "User",
      clubName: recipient?.clubName,
      status: hasTg ? "PENDING" : "SKIPPED_NO_TELEGRAM",
      error: hasTg ? void 0 : "User has no connected Telegram account",
      retryCount: 0
    });
    if (hasTg) {
      jobs.push({
        jobId: `job-${broadcastId}-${uid}`,
        broadcastId,
        userId: uid,
        username: recipient?.username || "user",
        displayName: recipient?.displayName || "User",
        telegramId: recipient.telegramId,
        title: params.title,
        body: params.body,
        type: params.type,
        status: "QUEUED",
        retryCount: 0,
        maxRetries: 3,
        createdAt: now
      });
    }
  }
  const record = {
    id: broadcastId,
    seasonId,
    title: params.title,
    body: params.body,
    type: params.type,
    targetAudience: params.targetAudience,
    targetLeagueId: params.targetLeagueId,
    createdById: params.adminUserId,
    createdByUsername: params.adminUsername,
    createdAt: now,
    status: jobs.length > 0 ? "QUEUED" : "COMPLETED",
    metrics: {
      totalRecipients: targetUserIds.length,
      sentCount: 0,
      failedCount: 0,
      skippedCount: recipientStatuses.filter((r) => r.status === "SKIPPED_NO_TELEGRAM").length
    },
    recipients: recipientStatuses
  };
  const persistedRecord = await durableClient.eval(`
    local existing = redis.call('HGET', KEYS[1], ARGV[1])
    if existing then return existing end
    redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
    local jobs = cjson.decode(ARGV[3])
    for _, job in ipairs(jobs) do redis.call('RPUSH', KEYS[2], cjson.encode(job)) end
    return ARGV[2]
  `, [BROADCASTS_KEY, QUEUE_KEY], [broadcastId, JSON.stringify(record), JSON.stringify(jobs)]);
  if (persistedRecord.title !== record.title || persistedRecord.body !== record.body || persistedRecord.seasonId !== seasonId || JSON.stringify(persistedRecord.recipients.map((r) => r.userId).sort()) !== JSON.stringify(targetUserIds.slice().sort())) throw new Error("REQUEST_ID_REUSED_WITH_DIFFERENT_CONTENT");
  memoryBroadcasts.set(broadcastId, persistedRecord);
  await createAuditLog(
    params.adminUserId,
    "TELEGRAM_NOTIFICATION_BROADCAST",
    "BROADCAST",
    broadcastId,
    void 0,
    {
      broadcastId,
      title: params.title,
      type: params.type,
      recipientsTotal: targetUserIds.length,
      queuedJobs: jobs.length,
      skippedNoTelegram: record.metrics.skippedCount,
      timestamp: now
    },
    void 0,
    params.adminUsername,
    `Enqueued broadcast '${params.title}' for ${targetUserIds.length} recipients (${jobs.length} with Telegram).`
  ).catch(() => console.warn("[NOTIF_QUEUE] Broadcast persisted; auxiliary audit unavailable"));
  return persistedRecord;
}
async function processNotificationQueue(batchSize = 25) {
  const client = getUpstashClient();
  if (!client) throw new Error("REDIS_REQUIRED");
  const token = crypto2.randomUUID();
  if (!await client.set(WORKER_LOCK, token, { nx: true, ex: 120 })) return { processed: 0, succeeded: 0, failed: 0 };
  let processed = 0, succeeded = 0, failed = 0;
  const deadline = Date.now() + 2e4;
  try {
    const abandoned = await client.hgetall(PROCESSING_KEY);
    for (const job of Object.values(abandoned || {})) {
      if ((job.claimedAt || 0) + 12e4 > Date.now()) continue;
      await updateBroadcastRecipientState(job.broadcastId, job.userId, "FAILED", "DELIVERY_UNKNOWN: worker interrupted; verify delivery before creating another broadcast");
      await client.hdel(PROCESSING_KEY, job.jobId);
    }
    for (let i = 0; i < Math.min(Math.max(batchSize, 1), 25) && Date.now() < deadline; i++) {
      const job = await client.eval(`
        if redis.call('GET', KEYS[3]) ~= ARGV[1] then return nil end
        local raw = redis.call('LPOP', KEYS[1])
        if not raw then return nil end
        local job = cjson.decode(raw)
        job.claimedAt = tonumber(ARGV[2])
        redis.call('HSET', KEYS[2], job.jobId, cjson.encode(job))
        return cjson.encode(job)
      `, [QUEUE_KEY, PROCESSING_KEY, WORKER_LOCK], [token, Date.now()]);
      if (!job) break;
      processed++;
      const record = await getBroadcastDetails(job.broadcastId);
      const recipient = record?.recipients.find((r) => r.userId === job.userId);
      if (!record || !recipient) throw new Error("BROADCAST_RECORD_MISSING");
      if (["SENT", "FAILED", "SKIPPED_NO_TELEGRAM"].includes(recipient.status)) {
        await client.hdel(PROCESSING_KEY, job.jobId);
        continue;
      }
      if (recipient.status === "SENDING") {
        await updateBroadcastRecipientState(job.broadcastId, job.userId, "FAILED", "DELIVERY_UNKNOWN: interrupted send");
        await client.hdel(PROCESSING_KEY, job.jobId);
        continue;
      }
      recipient.status = "SENDING";
      record.status = "PROCESSING";
      await client.hset(BROADCASTS_KEY, { [record.id]: record });
      const result = await sendTelegramMessage(job.telegramId, formatTelegramMessage(job.title, job.body, job.type), { parse_mode: "HTML" });
      if (result.ok) {
        await updateBroadcastRecipientState(job.broadcastId, job.userId, "SENT", void 0, (/* @__PURE__ */ new Date()).toISOString());
        succeeded++;
      } else {
        await updateBroadcastRecipientState(job.broadcastId, job.userId, "FAILED", result.error_code ? `TELEGRAM_${result.error_code}: ${result.error || "Rejected"}${result.parameters?.retry_after ? "; retry after " + result.parameters.retry_after + " seconds" : ""}` : "DELIVERY_UNKNOWN: " + (result.error || "No response"));
        failed++;
      }
      await client.hdel(PROCESSING_KEY, job.jobId);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { processed, succeeded, failed };
  } finally {
    await client.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", [WORKER_LOCK], [token]);
  }
}
function formatTelegramMessage(title, body, type) {
  let icon = "\u{1F4E2}";
  if (type === "NEW_MATCHDAY") icon = "\u26BD";
  if (type === "UPCOMING_MATCH") icon = "\u23F0";
  if (type === "COMPETITION_UPDATE") icon = "\u{1F3C6}";
  return `<b>${icon} EFL UZ Official Alert</b>

<b>${escapeHtml(title)}</b>

${escapeHtml(body)}

<i>Season 2026/27 \u2022 Open EFL WebApp to manage fixtures</i>`;
}
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
async function updateBroadcastRecipientState(broadcastId, userId, status, error, sentAt) {
  const bcast = await getBroadcastDetails(broadcastId);
  if (!bcast) throw new Error("BROADCAST_RECORD_MISSING");
  const r = bcast.recipients.find((rec) => rec.userId === userId);
  if (r) {
    r.status = status;
    if (error) r.error = error;
    if (sentAt) r.sentAt = sentAt;
  }
  bcast.metrics.sentCount = bcast.recipients.filter((r2) => r2.status === "SENT").length;
  bcast.metrics.failedCount = bcast.recipients.filter((r2) => r2.status === "FAILED").length;
  const totalFinished = bcast.metrics.sentCount + bcast.metrics.failedCount + bcast.metrics.skippedCount;
  if (totalFinished >= bcast.metrics.totalRecipients) {
    bcast.status = bcast.metrics.failedCount > 0 ? "PARTIALLY_FAILED" : "COMPLETED";
  }
  const client = getUpstashClient();
  if (client) {
    await client.hset(BROADCASTS_KEY, { [broadcastId]: bcast });
  }
  memoryBroadcasts.set(broadcastId, bcast);
}
async function getBroadcastHistory(limit = 20) {
  const client = getUpstashClient();
  if (client) {
    try {
      const records = await client.hgetall(BROADCASTS_KEY);
      if (records) {
        const list = Object.values(records);
        return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
      }
    } catch {
    }
  }
  return Array.from(memoryBroadcasts.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
}
async function getBroadcastDetails(broadcastId) {
  const client = getUpstashClient();
  if (client) {
    try {
      const record = await client.hget(BROADCASTS_KEY, broadcastId);
      if (record) return record;
    } catch {
    }
  }
  return memoryBroadcasts.get(broadcastId) || null;
}

// src/server/app.ts
init_db();
init_seed();

// src/server/auth/telegramAuth.ts
init_firestoreStore();
import crypto4 from "crypto";

// src/server/auth/sessionToken.ts
import crypto3 from "crypto";
function getSessionSecret() {
  return process.env.SESSION_SECRET || process.env.TELEGRAM_BOT_TOKEN || "efl-uz-secure-session-key-production-2026";
}
function base64UrlEncode(str) {
  return Buffer.from(str).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf8");
}
function createSessionToken(user, expiresInSeconds = 86400) {
  const now = Math.floor(Date.now() / 1e3);
  const claims = {
    id: user.id,
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    photoUrl: user.photoUrl,
    isAdmin: Boolean(user.isAdmin),
    isSuspended: Boolean(user.isSuspended),
    iat: now,
    exp: now + expiresInSeconds
  };
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto3.createHmac("sha256", getSessionSecret()).update(data).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${data}.${signature}`;
}
function verifySessionToken(token) {
  if (!token || typeof token !== "string") {
    return { isValid: false, error: "Missing token" };
  }
  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    return { isValid: false, error: "Malformed token structure" };
  }
  const [encodedHeader, encodedPayload, receivedSig] = parts;
  const data = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = crypto3.createHmac("sha256", getSessionSecret()).update(data).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const expectedBuf = Buffer.from(expectedSig);
  const receivedBuf = Buffer.from(receivedSig);
  if (expectedBuf.length !== receivedBuf.length || !crypto3.timingSafeEqual(expectedBuf, receivedBuf)) {
    return { isValid: false, error: "Invalid token signature" };
  }
  try {
    const claims = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1e3);
    if (claims.exp && claims.exp < now) {
      return { isValid: false, error: "Token expired" };
    }
    return { isValid: true, claims };
  } catch (err) {
    return { isValid: false, error: "Invalid token claims" };
  }
}

// src/server/auth/telegramAuth.ts
function verifyTelegramWebAppData(initData, botToken, maxAgeSeconds = 86400) {
  if (!initData || !botToken) {
    return { isValid: false, error: "Missing initData or botToken" };
  }
  const cleanToken = botToken.trim();
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");
    if (!hash) {
      return { isValid: false, error: "Missing hash in initData" };
    }
    const paramsList = [];
    urlParams.forEach((val, key) => {
      if (key !== "hash") {
        paramsList.push(`${key}=${val}`);
      }
    });
    paramsList.sort();
    const dataCheckString = paramsList.join("\n");
    const secretKey = crypto4.createHmac("sha256", "WebAppData").update(cleanToken).digest();
    const calculatedHash = crypto4.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    const calculatedHashBuf = Buffer.from(calculatedHash, "hex");
    const receivedHashBuf = Buffer.from(hash, "hex");
    if (calculatedHashBuf.length !== receivedHashBuf.length || !crypto4.timingSafeEqual(calculatedHashBuf, receivedHashBuf)) {
      return { isValid: false, error: "Invalid HMAC signature" };
    }
    const authDateStr = urlParams.get("auth_date");
    const authDate = authDateStr ? parseInt(authDateStr, 10) : 0;
    if (maxAgeSeconds > 0 && authDate > 0) {
      const nowSec = Math.floor(Date.now() / 1e3);
      if (nowSec - authDate > maxAgeSeconds) {
        return { isValid: false, error: "Authentication data expired (auth_date is too old)" };
      }
    }
    const userRaw = urlParams.get("user");
    let user;
    if (userRaw) {
      user = JSON.parse(userRaw);
    }
    return { isValid: true, user, authDate };
  } catch (err) {
    return { isValid: false, error: err.message || "Telegram verification failed" };
  }
}
async function getOrCreateTelegramUser(tgUser) {
  return await getOrCreateTelegramUserFirestore(tgUser);
}
var DEV_PROFILES = [
  {
    id: "user-dev-a",
    telegramId: "10001",
    username: "arsenal_pro",
    firstName: "John (User A)",
    lastName: "Arsenal",
    isAdmin: false
  },
  {
    id: "user-dev-b",
    telegramId: "10002",
    username: "chelsea_king",
    firstName: "David (User B)",
    lastName: "Chelsea",
    isAdmin: false
  },
  {
    id: "user-dev-admin",
    telegramId: "99999",
    username: "superadmin",
    firstName: "Admin",
    lastName: "Officer",
    isAdmin: true
  }
];
async function getOrCreateDevUser(devUserId) {
  return await getOrCreateDevUserFirestore(devUserId);
}

// src/server/middleware/authMiddleware.ts
var cachedUserByTelegramId = /* @__PURE__ */ new Map();
var cachedUserByDevId = /* @__PURE__ */ new Map();
async function authMiddleware(req, res, next) {
  const isDev = process.env.ENABLE_DEV_AUTH === "true" || process.env.NODE_ENV !== "production";
  const authHeader = req.headers.authorization;
  const sessionTokenHeader = req.headers["x-session-token"];
  let token;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (sessionTokenHeader) {
    token = sessionTokenHeader.trim();
  }
  if (token) {
    const verified = verifySessionToken(token);
    if (verified.isValid && verified.claims) {
      req.user = {
        id: verified.claims.id,
        telegramId: verified.claims.telegramId,
        username: verified.claims.username,
        firstName: verified.claims.firstName,
        lastName: verified.claims.lastName,
        photoUrl: verified.claims.photoUrl,
        isAdmin: Boolean(verified.claims.isAdmin),
        isSuspended: Boolean(verified.claims.isSuspended),
        createdAt: "",
        updatedAt: ""
      };
      return next();
    }
  }
  const initData = req.headers["x-telegram-init-data"] || req.query.initData;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (initData) {
    if (botToken) {
      const verifyResult = verifyTelegramWebAppData(initData, botToken);
      if (verifyResult.isValid && verifyResult.user) {
        const tgId = String(verifyResult.user.id);
        const cached = cachedUserByTelegramId.get(tgId);
        if (cached && cached.expiresAt > Date.now()) {
          req.user = cached.user;
          return next();
        }
        try {
          const user = await getOrCreateTelegramUser(verifyResult.user);
          cachedUserByTelegramId.set(tgId, { user, expiresAt: Date.now() + 3e5 });
          req.user = user;
          return next();
        } catch (err) {
          console.warn("Telegram user retrieval error:", err.message);
        }
      }
    } else if (isDev) {
      try {
        const urlParams = new URLSearchParams(initData);
        const userRaw = urlParams.get("user");
        if (userRaw) {
          const parsed = JSON.parse(userRaw);
          const tgId = String(parsed.id);
          const cached = cachedUserByTelegramId.get(tgId);
          if (cached && cached.expiresAt > Date.now()) {
            req.user = cached.user;
            return next();
          }
          const user = await getOrCreateTelegramUser(parsed);
          cachedUserByTelegramId.set(tgId, { user, expiresAt: Date.now() + 3e5 });
          req.user = user;
          return next();
        }
      } catch {
      }
    }
  }
  const devUserId = req.headers["x-dev-user-id"];
  if (isDev && devUserId) {
    const cachedDev = cachedUserByDevId.get(devUserId);
    if (cachedDev && cachedDev.expiresAt > Date.now()) {
      req.user = cachedDev.user;
      return next();
    }
    try {
      const user = await getOrCreateDevUser(devUserId);
      cachedUserByDevId.set(devUserId, { user, expiresAt: Date.now() + 3e5 });
      req.user = user;
      return next();
    } catch (err) {
      console.warn("Dev auth error:", err.message);
    }
  }
  next();
}
function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({
      error: "Unauthorized",
      message: "You must be authenticated via Telegram WebApp to access this resource."
    });
    return;
  }
  if (req.user.isSuspended) {
    res.status(403).json({
      error: "Account Suspended",
      message: "Your account has been suspended by an administrator."
    });
    return;
  }
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Authentication required."
    });
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({
      error: "Forbidden",
      message: "You do not have administrative privileges."
    });
    return;
  }
  next();
}

// src/server/app.ts
init_circuitBreaker();
init_occupancySnapshot();
init_mutationQueue();

// src/server/routes/readOptimized.routes.ts
init_firestoreStore();
init_readModelStore();
import { Router } from "express";
var readOptimizedRouter = Router();
readOptimizedRouter.get("/leagues", async (req, res, next) => {
  try {
    const leagues = await getAllLeaguesFirestore();
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    res.json({ leagues });
  } catch (err) {
    if (err instanceof ReadModelNotWarmedError || err?.errorCode === "READ_MODEL_NOT_WARMED") {
      res.status(503).json({ errorCode: "READ_MODEL_NOT_WARMED", message: "Read model is not warmed and database is unreachable" });
      return;
    }
    next(err);
  }
});
readOptimizedRouter.get("/competitions", async (req, res, next) => {
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const competitions = await getAllCompetitionsFirestore(seasonId);
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    res.json({ competitions });
  } catch (err) {
    if (err instanceof ReadModelNotWarmedError || err?.errorCode === "READ_MODEL_NOT_WARMED") {
      res.status(503).json({ errorCode: "READ_MODEL_NOT_WARMED", message: "Read model is not warmed and database is unreachable" });
      return;
    }
    next(err);
  }
});
readOptimizedRouter.get("/competitions/:id", async (req, res, next) => {
  try {
    const competition = await getCompetitionByIdFirestore(req.params.id);
    if (!competition) {
      return next();
    }
    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=120, stale-while-revalidate=300");
    res.json({ competition });
  } catch (err) {
    if (err instanceof ReadModelNotWarmedError || err?.errorCode === "READ_MODEL_NOT_WARMED") {
      res.status(503).json({ errorCode: "READ_MODEL_NOT_WARMED", message: "Read model is not warmed and database is unreachable" });
      return;
    }
    next(err);
  }
});
readOptimizedRouter.get("/competitions/:id/standings", async (req, res, next) => {
  try {
    const standings = await calculateCompetitionStandingsFirestore(req.params.id);
    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=120, stale-while-revalidate=300");
    res.json({ standings });
  } catch (err) {
    if (err instanceof ReadModelNotWarmedError || err?.errorCode === "READ_MODEL_NOT_WARMED") {
      res.status(503).json({ errorCode: "READ_MODEL_NOT_WARMED", message: "Read model is not warmed and database is unreachable" });
      return;
    }
    next(err);
  }
});
readOptimizedRouter.get("/competitions/:id/fixtures", async (req, res, next) => {
  const matchday = req.query.matchday ? parseInt(req.query.matchday, 10) : void 0;
  const status = req.query.status;
  try {
    const fixtures = await getFixturesFirestore({
      competitionId: req.params.id,
      matchday,
      status
    });
    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=180");
    res.json({ fixtures });
  } catch (err) {
    if (err instanceof ReadModelNotWarmedError || err?.errorCode === "READ_MODEL_NOT_WARMED") {
      res.status(503).json({ errorCode: "READ_MODEL_NOT_WARMED", message: "Read model is not warmed and database is unreachable" });
      return;
    }
    next(err);
  }
});

// src/server/routes/health.routes.ts
import { Router as Router2 } from "express";
init_admin();
init_collections();
init_circuitBreaker();
init_mutationQueue();
var healthRouter = Router2();
var lastManualProbeTime = 0;
var MANUAL_PROBE_COOLDOWN_MS = 6e4;
healthRouter.get("/", async (req, res) => {
  const status = getFirebaseStatus();
  const cbStatus = firestoreCircuitBreaker.getStatus();
  const queue = getQueueStats();
  const isConnected = Boolean(status.isConfigured && firestoreCircuitBreaker.canExecute());
  const connectionWarning = !firestoreCircuitBreaker.canExecute() ? "Firestore circuit breaker is open (fallback mode active)" : !status.isConfigured ? "Firebase credentials not configured" : null;
  res.status(200).json({
    status: "ok",
    database: "firestore",
    connected: isConnected,
    isOffline: !firestoreCircuitBreaker.canExecute(),
    circuitBreaker: {
      status: cbStatus.state,
      state: cbStatus.state,
      failureCount: cbStatus.totalErrors,
      consecutiveFailures: cbStatus.consecutiveFailures,
      resourceExhaustedCount: cbStatus.resourceExhaustedCount,
      cooldownRemainingMs: cbStatus.cooldownRemainingMs
    },
    queueStats: queue,
    firebaseConfigured: status.isConfigured,
    projectId: status.projectId,
    databaseId: status.databaseId,
    firestoreDatabaseId: status.databaseId,
    authMode: status.authMode,
    warning: connectionWarning || void 0,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    version: "2.0.0-firestore-production"
  });
});
healthRouter.post("/probe", async (req, res) => {
  const now = Date.now();
  if (now - lastManualProbeTime < MANUAL_PROBE_COOLDOWN_MS) {
    const waitSec = Math.ceil((MANUAL_PROBE_COOLDOWN_MS - (now - lastManualProbeTime)) / 1e3);
    res.status(429).json({
      error: "Probe in cooldown",
      message: `Please wait ${waitSec}s before probing Firestore again.`
    });
    return;
  }
  lastManualProbeTime = now;
  try {
    const db = getFirestoreDb();
    await db.collection(COLLECTIONS.SEASONS).limit(1).get();
    firestoreCircuitBreaker.recordSuccess();
    res.status(200).json({
      success: true,
      message: "Firestore active probe succeeded",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    res.status(503).json({
      success: false,
      error: err.message,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
});
healthRouter.get("/resilience", (req, res) => {
  const cbStatus = firestoreCircuitBreaker.getStatus();
  const queue = getQueueStats();
  res.status(200).json({
    status: "ok",
    isOffline: !firestoreCircuitBreaker.canExecute(),
    circuitBreaker: cbStatus,
    queueStats: queue,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
healthRouter.post("/sync", requireAdmin, async (req, res) => {
  try {
    const result = await processPendingMutations();
    res.status(200).json({
      success: true,
      result,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// src/server/routes/auth.routes.ts
import { Router as Router3 } from "express";
import { z } from "zod";

// src/server/middleware/validationMiddleware.ts
import { ZodError } from "zod";
function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: "Validation Error",
          details: err.issues.map((e) => ({
            field: e.path.join("."),
            message: e.message
          }))
        });
        return;
      }
      res.status(400).json({ error: "Invalid request body" });
    }
  };
}

// src/server/routes/auth.routes.ts
init_readModelStore();
var authRouter = Router3();
var telegramAuthSchema = z.object({
  initData: z.string().min(1, "initData is required")
});
var devAuthSchema = z.object({
  devUserId: z.string().min(1, "devUserId is required")
});
authRouter.post("/telegram", validateBody(telegramAuthSchema), async (req, res) => {
  const { initData } = req.body;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    if (process.env.ENABLE_DEV_AUTH === "true" || process.env.NODE_ENV !== "production") {
      try {
        const urlParams = new URLSearchParams(initData);
        const userRaw = urlParams.get("user");
        if (userRaw) {
          const user = await getOrCreateTelegramUser(JSON.parse(userRaw));
          const clubState = await getOptionalCurrentClub(user.id);
          const token = createSessionToken(user);
          console.log(`[TELEGRAM AUTH - DEV SANDBOX] user=${user.username} (id: ${user.telegramId}), isAdmin=${user.isAdmin}`);
          res.json({ success: true, user, ...clubState, token });
          return;
        }
      } catch {
      }
    }
    res.status(500).json({ error: "TELEGRAM_BOT_TOKEN is not configured on the server." });
    return;
  }
  const verifyResult = verifyTelegramWebAppData(initData, botToken);
  if (!verifyResult.isValid || !verifyResult.user) {
    console.warn(`[TELEGRAM AUTH REJECTED] error="${verifyResult.error}"`);
    res.status(401).json({ error: "Invalid Telegram WebApp authentication", details: verifyResult.error });
    return;
  }
  try {
    const user = await getOrCreateTelegramUser(verifyResult.user);
    const clubState = await getOptionalCurrentClub(user.id);
    const token = createSessionToken(user);
    console.log(`[TELEGRAM AUTH]
initData received: YES
parsed user id: ${verifyResult.user.id}
username: ${verifyResult.user.username || "(none)"}
auth_date valid: ${verifyResult.authDate ? "YES" : "NO"}
HMAC valid: YES
internal user: ${user.id}
isAdmin: ${user.isAdmin ? "YES" : "NO"}`);
    res.json({ success: true, user, ...clubState, token });
  } catch (err) {
    res.status(500).json({ error: "Authentication failed", message: err.message });
  }
});
authRouter.post("/dev", validateBody(devAuthSchema), async (req, res) => {
  const isDev = process.env.ENABLE_DEV_AUTH === "true" || process.env.NODE_ENV !== "production";
  if (!isDev) {
    res.status(403).json({ error: "Dev auth is disabled in production." });
    return;
  }
  try {
    const user = await getOrCreateDevUser(req.body.devUserId);
    const clubState = await getOptionalCurrentClub(user.id);
    const token = createSessionToken(user);
    res.json({ success: true, user, ...clubState, token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
authRouter.get("/dev-profiles", (req, res) => {
  const isDev = process.env.ENABLE_DEV_AUTH === "true" || process.env.NODE_ENV !== "production";
  if (!isDev) {
    res.status(403).json({ error: "Dev auth is disabled in production." });
    return;
  }
  res.json({ profiles: DEV_PROFILES });
});

// src/server/routes/seasons.routes.ts
init_firestoreStore();
import { Router as Router4 } from "express";

// src/server/firebase/firestoreErrorHandler.ts
function parseFirestoreError(err) {
  if (!err) {
    return {
      error: "INTERNAL_ERROR",
      code: "UNKNOWN",
      message: "An unknown error occurred.",
      httpStatus: 500
    };
  }
  if (err.errorCode === "READ_MODEL_NOT_WARMED") {
    return {
      error: "READ_MODEL_NOT_WARMED",
      code: "READ_MODEL_NOT_WARMED",
      message: "Ma\u2019lumotlar vaqtincha mavjud emas. Keyinroq qayta urinib ko\u2018ring.",
      httpStatus: 503
    };
  }
  const rawCode = err.code ?? (err.status ?? "");
  const rawMsg = err.message || String(err);
  const strCode = String(rawCode).toUpperCase();
  if (strCode === "AUTHORITATIVE_WRITE_REQUIRED") {
    return { error: strCode, code: strCode, message: "O\u2018zgarish saqlanmadi. Baza tiklangandan keyin qayta urinib ko\u2018ring.", httpStatus: 503 };
  }
  if (strCode === "MATCHDAY_LOCKED" || strCode.includes("MATCHDAY_LOCKED") || rawMsg.includes("MATCHDAY_LOCKED") || err.code === "MATCHDAY_LOCKED" || err.statusCode === 403) {
    return {
      error: "MATCHDAY_LOCKED",
      code: "MATCHDAY_LOCKED",
      message: rawMsg.replace(/^MATCHDAY_LOCKED:\s*/, ""),
      httpStatus: 403,
      details: err.details || rawMsg
    };
  }
  if (rawCode === 8 || strCode === "8" || strCode.includes("RESOURCE_EXHAUSTED") || rawMsg.includes("RESOURCE_EXHAUSTED") || rawMsg.includes("Quota exceeded") || rawMsg.includes("quota")) {
    return {
      error: "RESOURCE_EXHAUSTED",
      code: "RESOURCE_EXHAUSTED",
      message: "Firestore quota exceeded. Read operations are temporarily unavailable.",
      httpStatus: 429,
      details: err.details || rawMsg
    };
  }
  if (rawCode === 7 || strCode === "7" || strCode.includes("PERMISSION_DENIED") || rawMsg.includes("PERMISSION_DENIED") || rawMsg.includes("Missing or insufficient permissions")) {
    return {
      error: "PERMISSION_DENIED",
      code: "PERMISSION_DENIED",
      message: "Permission denied accessing Firestore database.",
      httpStatus: 403,
      details: err.details || rawMsg
    };
  }
  if (rawCode === 14 || strCode === "14" || strCode.includes("UNAVAILABLE") || rawMsg.includes("UNAVAILABLE") || rawMsg.includes("Service Unavailable")) {
    return {
      error: "UNAVAILABLE",
      code: "UNAVAILABLE",
      message: "Firestore service is temporarily unavailable. Please retry shortly.",
      httpStatus: 503,
      details: err.details || rawMsg
    };
  }
  if (rawCode === 4 || strCode === "4" || strCode.includes("DEADLINE_EXCEEDED") || rawMsg.includes("DEADLINE_EXCEEDED") || rawMsg.includes("deadline") || rawMsg.includes("timed out")) {
    return {
      error: "DEADLINE_EXCEEDED",
      code: "DEADLINE_EXCEEDED",
      message: "Firestore request timed out. Please try again.",
      httpStatus: 504,
      details: err.details || rawMsg
    };
  }
  if (rawCode === 5 || strCode === "5" || strCode.includes("NOT_FOUND") || rawMsg.includes("NOT_FOUND") || rawMsg.includes("No document to update")) {
    return {
      error: "NOT_FOUND",
      code: "NOT_FOUND",
      message: "The requested Firestore document was not found.",
      httpStatus: 404,
      details: err.details || rawMsg
    };
  }
  if (rawCode === 6 || strCode === "6" || strCode.includes("ALREADY_EXISTS") || rawMsg.includes("ALREADY_EXISTS")) {
    return {
      error: "ALREADY_EXISTS",
      code: "ALREADY_EXISTS",
      message: "The Firestore document or resource already exists.",
      httpStatus: 409,
      details: err.details || rawMsg
    };
  }
  if (rawCode === 9 || strCode === "9" || strCode.includes("FAILED_PRECONDITION") || rawMsg.includes("FAILED_PRECONDITION") || rawMsg.includes("index")) {
    return {
      error: "FAILED_PRECONDITION",
      code: "FAILED_PRECONDITION",
      message: "Firestore query requires an index or condition not met.",
      httpStatus: 400,
      details: err.details || rawMsg
    };
  }
  return {
    error: "INTERNAL_FIRESTORE_ERROR",
    code: strCode || "INTERNAL_ERROR",
    message: rawMsg || "Internal Firestore operation error.",
    httpStatus: 500,
    details: err.details
  };
}
function handleFirestoreError(res, err, context = "Firestore operation") {
  const parsed = parseFirestoreError(err);
  console.error(`[FIRESTORE ERROR] [${context}] code=${parsed.code} status=${parsed.httpStatus} message="${parsed.message}" raw="${err?.message || err}"`);
  res.status(parsed.httpStatus).json(parsed);
}

// src/server/routes/seasons.routes.ts
var seasonsRouter = Router4();
seasonsRouter.get("/", async (req, res) => {
  try {
    const seasons = await getAllSeasonsFirestore();
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json({ seasons });
  } catch (err) {
    handleFirestoreError(res, err, "GET /api/seasons");
  }
});
seasonsRouter.get("/active", async (req, res) => {
  try {
    const season = await getActiveSeasonFirestore();
    if (!season) {
      res.status(404).json({ error: "Active season not found", code: "NOT_FOUND", message: "Active season not found" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json({ season });
  } catch (err) {
    handleFirestoreError(res, err, "GET /api/seasons/active");
  }
});
seasonsRouter.get("/:id", async (req, res) => {
  try {
    const seasons = await getAllSeasonsFirestore();
    const season = seasons.find((s) => s.id === req.params.id);
    if (!season) {
      res.status(404).json({ error: "Season not found", code: "NOT_FOUND", message: `Season '${req.params.id}' not found` });
      return;
    }
    res.json({ season });
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/seasons/${req.params.id}`);
  }
});

// src/server/routes/leagues.routes.ts
init_firestoreStore();
import { Router as Router5 } from "express";

// src/server/middleware/ownershipCacheControl.ts
function setOwnershipSensitiveHeaders(res) {
  res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Vary", "Authorization, X-Session-Token, X-Telegram-Init-Data");
}

// src/server/routes/leagues.routes.ts
init_readModelStore();
var leaguesRouter = Router5();
var LEAGUE_ID_ALIASES = {
  "league-epl": "league-premier-league",
  "league-laliga": "league-la-liga",
  "league-seriea": "league-serie-a",
  "league-ligue1": "league-ligue-1"
};
function resolveLeagueId(id) {
  return LEAGUE_ID_ALIASES[id] || id;
}
leaguesRouter.get("/", async (req, res) => {
  try {
    const leagues = await getAllLeaguesFirestore();
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json({ leagues });
  } catch (err) {
    handleFirestoreError(res, err, "GET /api/leagues");
  }
});
leaguesRouter.get("/:id", async (req, res) => {
  try {
    const leagueId = resolveLeagueId(req.params.id);
    const leagues = await getAllLeaguesFirestore();
    const league = leagues.find((l) => l.id === leagueId);
    if (!league) {
      res.status(404).json({ error: "League not found", code: "NOT_FOUND", message: `League '${leagueId}' not found.` });
      return;
    }
    res.json({ league });
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/leagues/${req.params.id}`);
  }
});
leaguesRouter.get("/:id/clubs", async (req, res) => {
  setOwnershipSensitiveHeaders(res);
  const seasonId = req.query.seasonId || "season-2026-27";
  const leagueId = resolveLeagueId(req.params.id);
  const currentUserId = req.user?.id;
  try {
    const result = await getLeagueClubsFromReadModel(leagueId, seasonId, currentUserId);
    res.json({
      clubs: result.clubs,
      source: result.source,
      stale: result.stale,
      degraded: result.degraded,
      snapshotAt: result.snapshotAt
    });
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/leagues/${req.params.id}/clubs`);
  }
});

// src/server/routes/clubs.routes.ts
import { Router as Router6 } from "express";
init_firestoreStore();
init_seed();
init_readModelStore();
var clubsRouter = Router6();
function resolveCanonicalClub(id) {
  if (!id) return null;
  const trimmed = id.trim();
  const normalized = trimmed.toLowerCase();
  let found = SEED_CLUBS.find((c) => c.id === trimmed || c.id.toLowerCase() === normalized);
  if (found) return found;
  found = SEED_CLUBS.find((c) => c.id === `club-${normalized}` || c.id.toLowerCase() === `club-${normalized}`);
  if (found) return found;
  found = SEED_CLUBS.find((c) => {
    const url = c.logoUrl;
    if (url.endsWith(`/${normalized}.png`) || url.endsWith(`/${normalized}.svg`)) return true;
    if (url.endsWith(`/t${normalized}.svg`)) return true;
    const match = url.match(/\/([a-zA-Z0-9_-]+)\.(png|svg|webp|jpg)$/i);
    if (match && match[1].toLowerCase() === normalized) return true;
    return false;
  });
  if (found) return found;
  found = SEED_CLUBS.find(
    (c) => c.shortName.toLowerCase() === normalized || c.name.toLowerCase() === normalized
  );
  return found || null;
}
var imageCache = /* @__PURE__ */ new Map();
function generateFallbackSvgBadge(name, shortName) {
  const text = (shortName || name.slice(0, 3)).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#1e293b" />
        <stop offset="100%" stop-color="#0f172a" />
      </linearGradient>
    </defs>
    <path d="M50 5 L85 20 L85 55 C85 75 50 95 50 95 C50 95 15 75 15 55 L15 20 Z" fill="url(#bgGrad)" stroke="#38bdf8" stroke-width="3"/>
    <text x="50" y="58" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="900" fill="#f8fafc" text-anchor="middle" letter-spacing="1">${text}</text>
  </svg>`;
}
function wrapRasterImageInSvg(buffer, mimeType) {
  const base64Data = buffer.toString("base64");
  const cleanMime = mimeType.split(";")[0].trim() || "image/png";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" preserveAspectRatio="xMidYMid meet">
  <image href="data:${cleanMime};base64,${base64Data}" width="256" height="256" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
  return Buffer.from(svg, "utf-8");
}
async function fetchAndServeImage(imageUrl, res, fallbackName = "FC", fallbackShortName = "FC") {
  const now = Date.now();
  const cached = imageCache.get(imageUrl);
  if (cached && cached.expiry > now) {
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=2592000, immutable");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(cached.buffer);
    return;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4e3);
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      }
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      const rawContentType = response.headers.get("content-type") || "image/png";
      const arrayBuffer = await response.arrayBuffer();
      const rawBuffer = Buffer.from(arrayBuffer);
      let finalBuffer;
      let finalContentType;
      const isSvg = rawContentType.includes("svg") || imageUrl.toLowerCase().endsWith(".svg");
      if (isSvg) {
        finalBuffer = rawBuffer;
        finalContentType = "image/svg+xml; charset=utf-8";
      } else {
        finalBuffer = wrapRasterImageInSvg(rawBuffer, rawContentType);
        finalContentType = "image/svg+xml; charset=utf-8";
      }
      imageCache.set(imageUrl, {
        buffer: finalBuffer,
        contentType: finalContentType,
        expiry: now + 7 * 24 * 60 * 60 * 1e3
      });
      res.setHeader("Content-Type", finalContentType);
      res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=2592000, immutable");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(finalBuffer);
      return;
    }
  } catch (e) {
  }
  const svg = generateFallbackSvgBadge(fallbackName, fallbackShortName);
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(Buffer.from(svg, "utf-8"));
}
clubsRouter.get("/crest-proxy", async (req, res) => {
  const url = req.query.url;
  if (!url || !url.startsWith("http")) {
    res.status(400).json({ error: "Valid image URL is required" });
    return;
  }
  await fetchAndServeImage(url, res);
});
clubsRouter.get("/available", async (req, res) => {
  setOwnershipSensitiveHeaders(res);
  const seasonId = req.query.seasonId || "season-2026-27";
  const currentUserId = req.user?.id;
  try {
    const result = await getAvailableClubsFromReadModel(seasonId, currentUserId);
    res.json({
      clubs: result.clubs,
      source: result.source,
      stale: result.stale,
      degraded: result.degraded,
      snapshotAt: result.snapshotAt
    });
  } catch (err) {
    handleFirestoreError(res, err, "GET /api/clubs/available");
  }
});
clubsRouter.get("/:id/crest", async (req, res) => {
  const requestedId = req.params.id;
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const resolvedSeedClub = resolveCanonicalClub(requestedId);
    if (resolvedSeedClub?.logoUrl) {
      await fetchAndServeImage(
        resolvedSeedClub.logoUrl,
        res,
        resolvedSeedClub.name,
        resolvedSeedClub.shortName
      );
      return;
    }
    const canonicalId = resolvedSeedClub?.id || requestedId;
    let club = await getClubByIdFirestore(canonicalId, seasonId);
    if (!club && canonicalId !== requestedId) {
      club = await getClubByIdFirestore(requestedId, seasonId);
    }
    const finalLogoUrl = club?.logoUrl || resolvedSeedClub?.logoUrl;
    const finalName = club?.name || resolvedSeedClub?.name || requestedId;
    const finalShortName = club?.shortName || resolvedSeedClub?.shortName;
    if (!finalLogoUrl) {
      const svg = generateFallbackSvgBadge(finalName, finalShortName);
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(Buffer.from(svg, "utf-8"));
      return;
    }
    await fetchAndServeImage(finalLogoUrl, res, finalName, finalShortName);
  } catch (err) {
    const resolvedSeedClub = resolveCanonicalClub(requestedId);
    if (resolvedSeedClub?.logoUrl) {
      await fetchAndServeImage(resolvedSeedClub.logoUrl, res, resolvedSeedClub.name, resolvedSeedClub.shortName);
      return;
    }
    const svg = generateFallbackSvgBadge(requestedId);
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(Buffer.from(svg, "utf-8"));
  }
});
clubsRouter.get("/:id", async (req, res) => {
  setOwnershipSensitiveHeaders(res);
  const seasonId = req.query.seasonId || "season-2026-27";
  const currentUserId = req.user?.id;
  try {
    const result = await getClubByIdFromReadModel(req.params.id, seasonId, currentUserId);
    if (!result.club) {
      res.status(404).json({ error: "Club not found", code: "NOT_FOUND", message: `Club '${req.params.id}' not found.` });
      return;
    }
    res.json({
      club: result.club,
      source: result.source,
      stale: result.stale,
      degraded: result.degraded
    });
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/clubs/${req.params.id}`);
  }
});
clubsRouter.post("/:id/claim", requireAuth, async (req, res) => {
  const clubId = req.params.id;
  if (!clubId || clubId === "undefined" || clubId === "null" || !clubId.startsWith("club-")) {
    res.status(400).json({
      error: "INVALID_CLUB_ID",
      code: "INVALID_CLUB_ID",
      message: "Invalid club ID provided."
    });
    return;
  }
  const seasonId = req.body.seasonId || "season-2026-27";
  const userId = req.user.id;
  const telegramId = req.user.telegramId;
  if (telegramId) {
    const membership = await verifyTelegramGroupMembership(telegramId);
    if (!membership.isMember) {
      res.status(403).json({
        error: "TELEGRAM_GROUP_MEMBERSHIP_REQUIRED",
        code: "TELEGRAM_GROUP_MEMBERSHIP_REQUIRED",
        message: "Klub tanlash uchun avval @efleagueuz Telegram guruhiga a'zo bo'lishingiz lozim.",
        groupUsername: "@efleagueuz",
        groupUrl: "https://t.me/efleagueuz"
      });
      return;
    }
  }
  try {
    const result = await claimClubAtomicFirestore(userId, clubId, seasonId, { authoritativeOnly: true });
    await invalidateClubReadModels(seasonId).catch(() => {
    });
    await invalidateUserMembershipReadModel(userId, seasonId).catch(() => {
    });
    res.json({
      success: true,
      message: `Successfully claimed ${result.club.name}!`,
      club: result.club
    });
  } catch (err) {
    if (err instanceof ClubConflictError) {
      res.status(409).json({
        error: err.code || "CLUB_CONFLICT",
        code: err.code || "CLUB_CONFLICT",
        message: err.message
      });
      return;
    }
    if (err instanceof ClubNotFoundError) {
      res.status(404).json({
        error: "CLUB_NOT_FOUND",
        code: "CLUB_NOT_FOUND",
        message: err.message
      });
      return;
    }
    handleFirestoreError(res, err, `POST /api/clubs/${clubId}/claim`);
  }
});

// src/server/routes/competitions.routes.ts
import { Router as Router7 } from "express";
init_firestoreStore();
init_readModelStore();
var competitionsRouter = Router7();
competitionsRouter.get("/", async (req, res) => {
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const result = await getCompetitionsFromReadModel(seasonId);
    res.json({
      competitions: result.competitions,
      source: result.source,
      stale: result.stale,
      degraded: result.degraded,
      snapshotAt: result.snapshotAt
    });
  } catch (err) {
    handleFirestoreError(res, err, "GET /api/competitions");
  }
});
competitionsRouter.get("/:id", async (req, res) => {
  try {
    const competition = await getCompetitionByIdFirestore(req.params.id);
    if (!competition) {
      res.status(404).json({ error: "Competition not found", code: "NOT_FOUND", message: `Competition '${req.params.id}' not found` });
      return;
    }
    res.json({ competition });
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/competitions/${req.params.id}`);
  }
});
competitionsRouter.get("/:id/participants", async (req, res) => {
  try {
    const participants = await getCompetitionParticipantsFirestore(req.params.id);
    res.json({ participants });
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/competitions/${req.params.id}/participants`);
  }
});
competitionsRouter.get("/:id/standings", async (req, res) => {
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const result = await getCompetitionStandingsFromReadModel(req.params.id, seasonId);
    res.json({
      standings: result.standings,
      source: result.source,
      stale: result.stale,
      degraded: result.degraded,
      snapshotAt: result.snapshotAt
    });
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/competitions/${req.params.id}/standings`);
  }
});
competitionsRouter.get("/:id/fixtures", async (req, res) => {
  const matchday = req.query.matchday ? parseInt(req.query.matchday, 10) : void 0;
  const status = req.query.status;
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const result = await getCompetitionFixturesFromReadModel(req.params.id, {
      matchday,
      status,
      seasonId
    });
    res.json({
      fixtures: result.fixtures,
      source: result.source,
      stale: result.stale,
      degraded: result.degraded,
      snapshotAt: result.snapshotAt
    });
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/competitions/${req.params.id}/fixtures`);
  }
});
competitionsRouter.post("/:id/generate-fixtures", requireAdmin, async (req, res) => {
  try {
    const force = req.body?.force !== void 0 ? Boolean(req.body.force) : true;
    const result = await generateCompetitionFixturesFirestore(req.params.id, { force });
    res.json({
      success: true,
      competitionId: req.params.id,
      fixturesGenerated: result.generated,
      matchdays: result.matchdays,
      message: `Persisted ${result.generated} fixtures in Firestore successfully across ${result.matchdays} matchdays.`
    });
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/competitions/${req.params.id}/generate-fixtures`);
  }
});
competitionsRouter.post("/:id/reset-fixtures", requireAdmin, async (req, res) => {
  try {
    const result = await generateCompetitionFixturesFirestore(req.params.id, { force: true });
    res.json({
      success: true,
      competitionId: req.params.id,
      fixturesGenerated: result.generated,
      matchdays: result.matchdays,
      message: `Reset and persisted ${result.generated} fixtures in Firestore.`
    });
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/competitions/${req.params.id}/reset-fixtures`);
  }
});
competitionsRouter.post("/:id/rebuild-standings", requireAdmin, async (req, res) => {
  try {
    const standings = await rebuildCompetitionStandingsFirestore2(req.params.id);
    res.json({
      success: true,
      competitionId: req.params.id,
      standings,
      totalClubs: standings.length,
      message: `Rebuilt and persisted materialized standings for competition '${req.params.id}' successfully.`
    });
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/competitions/${req.params.id}/rebuild-standings`);
  }
});
competitionsRouter.get("/:id/locks", async (req, res) => {
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const locks = await getCompetitionMatchdayLocksFirestore(seasonId, req.params.id);
    res.json({ locks });
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/competitions/${req.params.id}/locks`);
  }
});

// src/server/routes/fixtures.routes.ts
import { Router as Router8 } from "express";
import { z as z2 } from "zod";
init_firestoreStore();
init_readModelStore();
var fixturesRouter = Router8();
var fixturesResilientRouter = fixturesRouter;
var resultSubmissionSchema = z2.object({
  homeScore: z2.number().int().min(0, "Home score must be >= 0"),
  awayScore: z2.number().int().min(0, "Away score must be >= 0"),
  proofUrl: z2.string().optional()
});
fixturesRouter.get("/:id", async (req, res) => {
  const currentUserId = req.user?.id;
  try {
    const fixture = await getFixtureByIdFirestore(req.params.id, currentUserId);
    if (!fixture) {
      res.status(404).json({ error: "Fixture not found", code: "NOT_FOUND", message: `Fixture '${req.params.id}' not found` });
      return;
    }
    res.json({ fixture });
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/fixtures/${req.params.id}`);
  }
});
fixturesRouter.post("/:id/result", requireAuth, validateBody(resultSubmissionSchema), async (req, res) => {
  const userId = req.user.id;
  const fixtureId = req.params.id;
  const { homeScore, awayScore, proofUrl } = req.body;
  try {
    const updatedFixture = await submitFixtureResultFirestore(userId, fixtureId, homeScore, awayScore, proofUrl);
    await refreshChangedFixtureReadModel(fixtureId).catch(() => invalidateFixtureReadModels(updatedFixture.competitionId, updatedFixture.seasonId || "season-2026-27")).catch(() => {
    });
    res.json({
      success: true,
      message: updatedFixture.status === "CONFIRMED" ? "Match result confirmed!" : updatedFixture.status === "DISPUTED" ? "Scores differ! Match has been marked DISPUTED and sent to admin." : "Score submitted! Awaiting opponent confirmation.",
      fixture: updatedFixture
    });
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/fixtures/${fixtureId}/result`);
  }
});

// src/server/routes/notificationsReadResilient.routes.ts
import { Router as Router9 } from "express";
init_firestoreStore();
var notificationsReadResilientRouter = Router9();
notificationsReadResilientRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});
notificationsReadResilientRouter.get("/notifications", requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const notifications = await getUserNotificationsFirestore(userId, 30);
    res.json({ notifications });
  } catch (err) {
    handleFirestoreError(res, err, "GET /api/me/notifications");
  }
});
notificationsReadResilientRouter.post("/notifications/read", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { notificationId } = req.body || {};
  try {
    if (notificationId && typeof notificationId === "string") {
      await markSingleNotificationReadFirestore(userId, notificationId);
    } else {
      await markNotificationsReadFirestore(userId);
    }
    res.json({ success: true });
  } catch (err) {
    handleFirestoreError(res, err, "POST /api/me/notifications/read");
  }
});

// src/server/routes/me.routes.ts
import { Router as Router10 } from "express";
init_firestoreStore();
init_readModelStore();
var meRouter = Router10();
var meResilientRouter = meRouter;
meRouter.use((req, res, next) => {
  setOwnershipSensitiveHeaders(res);
  next();
});
meRouter.get("/", requireAuth, async (req, res) => {
  const user = req.user;
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const clubState = await getOptionalCurrentClub(user.id, seasonId);
    const { currentClub } = clubState;
    const stats = {
      matchesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsScored: 0,
      goalsConceded: 0,
      points: 0,
      trophies: 0,
      leaguePosition: 0
    };
    if (currentClub) {
      const confirmedMatches = await getFixturesFirestore({
        clubId: currentClub.id,
        seasonId,
        status: "CONFIRMED"
      });
      for (const m of confirmedMatches) {
        const isHome = m.homeClubId === currentClub.id;
        const isAway = m.awayClubId === currentClub.id;
        if (isHome || isAway) {
          stats.matchesPlayed++;
          const myScore = isHome ? m.homeScore ?? 0 : m.awayScore ?? 0;
          const oppScore = isHome ? m.awayScore ?? 0 : m.homeScore ?? 0;
          stats.goalsScored += myScore;
          stats.goalsConceded += oppScore;
          if (myScore > oppScore) {
            stats.wins++;
            stats.points += 3;
          } else if (myScore === oppScore) {
            stats.draws++;
            stats.points += 1;
          } else {
            stats.losses++;
          }
        }
      }
    }
    res.json({
      authenticated: true,
      user,
      ...clubState,
      stats
    });
  } catch (err) {
    handleFirestoreError(res, err, "GET /api/me");
  }
});
meRouter.get("/matches", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const seasonId = req.query.seasonId || "season-2026-27";
  const status = req.query.status;
  try {
    const fixtures = await getFixturesFirestore({
      userId,
      seasonId,
      status
    });
    res.json({ fixtures });
  } catch (err) {
    handleFirestoreError(res, err, "GET /api/me/matches");
  }
});
meRouter.get("/notifications", requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const notifications = await getUserNotificationsFirestore(userId, 30);
    res.json({ notifications });
  } catch (err) {
    handleFirestoreError(res, err, "GET /api/me/notifications");
  }
});
meRouter.post("/notifications/read", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { notificationId } = req.body || {};
  try {
    if (notificationId && typeof notificationId === "string") {
      await markSingleNotificationReadFirestore(userId, notificationId);
    } else {
      await markNotificationsReadFirestore(userId);
    }
    res.json({ success: true });
  } catch (err) {
    handleFirestoreError(res, err, "POST /api/me/notifications/read");
  }
});

// src/server/routes/users.routes.ts
init_firestoreStore();
import { Router as Router11 } from "express";
var usersRouter = Router11();
usersRouter.get("/:id", async (req, res) => {
  const userId = req.params.id;
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const user = await getUserByIdFirestore(userId);
    if (!user) {
      res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
      return;
    }
    const currentClub = await getUserActiveClubFirestore(userId, seasonId);
    const stats = {
      matchesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsScored: 0,
      goalsConceded: 0,
      points: 0,
      trophies: 0,
      leaguePosition: 0
    };
    if (currentClub) {
      const confirmedMatches = await getFixturesFirestore({
        clubId: currentClub.id,
        seasonId,
        status: "CONFIRMED"
      });
      for (const m of confirmedMatches) {
        const isHome = m.homeClubId === currentClub.id;
        const isAway = m.awayClubId === currentClub.id;
        if (isHome || isAway) {
          stats.matchesPlayed++;
          const myScore = isHome ? m.homeScore ?? 0 : m.awayScore ?? 0;
          const oppScore = isHome ? m.awayScore ?? 0 : m.homeScore ?? 0;
          stats.goalsScored += myScore;
          stats.goalsConceded += oppScore;
          if (myScore > oppScore) {
            stats.wins++;
            stats.points += 3;
          } else if (myScore === oppScore) {
            stats.draws++;
            stats.points += 1;
          } else {
            stats.losses++;
          }
        }
      }
    }
    res.json({
      user: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        photoUrl: user.photoUrl,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt
      },
      currentClub,
      stats
    });
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/users/${userId}`);
  }
});

// src/server/routes/admin.routes.ts
import { Router as Router12 } from "express";
import { z as z3 } from "zod";
init_adminService();
init_firestoreStore();

// src/server/firebase/migrateSqliteToFirestore.ts
init_admin();
init_collections();
init_db();
async function migrateSqliteToFirestore() {
  const db = getFirestoreDb();
  const errors = [];
  const sqliteCounts = {
    users: queryGet("SELECT count(*) as count FROM users")?.count || 0,
    seasons: queryGet("SELECT count(*) as count FROM seasons")?.count || 0,
    leagues: queryGet("SELECT count(*) as count FROM leagues")?.count || 0,
    clubs: queryGet("SELECT count(*) as count FROM clubs")?.count || 0,
    competitions: queryGet("SELECT count(*) as count FROM competitions")?.count || 0,
    competition_participants: queryGet("SELECT count(*) as count FROM competition_participants")?.count || 0,
    club_memberships: queryGet("SELECT count(*) as count FROM club_memberships")?.count || 0,
    fixtures: queryGet("SELECT count(*) as count FROM fixtures")?.count || 0
  };
  console.log("[Migration] Starting SQLite to Firestore migration...");
  console.log("[Migration] Source SQLite counts:", JSON.stringify(sqliteCounts, null, 2));
  try {
    const seasons = queryAll("SELECT * FROM seasons");
    const batch = db.batch();
    for (const s of seasons) {
      const ref = db.collection(COLLECTIONS.SEASONS).doc(s.id);
      batch.set(ref, {
        id: s.id,
        name: s.name,
        status: s.status,
        startDate: s.start_date || null,
        endDate: s.end_date || null,
        createdAt: s.created_at || (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    await batch.commit();
  } catch (err) {
    errors.push(`Seasons migration error: ${err.message}`);
  }
  try {
    const leagues = queryAll("SELECT * FROM leagues");
    const batch = db.batch();
    for (const l of leagues) {
      const ref = db.collection(COLLECTIONS.LEAGUES).doc(l.id);
      batch.set(
        ref,
        {
          id: l.id,
          name: l.name,
          country: l.country,
          tier: l.tier,
          logo: l.logo_url,
          createdAt: l.created_at || (/* @__PURE__ */ new Date()).toISOString()
        },
        { merge: true }
      );
    }
    await batch.commit();
  } catch (err) {
    errors.push(`Leagues migration error: ${err.message}`);
  }
  try {
    const clubs = queryAll("SELECT * FROM clubs");
    const chunkSize = 400;
    for (let i = 0; i < clubs.length; i += chunkSize) {
      const chunk = clubs.slice(i, i + chunkSize);
      const batch = db.batch();
      for (const c of chunk) {
        const ref = db.collection(COLLECTIONS.CLUBS).doc(c.id);
        batch.set(
          ref,
          {
            id: c.id,
            name: c.name,
            shortName: c.short_name,
            leagueId: c.league_id,
            country: c.country,
            logo: c.logo_url,
            isActive: c.active !== void 0 ? Boolean(c.active) : c.is_active !== void 0 ? Boolean(c.is_active) : true,
            createdAt: c.created_at || (/* @__PURE__ */ new Date()).toISOString()
          },
          { merge: true }
        );
      }
      await batch.commit();
    }
  } catch (err) {
    errors.push(`Clubs migration error: ${err.message}`);
  }
  try {
    const obsoleteIds = ["comp-trophee-des-champions-2026", "comp-trophee-des-champions"];
    for (const obsId of obsoleteIds) {
      await db.collection(COLLECTIONS.COMPETITIONS).doc(obsId).delete().catch(() => {
      });
    }
    const competitions = queryAll("SELECT * FROM competitions");
    const batch = db.batch();
    for (const comp of competitions) {
      const ref = db.collection(COLLECTIONS.COMPETITIONS).doc(comp.id);
      batch.set(ref, {
        id: comp.id,
        seasonId: comp.season_id,
        leagueId: comp.league_id || null,
        name: comp.name,
        type: comp.type,
        scheduleMode: comp.schedule_mode,
        status: comp.status,
        formatConfig: comp.format_config_json ? JSON.parse(comp.format_config_json) : {},
        createdAt: comp.created_at || (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    await batch.commit();
  } catch (err) {
    errors.push(`Competitions migration error: ${err.message}`);
  }
  try {
    const participants = queryAll("SELECT * FROM competition_participants");
    const chunkSize = 400;
    for (let i = 0; i < participants.length; i += chunkSize) {
      const chunk = participants.slice(i, i + chunkSize);
      const batch = db.batch();
      for (const p of chunk) {
        const ref = db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(p.id);
        batch.set(ref, {
          id: p.id,
          competitionId: p.competition_id,
          clubId: p.club_id,
          seasonId: p.season_id,
          ownerUserId: p.owner_user_id || null,
          ownerUsername: p.owner_username || null,
          sourceCompetitionId: p.source_competition_id || null,
          sourceCompetitionName: p.source_competition_name || null,
          sourcePosition: p.source_position || null,
          qualificationReason: p.qualification_reason || null,
          qualificationTimestamp: p.qualification_timestamp || null,
          seedNumber: p.seed_number || null,
          createdAt: p.created_at || (/* @__PURE__ */ new Date()).toISOString()
        });
      }
      await batch.commit();
    }
  } catch (err) {
    errors.push(`Competition participants migration error: ${err.message}`);
  }
  try {
    const memberships = queryAll("SELECT * FROM club_memberships");
    const batch = db.batch();
    for (const m of memberships) {
      const ref = db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(m.id);
      batch.set(ref, {
        id: m.id,
        seasonId: m.season_id,
        clubId: m.club_id,
        userId: m.user_id,
        status: m.status,
        claimedAt: m.claimed_at,
        updatedAt: m.updated_at || m.claimed_at
      });
      if (m.status === "active") {
        const userMemRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${m.season_id}_${m.user_id}`);
        const clubOccRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${m.season_id}_${m.club_id}`);
        batch.set(userMemRef, { userId: m.user_id, clubId: m.club_id, seasonId: m.season_id, status: "active" });
        batch.set(clubOccRef, { clubId: m.club_id, userId: m.user_id, seasonId: m.season_id, status: "active" });
      }
    }
    await batch.commit();
  } catch (err) {
    errors.push(`Memberships migration error: ${err.message}`);
  }
  try {
    const fixtures = queryAll("SELECT * FROM fixtures");
    const chunkSize = 400;
    for (let i = 0; i < fixtures.length; i += chunkSize) {
      const chunk = fixtures.slice(i, i + chunkSize);
      const batch = db.batch();
      for (const f of chunk) {
        const ref = db.collection(COLLECTIONS.FIXTURES).doc(f.id);
        batch.set(ref, {
          id: f.id,
          competitionId: f.competition_id,
          seasonId: f.season_id,
          matchday: f.matchday,
          roundName: f.round_name,
          homeClubId: f.home_club_id,
          awayClubId: f.away_club_id,
          scheduledAt: f.scheduled_at,
          status: f.status,
          homeScore: f.home_score !== null ? f.home_score : null,
          awayScore: f.away_score !== null ? f.away_score : null,
          winnerClubId: f.winner_club_id || null,
          resultConfirmedAt: f.result_confirmed_at || null,
          createdAt: f.created_at || (/* @__PURE__ */ new Date()).toISOString(),
          updatedAt: f.updated_at || (/* @__PURE__ */ new Date()).toISOString()
        });
      }
      await batch.commit();
    }
  } catch (err) {
    errors.push(`Fixtures migration error: ${err.message}`);
  }
  const [seasonsSnap, leaguesSnap, clubsSnap, compSnap, partSnap, memSnap, fixSnap] = await Promise.all([
    db.collection(COLLECTIONS.SEASONS).get(),
    db.collection(COLLECTIONS.LEAGUES).get(),
    db.collection(COLLECTIONS.CLUBS).get(),
    db.collection(COLLECTIONS.COMPETITIONS).get(),
    db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).get(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).get(),
    db.collection(COLLECTIONS.FIXTURES).get()
  ]);
  const firestoreCounts = {
    seasons: seasonsSnap.size,
    leagues: leaguesSnap.size,
    clubs: clubsSnap.size,
    competitions: compSnap.size,
    competition_participants: partSnap.size,
    club_memberships: memSnap.size,
    fixtures: fixSnap.size
  };
  console.log("[Migration] Target Firestore counts:", JSON.stringify(firestoreCounts, null, 2));
  const success = errors.length === 0 && firestoreCounts.clubs >= sqliteCounts.clubs && firestoreCounts.leagues >= sqliteCounts.leagues && firestoreCounts.competitions >= sqliteCounts.competitions;
  return {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    source: "sqlite",
    target: "firestore",
    sqliteCounts,
    firestoreCounts,
    success,
    errors
  };
}

// src/server/routes/admin.routes.ts
init_mutationQueue();
init_knockoutEngine();
init_qualificationEngine();
init_domesticCupService();
init_admin();
init_collections();
init_circuitBreaker();
init_db();
init_readModelStore();
var adminRouter = Router12();
adminRouter.use(requireAdmin);
function getFallbackAdminOverview(seasonId) {
  const status = getFirebaseStatus();
  const occRow = queryGet("SELECT COUNT(*) as count FROM club_memberships WHERE season_id = ? AND status = 'active'", [seasonId]);
  const userRow = queryGet("SELECT COUNT(*) as count FROM users", []);
  const disputeRow = queryGet("SELECT COUNT(*) as count FROM disputes WHERE status = 'OPEN'", []);
  const pendingRow = queryGet("SELECT COUNT(*) as count FROM fixtures WHERE status = 'PENDING_CONFIRMATION'", []);
  const auditRow = queryGet("SELECT COUNT(*) as count FROM audit_logs", []);
  const compRows = queryAll("SELECT * FROM competitions WHERE season_id = ?", [seasonId]);
  const activeOccupancies = occRow?.count ?? 0;
  const registeredUsers = userRow?.count ?? 0;
  const openDisputes = disputeRow?.count ?? 0;
  const pendingCount = pendingRow?.count ?? 0;
  const auditLogsCount = auditRow?.count ?? 0;
  const domesticCups = compRows.filter((c) => c.type === "cup");
  const europeanComps = compRows.filter(
    (c) => c.type === "champions_league" || c.type === "europa_league" || c.type === "conference_league"
  );
  const disputes = getLocalDisputes("OPEN", 10);
  const pendingData = getLocalPendingResults(seasonId, 5);
  return {
    season: {
      id: seasonId,
      name: "2026/27 Season",
      status: "ACTIVE"
    },
    counts: {
      totalClubs: 96,
      occupiedClubs: activeOccupancies,
      availableClubs: Math.max(0, 96 - activeOccupancies),
      domesticLeaguesCount: 5,
      domesticCupsCount: domesticCups.length,
      europeanCompetitionsCount: europeanComps.length,
      totalCompetitions: compRows.length || 8,
      totalUsers: registeredUsers,
      registeredUsers,
      activeOccupancies,
      openDisputes,
      pendingResultConfirmations: pendingCount,
      recentAuditLogs: auditLogsCount
    },
    systemHealth: {
      projectId: status.projectId,
      databaseId: status.databaseId,
      connected: false,
      authMode: status.authMode,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    },
    openDisputes: disputes.slice(0, 10),
    pendingFixturesPreview: pendingData.pendingFixtures.slice(0, 5),
    source: "sqlite",
    degraded: true,
    stale: true,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
adminRouter.get("/overview", async (req, res) => {
  const seasonId = req.query.seasonId || "season-2026-27";
  recordEndpointCall("/api/admin/overview", "ADMIN", 1);
  const cacheKey = `firestore:admin_overview:${seasonId}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  if (!firestoreCircuitBreaker.canExecute()) {
    const fallback = getFallbackAdminOverview(seasonId);
    setInCache(cacheKey, fallback, 6e4);
    res.json(fallback);
    return;
  }
  try {
    const status = getFirebaseStatus();
    const db = getFirestoreDb();
    const [usersCountSnap, occCountSnap, competitions, disputes, auditLogs, pendingData] = await Promise.all([
      db.collection(COLLECTIONS.USERS).count().get().catch(() => null),
      db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where("seasonId", "==", seasonId).where("status", "==", "active").count().get().catch(() => null),
      getAllCompetitionsFirestore(seasonId).catch(() => []),
      getDisputes("OPEN").catch(() => []),
      getAuditLogs(10).catch(() => []),
      getPendingResultsFirestore(seasonId).catch(() => ({ pendingFixtures: [], total: 0 }))
    ]);
    const registeredUsers = usersCountSnap?.data().count ?? 0;
    const activeOccupancies = occCountSnap?.data().count ?? 0;
    const domesticLeagues = competitions.filter((c) => String(c.type) === "LEAGUE" || String(c.type) === "league");
    const domesticCups = competitions.filter((c) => String(c.type) === "DOMESTIC_CUP" || String(c.type) === "cup");
    const europeanComps = competitions.filter(
      (c) => ["EUROPEAN_LEAGUE_PHASE", "champions_league", "europa_league", "conference_league"].includes(String(c.type))
    );
    const payload = {
      season: {
        id: seasonId,
        name: "2026/27 Season",
        status: "ACTIVE"
      },
      counts: {
        totalClubs: 96,
        occupiedClubs: activeOccupancies,
        availableClubs: Math.max(0, 96 - activeOccupancies),
        domesticLeaguesCount: 5,
        domesticCupsCount: domesticCups.length,
        europeanCompetitionsCount: europeanComps.length,
        totalCompetitions: competitions.length,
        totalUsers: registeredUsers,
        registeredUsers,
        activeOccupancies,
        openDisputes: disputes.length,
        pendingResultConfirmations: pendingData.total,
        recentAuditLogs: auditLogs.length
      },
      systemHealth: {
        projectId: status.projectId,
        databaseId: status.databaseId,
        connected: true,
        authMode: status.authMode,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      },
      openDisputes: disputes.slice(0, 10),
      pendingFixturesPreview: pendingData.pendingFixtures.slice(0, 5),
      source: "firestore",
      degraded: false,
      stale: false,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    setInCache(cacheKey, payload, 6e4);
    res.json(payload);
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    const fallback = getFallbackAdminOverview(seasonId);
    setInCache(cacheKey, fallback, 6e4);
    res.status(200).json(fallback);
  }
});
adminRouter.get("/clubs", async (req, res) => {
  setOwnershipSensitiveHeaders(res);
  const seasonId = req.query.seasonId || "season-2026-27";
  const leagueId = req.query.leagueId;
  try {
    const result = await getAdminClubsFromReadModel(seasonId, leagueId);
    res.json({
      clubs: result.clubs,
      total: result.total,
      source: result.source,
      degraded: result.degraded,
      stale: result.stale,
      generatedAt: result.snapshotAt
    });
  } catch (err) {
    console.error("[ADMIN_CLUBS_ERROR]", err);
    res.status(503).json({
      errorCode: "READ_MODEL_ERROR",
      message: err.message || "Failed to retrieve admin clubs read model",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
});
adminRouter.get("/fixtures", async (req, res) => {
  setOwnershipSensitiveHeaders(res);
  const seasonId = req.query.seasonId || "season-2026-27";
  const competitionId = req.query.competitionId;
  const status = req.query.status;
  const matchday = req.query.matchday ? parseInt(req.query.matchday, 10) : void 0;
  const clubId = req.query.clubId;
  const userId = req.query.userId;
  const search = req.query.search?.trim().toLowerCase();
  const cursor = req.query.cursor || void 0;
  const limit = req.query.limit !== void 0 ? Math.min(Math.max(parseInt(req.query.limit, 10), 1), 100) : 25;
  const page = req.query.page ? Math.max(1, parseInt(req.query.page, 10)) : 1;
  try {
    const result = await getAdminFixturesPagedFirestore({
      seasonId,
      competitionId: competitionId === "ALL" ? void 0 : competitionId,
      status: status === "ALL" ? void 0 : status,
      matchday: matchday || void 0,
      clubId: clubId || void 0,
      userId: userId || void 0,
      search,
      cursor,
      limit
    });
    res.json({
      fixtures: result.fixtures,
      total: result.total,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      page,
      totalPages: Math.ceil(result.total / limit) || 1,
      limit,
      source: result.source,
      degraded: result.degraded,
      stale: result.stale,
      errorCode: result.errorCode,
      generatedAt: result.generatedAt
    });
  } catch (err) {
    if (err instanceof ReadModelNotWarmedError || err?.errorCode === "READ_MODEL_NOT_WARMED") {
      res.status(503).json({
        errorCode: "READ_MODEL_NOT_WARMED",
        message: "Read model is not warmed and authoritative database is unreachable.",
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      return;
    }
    console.error("[ADMIN_FIXTURES_FAILED]", {
      message: err?.message,
      code: err?.code,
      seasonId,
      competitionId,
      status,
      matchday
    });
    res.status(503).json({
      errorCode: "READ_MODEL_ERROR",
      message: err.message || "Failed to retrieve admin fixtures read model",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
});
var adminEditResultSchema = z3.object({
  homeScore: z3.number().int().min(0, "Home score must be >= 0"),
  awayScore: z3.number().int().min(0, "Away score must be >= 0"),
  status: z3.enum(["CONFIRMED", "AWAITING_RESULT", "SCHEDULED"]).optional(),
  notes: z3.string().optional()
});
adminRouter.post("/fixtures/:id/result", validateBody(adminEditResultSchema), async (req, res) => {
  const adminUserId = req.user.id;
  const adminUsername = req.user.username || "admin";
  const fixtureId = req.params.id;
  try {
    const result = await editFixtureResult(adminUserId, adminUsername, fixtureId, req.body);
    res.json(result);
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/fixtures/${fixtureId}/result`);
  }
});
var adminDeleteResultSchema = z3.object({
  deleteSubmissions: z3.boolean().optional(),
  notes: z3.string().optional()
});
adminRouter.post("/fixtures/:id/delete-result", validateBody(adminDeleteResultSchema), async (req, res) => {
  const adminUserId = req.user.id;
  const adminUsername = req.user.username || "admin";
  const fixtureId = req.params.id;
  try {
    const result = await deleteFixtureResult(adminUserId, adminUsername, fixtureId, req.body);
    res.json(result);
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/fixtures/${fixtureId}/delete-result`);
  }
});
var adminDeleteFixtureSchema = z3.object({
  reason: z3.string().min(3, "Reason must be at least 3 characters")
});
adminRouter.delete("/fixtures/:id", validateBody(adminDeleteFixtureSchema), async (req, res) => {
  const adminUserId = req.user.id;
  const adminUsername = req.user.username || "admin";
  const fixtureId = req.params.id;
  try {
    const result = await deleteFixture(adminUserId, adminUsername, fixtureId, req.body.reason);
    res.json(result);
  } catch (err) {
    handleFirestoreError(res, err, `DELETE /api/admin/fixtures/${fixtureId}`);
  }
});
adminRouter.get("/submissions", async (req, res) => {
  const fixtureId = req.query.fixtureId;
  const userId = req.query.userId;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
  try {
    const submissions = await getResultSubmissions({ fixtureId, userId, limit });
    res.json({ submissions, total: submissions.length, source: "firestore", degraded: false, stale: false });
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    const submissions = getLocalSubmissions({ fixtureId, userId, limit });
    res.json({ submissions, total: submissions.length, source: "sqlite", degraded: true, stale: true });
  }
});
adminRouter.delete("/submissions/:id", async (req, res) => {
  const adminUserId = req.user.id;
  const adminUsername = req.user.username || "admin";
  const submissionId = req.params.id;
  const notes = req.body?.notes;
  try {
    const result = await deleteResultSubmission(adminUserId, adminUsername, submissionId, notes);
    res.json(result);
  } catch (err) {
    handleFirestoreError(res, err, `DELETE /api/admin/submissions/${submissionId}`);
  }
});
adminRouter.get("/users/:id/detail", async (req, res) => {
  const targetUserId = req.params.id;
  try {
    const detail = await getUserDetail(targetUserId);
    res.json({ ...detail, source: "firestore", degraded: false, stale: false });
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    const localUser = queryGet("SELECT * FROM users WHERE id = ?", [targetUserId]);
    if (!localUser) {
      res.status(404).json({ error: `User '${targetUserId}' not found.` });
      return;
    }
    const memberships = queryAll("SELECT * FROM club_memberships WHERE user_id = ?", [targetUserId]);
    const submissions = getLocalSubmissions({ userId: targetUserId, limit: 30 });
    res.json({
      user: {
        id: localUser.id,
        telegramId: localUser.telegram_id,
        username: localUser.username,
        firstName: localUser.first_name,
        lastName: localUser.last_name || "",
        photoUrl: localUser.photo_url || "",
        isAdmin: Boolean(localUser.is_admin),
        isSuspended: Boolean(localUser.is_suspended),
        createdAt: localUser.created_at,
        updatedAt: localUser.updated_at
      },
      activeClub: null,
      memberships,
      submissionsCount: submissions.length,
      recentSubmissions: submissions,
      auditLogs: [],
      notificationsCount: 0,
      source: "sqlite",
      degraded: true,
      stale: true
    });
  }
});
var adminSetRoleSchema = z3.object({
  isAdmin: z3.boolean()
});
adminRouter.post("/users/:id/role", validateBody(adminSetRoleSchema), async (req, res) => {
  const adminUserId = req.user.id;
  const adminUsername = req.user.username || "admin";
  const targetUserId = req.params.id;
  try {
    const result = await setUserAdminRole(adminUserId, adminUsername, targetUserId, req.body.isAdmin);
    res.json(result);
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/users/${targetUserId}/role`);
  }
});
var adminSetSuspensionSchema = z3.object({
  isSuspended: z3.boolean(),
  reason: z3.string().optional()
});
adminRouter.post("/users/:id/suspend", validateBody(adminSetSuspensionSchema), async (req, res) => {
  const adminUserId = req.user.id;
  const adminUsername = req.user.username || "admin";
  const targetUserId = req.params.id;
  try {
    const result = await setUserSuspension(adminUserId, adminUsername, targetUserId, req.body.isSuspended, req.body.reason);
    res.json(result);
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/users/${targetUserId}/suspend`);
  }
});
var adminDeleteUserSchema = z3.object({
  reason: z3.string().optional()
});
adminRouter.delete("/users/:id", validateBody(adminDeleteUserSchema), async (req, res) => {
  const adminUserId = req.user.id;
  const adminUsername = req.user.username || "admin";
  const targetUserId = req.params.id;
  try {
    const result = await deleteUser(adminUserId, adminUsername, targetUserId, req.body.reason);
    res.json(result);
  } catch (err) {
    handleFirestoreError(res, err, `DELETE /api/admin/users/${targetUserId}`);
  }
});
adminRouter.get("/read-metrics", (req, res) => {
  res.json({
    metrics: getReadMetrics(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
adminRouter.get("/firestore-diagnostics", async (req, res) => {
  const isRefresh = req.query.refresh === "true";
  const cacheKey = "firestore:admin_diagnostics";
  const cached = getFromCache(cacheKey);
  if (!isRefresh && cached) {
    res.json(cached);
    return;
  }
  if (!firestoreCircuitBreaker.canExecute()) {
    const usersCount = queryGet("SELECT COUNT(*) as count FROM users")?.count || 0;
    const clubsCount = queryGet("SELECT COUNT(*) as count FROM clubs")?.count || 96;
    const occCount = queryGet("SELECT COUNT(*) as count FROM club_memberships WHERE status = 'active'")?.count || 0;
    const fixCount = queryGet("SELECT COUNT(*) as count FROM fixtures")?.count || 0;
    const compCount = queryGet("SELECT COUNT(*) as count FROM competitions")?.count || 0;
    const fallbackResult = {
      projectId: "sqlite-fallback",
      databaseId: "(default)",
      connected: false,
      authMode: "LOCAL_SQLITE",
      readMetrics: getReadMetrics(),
      source: "sqlite",
      degraded: true,
      stale: true,
      collections: {
        users: usersCount,
        clubs: clubsCount,
        club_occupancies: occCount,
        user_memberships: occCount,
        fixtures: fixCount,
        competitions: compCount
      }
    };
    res.json(fallbackResult);
    return;
  }
  try {
    const status = getFirebaseStatus();
    const db = getFirestoreDb();
    const [usersCount, clubsCount, occCount, memCount, fixCount, compCount] = await Promise.all([
      db.collection(COLLECTIONS.USERS).count().get().catch(() => null),
      db.collection(COLLECTIONS.CLUBS).count().get().catch(() => null),
      db.collection(COLLECTIONS.CLUB_OCCUPANCIES).count().get().catch(() => null),
      db.collection(COLLECTIONS.USER_MEMBERSHIPS).count().get().catch(() => null),
      db.collection(COLLECTIONS.FIXTURES).count().get().catch(() => null),
      db.collection(COLLECTIONS.COMPETITIONS).count().get().catch(() => null)
    ]);
    const result = {
      projectId: status.projectId,
      databaseId: status.databaseId,
      connected: true,
      authMode: status.authMode,
      readMetrics: getReadMetrics(),
      source: "firestore",
      degraded: false,
      stale: false,
      collections: {
        users: usersCount?.data().count ?? 0,
        clubs: clubsCount?.data().count ?? 96,
        club_occupancies: occCount?.data().count ?? 0,
        user_memberships: memCount?.data().count ?? 0,
        fixtures: fixCount?.data().count ?? 0,
        competitions: compCount?.data().count ?? 0
      }
    };
    setInCache(cacheKey, result, 6e5);
    res.json(result);
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    const usersCount = queryGet("SELECT COUNT(*) as count FROM users")?.count || 0;
    const clubsCount = queryGet("SELECT COUNT(*) as count FROM clubs")?.count || 96;
    const occCount = queryGet("SELECT COUNT(*) as count FROM club_memberships WHERE status = 'active'")?.count || 0;
    const fixCount = queryGet("SELECT COUNT(*) as count FROM fixtures")?.count || 0;
    const compCount = queryGet("SELECT COUNT(*) as count FROM competitions")?.count || 0;
    res.status(200).json({
      projectId: "sqlite-fallback",
      databaseId: "(default)",
      connected: false,
      authMode: "LOCAL_SQLITE",
      readMetrics: getReadMetrics(),
      source: "sqlite",
      degraded: true,
      stale: true,
      collections: {
        users: usersCount,
        clubs: clubsCount,
        club_occupancies: occCount,
        user_memberships: occCount,
        fixtures: fixCount,
        competitions: compCount
      }
    });
  }
});
var resolveDisputeSchema = z3.object({
  action: z3.enum(["CONFIRM_HOME_SUBMISSION", "CONFIRM_AWAY_SUBMISSION", "MANUAL_SCORE", "CANCEL_MATCH"]),
  manualHomeScore: z3.number().int().min(0).optional(),
  manualAwayScore: z3.number().int().min(0).optional(),
  notes: z3.string().optional()
});
var reopenFixtureSchema = z3.object({
  notes: z3.string().optional()
});
adminRouter.post("/migrate-to-firestore", async (req, res) => {
  try {
    const report = await migrateSqliteToFirestore();
    res.json({
      success: report.success,
      message: report.success ? "Successfully migrated SQLite seed to Firestore." : "Migration completed with some warnings or errors.",
      report
    });
  } catch (err) {
    handleFirestoreError(res, err, "POST /api/admin/migrate-to-firestore");
  }
});
adminRouter.get("/users", async (req, res) => {
  if (!firestoreCircuitBreaker.canExecute()) {
    const rows = queryAll("SELECT * FROM users ORDER BY created_at DESC");
    res.json({
      users: rows.map((r) => ({
        id: r.id,
        telegramId: r.telegram_id,
        username: r.username,
        firstName: r.first_name,
        lastName: r.last_name || "",
        photoUrl: r.photo_url || "",
        isAdmin: Boolean(r.is_admin),
        isSuspended: Boolean(r.is_suspended),
        createdAt: r.created_at,
        updatedAt: r.updated_at
      })),
      source: "sqlite",
      degraded: true,
      stale: true
    });
    return;
  }
  try {
    const users = await getAllAdminUsers();
    res.json({ users, source: "firestore", degraded: false, stale: false });
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    const rows = queryAll("SELECT * FROM users ORDER BY created_at DESC");
    res.json({
      users: rows.map((r) => ({
        id: r.id,
        telegramId: r.telegram_id,
        username: r.username,
        firstName: r.first_name,
        lastName: r.last_name || "",
        photoUrl: r.photo_url || "",
        isAdmin: Boolean(r.is_admin),
        isSuspended: Boolean(r.is_suspended),
        createdAt: r.created_at,
        updatedAt: r.updated_at
      })),
      source: "sqlite",
      degraded: true,
      stale: true
    });
  }
});
adminRouter.get("/disputes", async (req, res) => {
  const status = req.query.status || "OPEN";
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
  if (!firestoreCircuitBreaker.canExecute()) {
    const disputes = getLocalDisputes(status, limit);
    res.json({ disputes, source: "sqlite", degraded: true, stale: true });
    return;
  }
  try {
    const disputes = await getDisputes(status);
    res.json({ disputes, source: "firestore", degraded: false, stale: false });
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    const disputes = getLocalDisputes(status, limit);
    res.json({ disputes, source: "sqlite", degraded: true, stale: true });
  }
});
adminRouter.post("/disputes/:id/resolve", validateBody(resolveDisputeSchema), async (req, res) => {
  const adminUserId = req.user.id;
  const disputeId = req.params.id;
  try {
    const result = await resolveDisputeFirestore(adminUserId, disputeId, req.body);
    res.json({
      success: true,
      message: "Dispute resolved successfully.",
      dispute: result.dispute
    });
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/disputes/${disputeId}/resolve`);
  }
});
adminRouter.post("/fixtures/:id/reopen", validateBody(reopenFixtureSchema), async (req, res) => {
  const adminUserId = req.user.id;
  const fixtureId = req.params.id;
  try {
    const result = await reopenFixtureFirestore(adminUserId, fixtureId, req.body.notes);
    res.json({
      success: true,
      message: "Fixture has been reopened for submissions.",
      result
    });
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/fixtures/${fixtureId}/reopen`);
  }
});
adminRouter.get("/audit-logs", async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
  if (!firestoreCircuitBreaker.canExecute()) {
    const rows = queryAll("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?", [limit]);
    res.json({
      logs: rows.map((r) => ({
        id: r.id,
        actorUserId: r.actor_user_id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        oldValue: r.old_value ? JSON.parse(r.old_value) : null,
        newValue: r.new_value ? JSON.parse(r.new_value) : null,
        ipAddress: r.ip_address,
        actorUsername: r.actor_username,
        notes: r.notes,
        createdAt: r.created_at
      })),
      source: "sqlite",
      degraded: true,
      stale: true
    });
    return;
  }
  try {
    const logs = await getAuditLogs(limit);
    res.json({ logs, source: "firestore", degraded: false, stale: false });
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    const rows = queryAll("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?", [limit]);
    res.json({
      logs: rows.map((r) => ({
        id: r.id,
        actorUserId: r.actor_user_id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        oldValue: r.old_value ? JSON.parse(r.old_value) : null,
        newValue: r.new_value ? JSON.parse(r.new_value) : null,
        ipAddress: r.ip_address,
        actorUsername: r.actor_username,
        notes: r.notes,
        createdAt: r.created_at
      })),
      source: "sqlite",
      degraded: true,
      stale: true
    });
  }
});
adminRouter.post("/fixtures/generate", async (req, res) => {
  const { competitionId, force } = req.body;
  if (!competitionId) {
    res.status(400).json({ error: "competitionId is required", code: "BAD_REQUEST", message: "competitionId is required" });
    return;
  }
  try {
    const result = await generateCompetitionFixturesFirestore(competitionId, { force: Boolean(force) });
    res.json({
      success: true,
      competitionId,
      fixturesGenerated: result.generated,
      matchdays: result.matchdays,
      message: `Generated and persisted ${result.generated} fixtures in Firestore across ${result.matchdays} matchdays.`
    });
  } catch (err) {
    handleFirestoreError(res, err, "POST /api/admin/fixtures/generate");
  }
});
adminRouter.post("/knockouts/generate", async (req, res) => {
  const { competitionId } = req.body;
  if (!competitionId) {
    res.status(400).json({ error: "competitionId is required", code: "BAD_REQUEST", message: "competitionId is required" });
    return;
  }
  try {
    const result = await generateKnockoutBracket(competitionId);
    res.json({
      success: true,
      message: `Generated ${result.generated} knockout matches across ${result.rounds} rounds.`,
      result
    });
  } catch (err) {
    handleFirestoreError(res, err, "POST /api/admin/knockouts/generate");
  }
});
adminRouter.post("/qualifications/evaluate", async (req, res) => {
  const seasonId = req.body.seasonId || "season-2026-27";
  try {
    const result = await evaluateSeasonQualifications(seasonId);
    res.json({
      success: true,
      message: `Evaluated European qualifications: ${result.qualifications.length} spots assigned, ${result.participantsAdded} participants registered.`,
      result
    });
  } catch (err) {
    handleFirestoreError(res, err, "POST /api/admin/qualifications/evaluate");
  }
});
adminRouter.post("/fixtures/reset", async (req, res) => {
  const { competitionId } = req.body;
  if (!competitionId) {
    res.status(400).json({ error: "competitionId is required", code: "BAD_REQUEST", message: "competitionId is required" });
    return;
  }
  try {
    const result = await generateCompetitionFixturesFirestore(competitionId, { force: true });
    res.json({
      success: true,
      competitionId,
      fixturesGenerated: result.generated,
      matchdays: result.matchdays,
      message: `Reset and regenerated schedule for competition '${competitionId}'.`
    });
  } catch (err) {
    handleFirestoreError(res, err, "POST /api/admin/fixtures/reset");
  }
});
adminRouter.post("/competitions/:id/rebuild-standings", async (req, res) => {
  const competitionId = req.params.id;
  try {
    const standings = await rebuildCompetitionStandingsFirestore2(competitionId);
    res.json({
      success: true,
      competitionId,
      standings,
      totalClubs: standings.length,
      message: `Rebuilt and persisted materialized standings for competition '${competitionId}'.`
    });
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/competitions/${competitionId}/rebuild-standings`);
  }
});
adminRouter.post("/clubs/:id/release", async (req, res) => {
  const adminUserId = req.user.id;
  const clubId = req.params.id;
  const seasonId = req.body.seasonId || "season-2026-27";
  try {
    const result = await adminReleaseClubFirestore(adminUserId, clubId, seasonId);
    await invalidateClubReadModels(seasonId).catch(() => {
    });
    res.json(result);
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/clubs/${clubId}/release`);
  }
});
adminRouter.post("/clubs/:id/assign", async (req, res) => {
  const adminUserId = req.user.id;
  const clubId = req.params.id;
  const { targetUserId, seasonId = "season-2026-27" } = req.body;
  if (!targetUserId) {
    res.status(400).json({ error: "targetUserId is required", code: "BAD_REQUEST", message: "targetUserId is required" });
    return;
  }
  try {
    const result = await adminAssignClubFirestore(adminUserId, clubId, targetUserId, seasonId);
    await invalidateClubReadModels(seasonId).catch(() => {
    });
    await invalidateUserMembershipReadModel(targetUserId, seasonId).catch(() => {
    });
    res.json(result);
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/clubs/${clubId}/assign`);
  }
});
adminRouter.get("/results/pending", async (req, res) => {
  const seasonId = req.query.seasonId || "season-2026-27";
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
  if (!firestoreCircuitBreaker.canExecute()) {
    const result = getLocalPendingResults(seasonId, limit);
    res.json({ ...result, source: "sqlite", degraded: true, stale: true });
    return;
  }
  try {
    const result = await getPendingResultsFirestore(seasonId);
    res.json({ ...result, source: "firestore", degraded: false, stale: false });
  } catch (err) {
    firestoreCircuitBreaker.recordFailure(err);
    const result = getLocalPendingResults(seasonId, limit);
    res.json({ ...result, source: "sqlite", degraded: true, stale: true });
  }
});
var approveResultSchema = z3.object({
  homeScore: z3.number().int().min(0),
  awayScore: z3.number().int().min(0),
  notes: z3.string().optional()
});
adminRouter.post("/results/:fixtureId/approve", validateBody(approveResultSchema), async (req, res) => {
  const adminUserId = req.user.id;
  const fixtureId = req.params.fixtureId;
  const { homeScore, awayScore, notes } = req.body;
  try {
    const result = await adminApproveFixtureResultFirestore(adminUserId, fixtureId, homeScore, awayScore, notes);
    const compId = result?.fixture?.competitionId || "";
    await refreshChangedFixtureReadModel(fixtureId).catch(() => invalidateFixtureReadModels(compId, "season-2026-27")).catch(() => {
    });
    res.json(result);
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/results/${fixtureId}/approve`);
  }
});
adminRouter.post("/results/:fixtureId/reject", validateBody(reopenFixtureSchema), async (req, res) => {
  const adminUserId = req.user.id;
  const fixtureId = req.params.fixtureId;
  const { notes } = req.body;
  try {
    const result = await reopenFixtureFirestore(adminUserId, fixtureId, notes || "Rejected by tournament administrator");
    await refreshChangedFixtureReadModel(fixtureId).catch(() => invalidateFixtureReadModels("", "season-2026-27")).catch(() => {
    });
    res.json({
      success: true,
      message: "Pending result rejected and match reopened for re-submission.",
      result
    });
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/results/${fixtureId}/reject`);
  }
});
adminRouter.post("/competitions/:id/matchday/override", async (req, res) => {
  const competitionId = req.params.id;
  const { overrideStatus, matchday, durationHours, seasonId } = req.body;
  if (!overrideStatus || !["AUTO", "FORCE_OPEN", "FORCE_LOCKED", "PAUSED"].includes(overrideStatus)) {
    res.status(400).json({ error: "Valid overrideStatus is required (AUTO, FORCE_OPEN, FORCE_LOCKED, PAUSED)", code: "BAD_REQUEST" });
    return;
  }
  try {
    const result = await setCompetitionMatchdayOverrideFirestore(competitionId, overrideStatus, {
      matchday: typeof matchday === "number" ? matchday : void 0,
      durationHours: typeof durationHours === "number" ? durationHours : void 0,
      seasonId: typeof seasonId === "string" ? seasonId : void 0,
      adminUserId: req.user?.id
    });
    res.json(result);
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/competitions/${competitionId}/matchday/override`);
  }
});
adminRouter.post("/competitions/:id/matchday/advance", async (req, res) => {
  const competitionId = req.params.id;
  const { durationHours } = req.body;
  try {
    const result = await advanceCompetitionMatchdayFirestore(competitionId, { durationHours });
    res.json(result);
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/competitions/${competitionId}/matchday/advance`);
  }
});
adminRouter.post("/competitions/:id/matchday/open-now", async (req, res) => {
  const competitionId = req.params.id;
  const { durationHours = 30, matchday, seasonId } = req.body;
  try {
    const result = await openCompetitionMatchdayNowFirestore(
      competitionId,
      durationHours,
      typeof matchday === "number" ? matchday : void 0,
      typeof seasonId === "string" ? seasonId : void 0
    );
    res.json(result);
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/competitions/${competitionId}/matchday/open-now`);
  }
});
adminRouter.post("/competitions/:id/matchday/set-timer", async (req, res) => {
  const competitionId = req.params.id;
  const { currentMatchday, durationHours, nextOpenAt, overrideStatus } = req.body;
  try {
    const result = await setCompetitionMatchdayTimerFirestore(competitionId, {
      currentMatchday,
      durationHours,
      nextOpenAt,
      overrideStatus
    });
    res.json(result);
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/admin/competitions/${competitionId}/matchday/set-timer`);
  }
});
adminRouter.get("/fixtures/validation", async (req, res) => {
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const report = await validateDomesticFixturesFirestore(seasonId);
    res.json(report);
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/admin/fixtures/validation`);
  }
});
adminRouter.get("/read-metrics", async (_req, res) => {
  res.json(getReadMetrics());
});
adminRouter.post("/read-metrics/reset", async (_req, res) => {
  resetReadMetrics();
  res.json({ success: true, message: "Firestore read metrics have been reset." });
});
adminRouter.post("/sync", async (_req, res) => {
  try {
    const result = await processPendingMutations();
    res.status(200).json({
      success: true,
      result,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});
adminRouter.post("/read-model/rebuild", async (req, res) => {
  const seasonId = req.body?.seasonId || req.query?.seasonId || "season-2026-27";
  try {
    const result = await rebuildAllReadModels(seasonId);
    res.json(result);
  } catch (err) {
    console.error("[ADMIN_READ_MODEL_REBUILD_ERROR]", err);
    res.status(500).json({
      success: false,
      error: err.message || "Failed to rebuild read model snapshots",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
});
adminRouter.get("/read-model/health", async (req, res) => {
  const seasonId = req.query?.seasonId || "season-2026-27";
  try {
    const health = await getReadModelHealthStatus(seasonId);
    res.json(health);
  } catch (err) {
    console.error("[ADMIN_READ_MODEL_HEALTH_ERROR]", err);
    res.status(500).json({
      error: err.message || "Failed to get read model health"
    });
  }
});
adminRouter.get("/cups", async (req, res) => {
  try {
    const cups = Object.values(DOMESTIC_CUPS);
    res.json({ cups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
adminRouter.get("/cups/:cupId", async (req, res) => {
  const cupId = req.params.cupId;
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const details = await getDomesticCupDetails(cupId, seasonId);
    res.json(details);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
adminRouter.post("/cups/:cupId/bracket/preview", async (req, res) => {
  const cupId = req.params.cupId;
  const seasonId = req.body.seasonId || "season-2026-27";
  try {
    const preview = await previewDomesticCupBracket(cupId, seasonId);
    res.json(preview);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
adminRouter.post("/cups/:cupId/bracket/generate", async (req, res) => {
  const cupId = req.params.cupId;
  const adminUserId = req.user.id;
  const adminUsername = req.user?.username || "admin";
  const confirmation = Boolean(req.body.confirmation);
  const seasonId = req.body.seasonId || "season-2026-27";
  try {
    const result = await generateDomesticCupBracketSafe(cupId, {
      adminUserId,
      adminUsername,
      confirmation,
      seasonId
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
adminRouter.post("/cups/matches/:fixtureId/advance", async (req, res) => {
  const fixtureId = req.params.fixtureId;
  const adminUserId = req.user.id;
  const adminUsername = req.user?.username || "admin";
  try {
    const result = await advanceDomesticCupWinnerSafe(fixtureId, {
      adminUserId,
      adminUsername
    });
    res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || err.status || 400;
    res.status(statusCode).json({
      error: err.message,
      code: err.code || (statusCode === 409 ? "CONFLICT" : "BAD_REQUEST")
    });
  }
});
adminRouter.get("/european/standings", async (req, res) => {
  const competitionId = req.query.competitionId || "comp-champions-league-2026";
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const result = await getEuropeanStandings(competitionId, seasonId);
    res.json({
      competitionId,
      seasonId,
      standings: result.rows,
      source: result.source,
      degraded: result.degraded
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
adminRouter.post("/european/standings/rebuild", async (req, res) => {
  const competitionId = req.body.competitionId || "comp-champions-league-2026";
  const seasonId = req.body.seasonId || "season-2026-27";
  try {
    const rows = await rebuildEuropeanStandings(competitionId, seasonId);
    res.json({
      success: true,
      competitionId,
      seasonId,
      totalTeams: rows.length,
      standings: rows,
      message: `Rebuilt 32-team standings for ${competitionId}.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
adminRouter.get("/european/qualification/preview", async (req, res) => {
  const seasonId = req.query.seasonId || "season-2026-27";
  const mode = req.query.mode || "provisional";
  try {
    const preview = await previewEuropeanQualificationSync(seasonId, mode);
    res.json(preview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
adminRouter.post("/european/qualification/apply", async (req, res) => {
  const adminUserId = req.user.id;
  const adminUsername = req.user?.username || "admin";
  const { previewToken, confirmation, seasonId } = req.body;
  if (!previewToken) {
    res.status(400).json({ error: "previewToken is required" });
    return;
  }
  try {
    const result = await applyEuropeanQualificationSync({
      seasonId,
      previewToken,
      confirmation: Boolean(confirmation),
      adminUserId,
      adminUsername
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
adminRouter.get("/telegram-notifications/recipients", async (req, res) => {
  const audience = req.query.audience;
  const leagueId = req.query.leagueId;
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const recipients = await getSafeEligibleRecipients({ audience, leagueId }, seasonId);
    res.json({
      total: recipients.length,
      recipients
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
adminRouter.post("/telegram-notifications/recipients/refresh", async (req, res) => {
  try {
    res.json({ count: await syncRecipientDirectory(req.body.seasonId || "season-2026-27") });
  } catch {
    res.status(503).json({ error: "RECIPIENT_DIRECTORY_UNAVAILABLE" });
  }
});
adminRouter.post("/telegram-notifications/broadcast", async (req, res) => {
  const adminUserId = req.user.id;
  const adminUsername = req.user?.username || "admin";
  const { title, body, type, targetAudience, targetLeagueId, selectedUserIds, seasonId } = req.body;
  if (!title || !body) {
    res.status(400).json({ error: "Title and message body are required" });
    return;
  }
  try {
    const record = await enqueueTelegramBroadcast({
      adminUserId,
      adminUsername,
      title,
      body,
      type: type || "CUSTOM_ALERT",
      targetAudience: targetAudience || "SELECTED_RECIPIENTS",
      targetLeagueId,
      selectedUserIds,
      seasonId,
      requestId: req.body.requestId
    });
    res.json({
      success: true,
      message: `Enqueued broadcast '${title}' for ${record.metrics.totalRecipients} recipients.`,
      broadcast: record
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
adminRouter.get("/telegram-notifications/broadcasts", async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
  try {
    const broadcasts = await getBroadcastHistory(limit);
    res.json({ broadcasts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
adminRouter.get("/telegram-notifications/broadcasts/:id", async (req, res) => {
  try {
    const broadcast = await getBroadcastDetails(req.params.id);
    if (!broadcast) {
      res.status(404).json({ error: "Broadcast not found" });
      return;
    }
    res.json({ broadcast });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
adminRouter.post("/telegram-notifications/process-queue", async (req, res) => {
  try {
    const result = await processNotificationQueue(50);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// src/server/routes/telegram.routes.ts
import { Router as Router13 } from "express";
var telegramRouter = Router13();
telegramRouter.post("/webhook", async (req, res) => {
  const secretToken = req.headers["x-telegram-bot-api-secret-token"];
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret && secretToken !== expectedSecret) {
    res.status(401).json({ error: "Unauthorized webhook secret token" });
    return;
  }
  const update = req.body;
  if (!update || typeof update !== "object") {
    res.status(200).json({ ok: true, ignored: "empty_update" });
    return;
  }
  const message = update.message;
  if (message && message.text && typeof message.text === "string") {
    const text = message.text.trim();
    if (text.startsWith("/start")) {
      try {
        const result = await handleTelegramStart(message.chat.id, message.from);
        res.status(200).json({ ok: true, handled: "start", result });
        return;
      } catch (err) {
        console.error("[TELEGRAM WEBHOOK /start error]:", err.message);
        res.status(200).json({ ok: true, error: err.message });
        return;
      }
    }
  }
  res.status(200).json({ ok: true, ignored: "unhandled_update_type" });
});
telegramRouter.get("/status", (req, res) => {
  const hasToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const hasSticker = Boolean(process.env.TELEGRAM_WELCOME_STICKER_FILE_ID);
  const group = process.env.TELEGRAM_GROUP_USERNAME || "@efleagueuz";
  const webAppUrl = process.env.TELEGRAM_WEBAPP_URL || process.env.APP_URL || "https://efluz.vercel.app";
  res.json({
    status: "ok",
    configured: hasToken,
    hasSticker,
    group,
    webAppUrl
  });
});
telegramRouter.post("/check-membership", requireAuth, async (req, res) => {
  const telegramId = req.user?.telegramId;
  if (!telegramId) {
    res.status(400).json({ error: "Authenticated user does not have a linked Telegram account" });
    return;
  }
  const result = await verifyTelegramGroupMembership(telegramId, true);
  res.json(result);
});

// src/server/app.ts
var dbInitPromise = null;
var dbReady = false;
var syncWorkerStarted = false;
function startBackgroundReconciliation() {
  if (process.env.ENABLE_LOCAL_MUTATION_REPLAY !== "true") return;
  if (syncWorkerStarted) return;
  syncWorkerStarted = true;
  setTimeout(() => {
    if (firestoreCircuitBreaker.canExecute()) {
      processPendingMutations().catch((err) => {
        console.warn("[RECONCILIATION] Startup mutation sync notice:", err.message);
      });
    }
  }, 4e3);
  const interval = setInterval(() => {
    if (firestoreCircuitBreaker.canExecute()) {
      processPendingMutations().catch((err) => {
        console.warn("[RECONCILIATION] Periodic mutation sync notice:", err.message);
      });
    }
  }, 6e4);
  if (interval.unref) interval.unref();
}
async function ensureDbReady() {
  if (dbReady) return;
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      try {
        await initDatabase();
        seedDatabase();
        repairSeason202627Roster();
        console.log(`[BOOT] SQLite baseline ready from: ${getDbFilePath()}`);
        loadSnapshotFromFile();
        const isServerless = process.env.VERCEL === "1" || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
        if (!isServerless) {
          startBackgroundReconciliation();
        }
        dbReady = true;
      } catch (err) {
        dbInitPromise = null;
        console.error("[BOOT] Error during system initialization:", err);
        throw err;
      }
    })();
  }
  return dbInitPromise;
}
function createApp() {
  const app2 = express();
  app2.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-dev-user-id, x-telegram-init-data");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app2.use(express.json());
  app2.get("/api/internal/telegram-worker", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    const actual = Buffer.from(req.headers.authorization || "");
    const expected = Buffer.from(`Bearer ${secret || ""}`);
    if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.status(401).json({ error: "UNAUTHORIZED" });
      return;
    }
    try {
      res.json(await processNotificationQueue(25));
    } catch {
      res.status(503).json({ error: "NOTIFICATION_WORKER_UNAVAILABLE" });
    }
  });
  app2.use(async (req, res, next) => {
    try {
      await ensureDbReady();
      next();
    } catch (err) {
      console.error("[SERVER] Database initialization failed on request:", err);
      res.status(500).json({ error: "Database initialization failed", details: err.message });
    }
  });
  app2.use(authMiddleware);
  app2.use("/api", readOptimizedRouter);
  app2.use("/api/health", healthRouter);
  app2.use("/api/auth", authRouter);
  app2.use("/api/seasons", seasonsRouter);
  app2.use("/api/leagues", leaguesRouter);
  app2.use("/api/clubs", clubsRouter);
  app2.use("/api/competitions", competitionsRouter);
  app2.use("/api/fixtures", fixturesResilientRouter);
  app2.use("/api/fixtures", fixturesRouter);
  app2.use("/api/me", notificationsReadResilientRouter);
  app2.use("/api/me", meResilientRouter);
  app2.use("/api/me", meRouter);
  app2.use("/api/users", usersRouter);
  app2.use("/api/admin", adminRouter);
  app2.use("/api/telegram", telegramRouter);
  app2.use("/api/*", (req, res) => {
    res.status(404).json({ error: "Endpoint not found", path: req.originalUrl });
  });
  app2.use((err, req, res, next) => {
    console.error("[SERVER] Unhandled error:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
      status: err.status || 500
    });
  });
  return app2;
}
var app = createApp();
var app_default = app;

// src/server/apiEntry.ts
async function handler(req, res) {
  try {
    if (req.url && !req.url.startsWith("/api")) {
      req.url = "/api" + (req.url.startsWith("/") ? req.url : "/" + req.url);
    }
    return app_default(req, res);
  } catch (err) {
    console.error("[VERCEL API ERROR]", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Serverless execution failure", details: err.message }));
    }
  }
}
export {
  handler as default
};
//# sourceMappingURL=index.js.map

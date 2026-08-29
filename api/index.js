var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/server/db/index.ts
import fs from "fs";
import path from "path";
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
      return path.dirname(fileURLToPath(import.meta.url));
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
    path.resolve(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    path.join(modDir, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    // 2. In same directory as compiled serverless handler (e.g., /var/task/api/sql-wasm.wasm)
    path.join(modDir, "sql-wasm.wasm"),
    // 3. In api/ folder relative to project root / task root
    path.resolve(process.cwd(), "api", "sql-wasm.wasm"),
    // 4. In parent directory (e.g. if modDir is /var/task/api, check /var/task/sql-wasm.wasm)
    path.join(modDir, "..", "sql-wasm.wasm"),
    path.join(modDir, "..", "api", "sql-wasm.wasm"),
    path.resolve(process.cwd(), "sql-wasm.wasm"),
    // 5. In dist/ folder
    path.resolve(process.cwd(), "dist", "sql-wasm.wasm"),
    path.join(modDir, "..", "dist", "sql-wasm.wasm"),
    // 6. In public/ folder
    path.resolve(process.cwd(), "public", "sql-wasm.wasm")
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const stats = fs.statSync(candidate);
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
    path.resolve(process.cwd(), "data", "efootball.sqlite"),
    path.join(modDir, "data", "efootball.sqlite"),
    path.join(modDir, "..", "data", "efootball.sqlite"),
    path.resolve(process.cwd(), "api", "data", "efootball.sqlite"),
    path.resolve(process.cwd(), "api", "efootball.sqlite"),
    path.join(modDir, "efootball.sqlite")
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const stats = fs.statSync(candidate);
        if (stats.isFile() && stats.size > 1e3) {
          const buf = fs.readFileSync(candidate);
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
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn(` [DB] Could not create DATA_DIR ${DATA_DIR}, falling back to /tmp/data:`, err);
  }
  if (IS_SERVERLESS && !fs.existsSync(DB_FILE)) {
    const bundledDbPath = resolveBundledDbPath();
    if (bundledDbPath && fs.existsSync(bundledDbPath)) {
      try {
        fs.copyFileSync(bundledDbPath, DB_FILE);
        console.log(` [DB] Copied bundled database from ${bundledDbPath} to serverless location: ${DB_FILE}`);
      } catch (err) {
        console.warn(" [DB] Could not copy bundled DB to serverless path:", err);
      }
    }
  }
  const wasmPath = resolveSqlWasmPath();
  let SQL;
  try {
    const wasmFileBuffer = fs.readFileSync(wasmPath);
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
  if (fs.existsSync(DB_FILE)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE);
      if (isValidSqliteHeader(fileBuffer)) {
        dbInstance = new SQL.Database(fileBuffer);
        dbInstance.exec("SELECT 1");
        console.log(` [DB] path=${DB_FILE}`);
        console.log(" [DB] initialized=true (loaded from disk)");
      } else {
        console.log(` [DB] Re-initializing SQLite from clean baseline (existing file not valid SQLite header)`);
        try {
          fs.unlinkSync(DB_FILE);
        } catch {
        }
        dbInstance = new SQL.Database();
        console.log(` [DB] path=${DB_FILE}`);
        console.log(" [DB] initialized=true (new)");
      }
    } catch (err) {
      console.log(" [DB] Initialized clean SQLite database instance:", err?.message || "recreated");
      dbInstance = new SQL.Database();
      try {
        fs.unlinkSync(DB_FILE);
      } catch {
      }
      console.log(` [DB] path=${DB_FILE}`);
      console.log(" [DB] initialized=true (recreated)");
    }
  } else {
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
      console.log(" [DB] initialized=true (new)");
      dbInstance = new SQL.Database();
    }
  }
  if (fs.existsSync(SCHEMA_FILE)) {
    try {
      const schemaSql = fs.readFileSync(SCHEMA_FILE, "utf-8");
      dbInstance.exec(schemaSql);
    } catch (err) {
      console.warn(" [DB] Schema init error, resetting DB:", err.message);
      dbInstance = new SQL.Database();
      const schemaSql = fs.readFileSync(SCHEMA_FILE, "utf-8");
      dbInstance.exec(schemaSql);
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
    dbInstance.exec(`
      ALTER TABLE fixtures ADD COLUMN fixture_source TEXT DEFAULT 'official_2026_27';
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
    const targetDir = path.dirname(DB_FILE);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const tempFile = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, buffer);
    fs.renameSync(tempFile, DB_FILE);
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
    dbInstance = null;
    IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
    DEFAULT_DATA_DIR = IS_SERVERLESS ? "/tmp/data" : path.resolve(process.cwd(), "data");
    DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
    DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, "efootball.sqlite");
    SCHEMA_FILE = path.resolve(process.cwd(), "src", "server", "db", "schema.sql");
    transactionDepth = 0;
  }
});

// src/server/firebase/admin.ts
import { initializeApp, getApps, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs2 from "fs";
import path2 from "path";
function loadAppletConfig() {
  try {
    const configPath = path2.join(process.cwd(), "firebase-applet-config.json");
    if (fs2.existsSync(configPath)) {
      const raw = fs2.readFileSync(configPath, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
  }
  return {};
}
function initializeFirebaseAdmin() {
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
    } else if (fs2.existsSync(credPath)) {
      try {
        serviceAccountJson = fs2.readFileSync(credPath, "utf-8");
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
    }
    where(field, op, val) {
      const q = new MemQuery(this.colName);
      q.filters = [...this.filters, { field, op, val }];
      q.orderBys = [...this.orderBys];
      q.limitVal = this.limitVal;
      return q;
    }
    orderBy(field, dir = "asc") {
      const q = new MemQuery(this.colName);
      q.filters = [...this.filters];
      q.orderBys = [...this.orderBys, { field, dir }];
      q.limitVal = this.limitVal;
      return q;
    }
    limit(n) {
      const q = new MemQuery(this.colName);
      q.filters = [...this.filters];
      q.orderBys = [...this.orderBys];
      q.limitVal = n;
      return q;
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
          const vA = a.data()[o.field];
          const vB = b.data()[o.field];
          if (vA < vB) return o.dir === "asc" ? -1 : 1;
          if (vA > vB) return o.dir === "asc" ? 1 : -1;
          return 0;
        });
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
      for (const op of this.operations) {
        await op();
      }
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
      const tx = {
        async get(docRef) {
          return docRef.get();
        },
        set(docRef, data, options) {
          docRef.set(data, options);
          return tx;
        },
        update(docRef, data) {
          docRef.update(data);
          return tx;
        },
        delete(docRef) {
          docRef.delete();
          return tx;
        }
      };
      return await updateFunction(tx);
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
      AUDIT_LOGS: "audit_logs"
    };
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

// src/server/services/adminService.ts
async function createAuditLog(actorUserId, action, entityType, entityId, oldValue, newValue, ipAddress) {
  await createAuditLogFirestore(actorUserId, action, entityType, entityId, oldValue, newValue, ipAddress);
}
async function getDisputes(status = "OPEN") {
  return await getDisputesFirestore(status);
}
async function getAllAdminUsers() {
  return await getAllUsersFirestore();
}
async function getAuditLogs(limit = 50) {
  return await getAuditLogsFirestore(limit);
}
var init_adminService = __esm({
  "src/server/services/adminService.ts"() {
    init_firestoreStore();
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
  let bracketSize = 2;
  while (bracketSize < clubIds.length) {
    bracketSize *= 2;
  }
  const totalRounds = Math.log2(bracketSize);
  const getRoundName = (roundNum) => {
    const remainingTeams = Math.pow(2, totalRounds - roundNum + 1);
    if (remainingTeams === 2) return "Final";
    if (remainingTeams === 4) return "Semi-Finals";
    if (remainingTeams === 8) return "Quarter-Finals";
    if (remainingTeams === 16) return "Round of 16";
    if (remainingTeams === 32) return "Round of 32";
    return `Round of ${remainingTeams}`;
  };
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let totalGenerated = 0;
  const batch = db.batch();
  const firstRoundMatches = bracketSize / 2;
  for (let i = 0; i < firstRoundMatches; i++) {
    const homeClubId = clubIds[i * 2] || "TBD";
    const awayClubId = clubIds[i * 2 + 1] || "TBD";
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
    throw new Error(`UCL Knockout Phase requires 24 ranked clubs (found ${rankedClubIds.length}).`);
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
  if (comp.type !== "KNOCKOUT" && comp.type !== "SUPER_CUP" && comp.type !== "EUROPEAN_KNOCKOUT") {
    return { advanced: false };
  }
  const match = fixture.id.match(/-r(\d+)-m(\d+)$/);
  if (!match) {
    return { advanced: false };
  }
  const currentRound = parseInt(match[1], 10);
  const currentMatchIndex = parseInt(match[2], 10);
  const nextRound = currentRound + 1;
  const nextMatchIndex = Math.floor(currentMatchIndex / 2);
  const isHomeSlot = currentMatchIndex % 2 === 0;
  const nextFixtureId = `fix-${comp.id}-r${nextRound}-m${nextMatchIndex}`;
  const nextFixRef = db.collection(COLLECTIONS.FIXTURES).doc(nextFixtureId);
  const nextFixDoc = await nextFixRef.get();
  if (!nextFixDoc.exists) {
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
  return { advanced: true, targetFixtureId: nextFixtureId, winnerClubId: fixture.winnerClubId };
}
var generateKnockoutBracketFirestore, generateUCLKnockoutBracketFirestore, advanceKnockoutWinnerFirestore;
var init_knockoutEngine = __esm({
  "src/server/tournament/knockoutEngine.ts"() {
    init_admin();
    init_collections();
    init_notificationService();
    init_adminService();
    generateKnockoutBracketFirestore = generateKnockoutBracket;
    generateUCLKnockoutBracketFirestore = generateUCLKnockoutBracket;
    advanceKnockoutWinnerFirestore = advanceKnockoutWinner;
  }
});

// src/server/firebase/firestoreStore.ts
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
function getFromCache(key) {
  const entry = serverCache.get(key);
  if (entry && Date.now() - entry.timestamp < entry.ttlMs) {
    return entry.data;
  }
  return null;
}
function setInCache(key, data, ttlMs = 6e4) {
  serverCache.set(key, {
    data,
    timestamp: Date.now(),
    ttlMs
  });
}
async function getActiveSeasonFirestore() {
  const cacheKey = "firestore:active_season";
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const db = getFirestoreDb();
    const snap = await db.collection(COLLECTIONS.SEASONS).where("status", "==", "ACTIVE").limit(1).get();
    if (snap.empty) {
      const doc2 = await db.collection(COLLECTIONS.SEASONS).doc("season-2026-27").get();
      if (doc2.exists) {
        const data2 = doc2.data();
        const res2 = {
          id: doc2.id,
          name: data2.name,
          status: data2.status?.toLowerCase() || "active",
          startDate: data2.startDate,
          endDate: data2.endDate,
          createdAt: data2.createdAt
        };
        setInCache(cacheKey, res2, 6e4);
        return res2;
      }
      return null;
    }
    const doc = snap.docs[0];
    const data = doc.data();
    const res = {
      id: doc.id,
      name: data.name,
      status: data.status?.toLowerCase() || "active",
      startDate: data.startDate,
      endDate: data.endDate,
      createdAt: data.createdAt
    };
    setInCache(cacheKey, res, 6e4);
    return res;
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getActiveSeasonFirestore:", err.message);
    const row = queryGet("SELECT * FROM seasons WHERE status = 'active' OR id = 'season-2026-27' LIMIT 1");
    if (row) {
      const res = {
        id: row.id,
        name: row.name,
        status: row.status?.toLowerCase() || "active",
        startDate: row.start_date,
        endDate: row.end_date,
        createdAt: row.created_at
      };
      setInCache(cacheKey, res, 6e4);
      return res;
    }
    return null;
  }
}
async function getAllSeasonsFirestore() {
  const cacheKey = "firestore:all_seasons";
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const db = getFirestoreDb();
    const snap = await db.collection(COLLECTIONS.SEASONS).get();
    const res = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        status: data.status?.toLowerCase() || "active",
        startDate: data.startDate,
        endDate: data.endDate,
        createdAt: data.createdAt
      };
    });
    setInCache(cacheKey, res, 6e4);
    return res;
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getAllSeasonsFirestore:", err.message);
    const rows = queryAll("SELECT * FROM seasons");
    const res = rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status?.toLowerCase() || "active",
      startDate: row.start_date,
      endDate: row.end_date,
      createdAt: row.created_at
    }));
    setInCache(cacheKey, res, 6e4);
    return res;
  }
}
async function getAllLeaguesFirestore() {
  const cacheKey = "firestore:all_leagues";
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const db = getFirestoreDb();
    const snap = await db.collection(COLLECTIONS.LEAGUES).orderBy("tier", "asc").get();
    const res = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        country: data.country,
        tier: data.tier,
        logoUrl: data.logo,
        createdAt: data.createdAt
      };
    });
    setInCache(cacheKey, res, 6e4);
    return res;
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getAllLeaguesFirestore:", err.message);
    const rows = queryAll("SELECT * FROM leagues ORDER BY tier ASC");
    const res = rows.map((row) => ({
      id: row.id,
      name: row.name,
      country: row.country,
      tier: row.tier,
      logoUrl: row.logo_url,
      createdAt: row.created_at
    }));
    setInCache(cacheKey, res, 6e4);
    return res;
  }
}
async function getClubsByLeagueFirestore(leagueId, seasonId = "season-2026-27", currentUserId) {
  try {
    const db = getFirestoreDb();
    const clubsSnap = await db.collection(COLLECTIONS.CLUBS).where("leagueId", "==", leagueId).where("isActive", "==", true).get();
    const [occupanciesSnap, membershipsSnap] = await Promise.all([
      db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where("seasonId", "==", seasonId).where("status", "==", "active").get(),
      db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).where("seasonId", "==", seasonId).where("status", "==", "active").get()
    ]);
    const clubOccupancyMap = /* @__PURE__ */ new Map();
    for (const doc of occupanciesSnap.docs) {
      const data = doc.data();
      if (data.clubId && data.userId) {
        clubOccupancyMap.set(data.clubId, { userId: data.userId });
      }
    }
    for (const doc of membershipsSnap.docs) {
      const m = doc.data();
      if (m.clubId && m.userId && !clubOccupancyMap.has(m.clubId)) {
        clubOccupancyMap.set(m.clubId, { userId: m.userId });
      }
    }
    const userIds = Array.from(new Set(Array.from(clubOccupancyMap.values()).map((o) => o.userId)));
    const usernameMap = /* @__PURE__ */ new Map();
    if (userIds.length > 0) {
      const userDocPromises = userIds.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid).get());
      const userDocs = await Promise.all(userDocPromises);
      for (const uDoc of userDocs) {
        if (uDoc.exists) {
          const uData = uDoc.data();
          usernameMap.set(uDoc.id, uData.username || uData.firstName || uDoc.id);
        }
      }
    }
    const clubs = clubsSnap.docs.map((doc) => {
      const data = doc.data();
      const occupancy = clubOccupancyMap.get(doc.id);
      const isTaken = Boolean(occupancy);
      const isCurrentUserClub = Boolean(currentUserId && occupancy && occupancy.userId === currentUserId);
      const managerUsername = occupancy ? usernameMap.get(occupancy.userId) : void 0;
      const claimedByUserId = occupancy ? occupancy.userId : null;
      const claimedByUsername = managerUsername || null;
      const occupancyStatus = isCurrentUserClub ? "owned" : isTaken ? "occupied" : "available";
      return {
        id: doc.id,
        name: data.name,
        shortName: data.shortName,
        leagueId: data.leagueId,
        country: data.country,
        logoUrl: data.logo,
        active: data.isActive,
        createdAt: data.createdAt,
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
    return clubs.sort((a, b) => a.name.localeCompare(b.name));
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
    return rows.map((r) => {
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
  }
}
async function getAvailableClubsFirestore(seasonId = "season-2026-27", currentUserId) {
  try {
    const db = getFirestoreDb();
    const clubsSnap = await db.collection(COLLECTIONS.CLUBS).where("isActive", "==", true).get();
    const [occupanciesSnap, membershipsSnap] = await Promise.all([
      db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where("seasonId", "==", seasonId).where("status", "==", "active").get(),
      db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).where("seasonId", "==", seasonId).where("status", "==", "active").get()
    ]);
    const occupiedClubIds = /* @__PURE__ */ new Set();
    for (const doc of occupanciesSnap.docs) {
      const data = doc.data();
      if (data.clubId) occupiedClubIds.add(data.clubId);
    }
    for (const doc of membershipsSnap.docs) {
      const data = doc.data();
      if (data.clubId) occupiedClubIds.add(data.clubId);
    }
    const availableClubs = [];
    for (const doc of clubsSnap.docs) {
      if (!occupiedClubIds.has(doc.id)) {
        const data = doc.data();
        availableClubs.push({
          id: doc.id,
          name: data.name,
          shortName: data.shortName,
          leagueId: data.leagueId,
          country: data.country,
          logoUrl: data.logo,
          active: data.isActive,
          createdAt: data.createdAt,
          isTaken: false,
          isCurrentUserClub: false,
          occupancy: {
            status: "available"
          }
        });
      }
    }
    return availableClubs.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getAvailableClubsFirestore:", err.message);
    const rows = queryAll(
      `SELECT c.* FROM clubs c
       LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = ? AND cm.status = 'active'
       WHERE c.active = 1 AND cm.id IS NULL
       ORDER BY c.name ASC`,
      [seasonId]
    );
    return rows.map((r) => ({
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
  }
}
async function getClubByIdFirestore(clubId, seasonId = "season-2026-27", currentUserId) {
  try {
    const db = getFirestoreDb();
    const doc = await db.collection(COLLECTIONS.CLUBS).doc(clubId).get();
    if (doc.exists) {
      const data = doc.data();
      let occUserId = null;
      const occDoc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`).get();
      if (occDoc.exists && occDoc.data()?.status === "active") {
        occUserId = occDoc.data().userId;
      } else {
        const memDoc = await db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${clubId}`).get();
        if (memDoc.exists && memDoc.data()?.status === "active") {
          occUserId = memDoc.data().userId;
        } else {
          const userMemSnap = await db.collection(COLLECTIONS.USER_MEMBERSHIPS).where("seasonId", "==", seasonId).where("clubId", "==", clubId).where("status", "==", "active").limit(1).get();
          if (!userMemSnap.empty) {
            occUserId = userMemSnap.docs[0].data().userId;
          }
        }
      }
      let isTaken2 = false;
      let managerUsername;
      let isCurrentUserClub2 = false;
      if (occUserId) {
        isTaken2 = true;
        isCurrentUserClub2 = Boolean(currentUserId && currentUserId === occUserId);
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(occUserId).get();
        if (userDoc.exists) {
          managerUsername = userDoc.data().username;
        }
      }
      const occupancyStatus = isCurrentUserClub2 ? "owned" : isTaken2 ? "occupied" : "available";
      return {
        id: doc.id,
        name: data.name,
        shortName: data.shortName,
        leagueId: data.leagueId,
        country: data.country,
        logoUrl: data.logo,
        active: data.isActive,
        createdAt: data.createdAt,
        isTaken: isTaken2,
        isCurrentUserClub: isCurrentUserClub2,
        claimedByUserId: occUserId,
        claimedByUsername: managerUsername || null,
        managerUsername,
        occupancy: {
          status: occupancyStatus,
          userId: occUserId || void 0,
          username: managerUsername
        }
      };
    }
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getClubByIdFirestore:", err.message);
  }
  const r = queryGet(
    `SELECT c.*, cm.user_id as claimed_by_user_id, u.username as manager_username
     FROM clubs c
     LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = ? AND cm.status = 'active'
     LEFT JOIN users u ON cm.user_id = u.id
     WHERE c.id = ?`,
    [seasonId, clubId]
  );
  if (!r) return null;
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
}
async function getUserActiveClubFirestore(userId, seasonId = "season-2026-27") {
  try {
    const db = getFirestoreDb();
    const userMemDoc = await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userId}`).get();
    if (userMemDoc.exists && userMemDoc.data()?.status === "active") {
      const clubId = userMemDoc.data().clubId;
      return getClubByIdFirestore(clubId, seasonId, userId);
    }
    const occSnap = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where("userId", "==", userId).where("seasonId", "==", seasonId).where("status", "==", "active").limit(1).get();
    if (!occSnap.empty) {
      const clubId = occSnap.docs[0].data().clubId;
      return getClubByIdFirestore(clubId, seasonId, userId);
    }
    const memSnap = await db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).where("userId", "==", userId).where("seasonId", "==", seasonId).where("status", "==", "active").limit(1).get();
    if (!memSnap.empty) {
      const clubId = memSnap.docs[0].data().clubId;
      return getClubByIdFirestore(clubId, seasonId, userId);
    }
    const clubSnap = await db.collection(COLLECTIONS.CLUBS).where("claimedByUserId", "==", userId).limit(1).get();
    if (!clubSnap.empty) {
      return getClubByIdFirestore(clubSnap.docs[0].id, seasonId, userId);
    }
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getUserActiveClubFirestore:", err.message);
  }
  const mem = queryGet(
    `SELECT club_id FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = 'active' LIMIT 1`,
    [userId, seasonId]
  );
  if (mem) {
    return getClubByIdFirestore(mem.club_id, seasonId, userId);
  }
  return null;
}
async function claimClubAtomicFirestore(userId, clubId, seasonId = "season-2026-27") {
  try {
    const db = getFirestoreDb();
    const claimResult = await db.runTransaction(async (transaction) => {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const userMemRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userId}`);
      const clubOccRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`);
      const membershipRef = db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${clubId}`);
      const clubRef = db.collection(COLLECTIONS.CLUBS).doc(clubId);
      const clubDoc = await transaction.get(clubRef);
      if (!clubDoc.exists) {
        throw new ClubNotFoundError(`Club with ID '${clubId}' does not exist.`);
      }
      const clubData = clubDoc.data();
      const userMemDoc = await transaction.get(userMemRef);
      if (userMemDoc.exists) {
        const userMemData = userMemDoc.data();
        if (userMemData && userMemData.status === "active") {
          if (userMemData.clubId === clubId) {
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
      const clubOccDoc = await transaction.get(clubOccRef);
      if (clubOccDoc.exists) {
        const clubOccData = clubOccDoc.data();
        if (clubOccData && clubOccData.status === "active" && clubOccData.userId !== userId) {
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
    invalidateFirestoreCache();
    return claimResult;
  } catch (err) {
    if (err instanceof ClubConflictError || err instanceof ClubNotFoundError) {
      throw err;
    }
    console.warn("[FIRESTORE FALLBACK] claimClubAtomicFirestore:", err.message);
    dbTransaction(() => {
      const club = queryGet("SELECT * FROM clubs WHERE id = ?", [clubId]);
      if (!club) {
        throw new ClubNotFoundError(`Club with ID '${clubId}' does not exist.`);
      }
      const existingMem = queryGet(
        "SELECT * FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = 'active'",
        [userId, seasonId]
      );
      if (existingMem) {
        if (existingMem.club_id === clubId) {
          return;
        }
        throw new ClubConflictError(
          "Your club selection is locked for this season. You have already claimed another club.",
          "CLUB_SELECTION_LOCKED"
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
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const memId = `cm-${seasonId}-${clubId}`;
      queryRun(
        `INSERT OR REPLACE INTO club_memberships (id, season_id, club_id, user_id, claimed_at, status, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        [memId, seasonId, clubId, userId, now, now]
      );
      invalidateFirestoreCache();
    });
    const c = await getClubByIdFirestore(clubId, seasonId, userId);
    return { success: true, club: c };
  }
}
async function getAllCompetitionsFirestore(seasonId = "season-2026-27") {
  const cacheKey = `firestore:competitions:${seasonId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const db = getFirestoreDb();
    let snap = await db.collection(COLLECTIONS.COMPETITIONS).where("seasonId", "==", seasonId).get();
    if (snap.empty) {
      snap = await db.collection(COLLECTIONS.COMPETITIONS).get();
    }
    const validDocs = snap.docs.filter((doc) => {
      const data = doc.data();
      const isObsolete = doc.id.includes("trophee-des-champions") || data.name?.toLowerCase().includes("troph\xE9e des champions") || data.name?.toLowerCase().includes("trophee des champions");
      if (isObsolete) {
        doc.ref.delete().catch(() => {
        });
        return false;
      }
      return true;
    });
    const competitions = await Promise.all(
      validDocs.map(async (doc) => {
        const data = doc.data();
        const fixturesSnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", doc.id).get();
        const fixturesCount = fixturesSnap.size;
        const hasFixtures = fixturesCount > 0;
        const generationStatus = hasFixtures ? "generated" : "not_generated";
        let totalTeams = 0;
        if (data.leagueId) {
          const clubsInLeagueSnap = await db.collection(COLLECTIONS.CLUBS).where("leagueId", "==", data.leagueId).where("isActive", "==", true).get();
          totalTeams = clubsInLeagueSnap.size;
        } else {
          const participantsSnap = await db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where("competitionId", "==", doc.id).get();
          totalTeams = participantsSnap.size || data.formatConfig?.maxTeams || 0;
        }
        return {
          id: doc.id,
          seasonId: data.seasonId,
          leagueId: data.leagueId,
          name: data.name,
          type: data.type,
          scheduleMode: data.scheduleMode,
          status: hasFixtures ? "active" : data.status,
          totalTeams,
          hasFixtures,
          fixtureCount: fixturesCount,
          fixturesCount,
          generationStatus,
          formatConfig: data.formatConfig || {},
          createdAt: data.createdAt
        };
      })
    );
    setInCache(cacheKey, competitions, 3e4);
    return competitions;
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getAllCompetitionsFirestore:", err.message);
    const rows = queryAll("SELECT * FROM competitions WHERE season_id = ?", [seasonId]);
    const competitions = rows.map((r) => {
      let formatConfig = {};
      try {
        formatConfig = JSON.parse(r.format_config_json || "{}");
      } catch {
      }
      const fixtures = queryAll("SELECT id FROM fixtures WHERE competition_id = ?", [r.id]);
      const hasFixtures = fixtures.length > 0;
      return {
        id: r.id,
        seasonId: r.season_id,
        leagueId: r.league_id,
        name: r.name,
        type: r.type,
        scheduleMode: r.schedule_mode,
        status: hasFixtures ? "active" : r.status,
        totalTeams: formatConfig.totalTeams || 20,
        hasFixtures,
        fixtureCount: fixtures.length,
        fixturesCount: fixtures.length,
        generationStatus: hasFixtures ? "generated" : "not_generated",
        formatConfig,
        createdAt: r.created_at
      };
    });
    setInCache(cacheKey, competitions, 3e4);
    return competitions;
  }
}
async function getCompetitionByIdFirestore(competitionId) {
  const cacheKey = `firestore:comp_id:${competitionId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const db = getFirestoreDb();
    const doc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    const fixturesSnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", doc.id).get();
    const fixturesCount = fixturesSnap.size;
    const hasFixtures = fixturesCount > 0;
    const generationStatus = hasFixtures ? "generated" : "not_generated";
    let totalTeams = 0;
    if (data.leagueId) {
      const clubsInLeagueSnap = await db.collection(COLLECTIONS.CLUBS).where("leagueId", "==", data.leagueId).where("isActive", "==", true).get();
      totalTeams = clubsInLeagueSnap.size;
    } else {
      const participantsSnap = await db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where("competitionId", "==", doc.id).get();
      totalTeams = participantsSnap.size || data.formatConfig?.maxTeams || 0;
    }
    const result = {
      id: doc.id,
      seasonId: data.seasonId,
      leagueId: data.leagueId,
      name: data.name,
      type: data.type,
      scheduleMode: data.scheduleMode,
      status: hasFixtures ? "active" : data.status,
      totalTeams,
      hasFixtures,
      fixtureCount: fixturesCount,
      fixturesCount,
      generationStatus,
      formatConfig: data.formatConfig || {},
      createdAt: data.createdAt
    };
    setInCache(cacheKey, result, 3e4);
    return result;
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getCompetitionByIdFirestore:", err.message);
    const r = queryGet("SELECT * FROM competitions WHERE id = ?", [competitionId]);
    if (!r) return null;
    let formatConfig = {};
    try {
      formatConfig = JSON.parse(r.format_config_json || "{}");
    } catch {
    }
    const fixtures = queryAll("SELECT id FROM fixtures WHERE competition_id = ?", [r.id]);
    const hasFixtures = fixtures.length > 0;
    const result = {
      id: r.id,
      seasonId: r.season_id,
      leagueId: r.league_id,
      name: r.name,
      type: r.type,
      scheduleMode: r.schedule_mode,
      status: hasFixtures ? "active" : r.status,
      totalTeams: formatConfig.totalTeams || 20,
      hasFixtures,
      fixtureCount: fixtures.length,
      fixturesCount: fixtures.length,
      generationStatus: hasFixtures ? "generated" : "not_generated",
      formatConfig,
      createdAt: r.created_at
    };
    setInCache(cacheKey, result, 3e4);
    return result;
  }
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
  try {
    const db = getFirestoreDb();
    let docs = [];
    if (targetClubId) {
      const [homeSnap, awaySnap] = await Promise.all([
        db.collection(COLLECTIONS.FIXTURES).where("homeClubId", "==", targetClubId).get(),
        db.collection(COLLECTIONS.FIXTURES).where("awayClubId", "==", targetClubId).get()
      ]);
      const docMap = /* @__PURE__ */ new Map();
      homeSnap.docs.forEach((d) => docMap.set(d.id, d.data()));
      awaySnap.docs.forEach((d) => docMap.set(d.id, d.data()));
      docs = Array.from(docMap.values());
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
      docs = snap.docs.map((d) => d.data());
    }
    docs.sort((a, b) => a.matchday - b.matchday || new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    if (filter.limit && filter.limit > 0) {
      docs = docs.slice(0, filter.limit);
    }
    const clubIds = /* @__PURE__ */ new Set();
    for (const f of docs) {
      if (f.homeClubId && f.homeClubId !== "TBD") clubIds.add(f.homeClubId);
      if (f.awayClubId && f.awayClubId !== "TBD") clubIds.add(f.awayClubId);
    }
    const clubMap = /* @__PURE__ */ new Map();
    if (clubIds.size > 0) {
      const clubsSnap = await db.collection(COLLECTIONS.CLUBS).get();
      for (const cDoc of clubsSnap.docs) {
        if (clubIds.has(cDoc.id)) {
          clubMap.set(cDoc.id, cDoc.data());
        }
      }
    }
    return docs.map((r) => {
      const homeClubData = clubMap.get(r.homeClubId);
      const awayClubData = clubMap.get(r.awayClubId);
      return {
        id: r.id,
        seasonId: r.seasonId,
        competitionId: r.competitionId,
        competitionName: r.competitionName || r.competitionId,
        matchday: r.matchday,
        roundName: r.roundName,
        homeClubId: r.homeClubId,
        awayClubId: r.awayClubId,
        homeClub: {
          id: r.homeClubId || "TBD",
          name: homeClubData?.name || (r.homeClubId === "TBD" ? "TBD" : r.homeClubId),
          shortName: homeClubData?.shortName || (r.homeClubId === "TBD" ? "TBD" : r.homeClubId),
          country: homeClubData?.country || "",
          leagueId: homeClubData?.leagueId || "",
          logoUrl: homeClubData?.logo || "",
          active: true,
          createdAt: ""
        },
        awayClub: {
          id: r.awayClubId || "TBD",
          name: awayClubData?.name || (r.awayClubId === "TBD" ? "TBD" : r.awayClubId),
          shortName: awayClubData?.shortName || (r.awayClubId === "TBD" ? "TBD" : r.awayClubId),
          country: awayClubData?.country || "",
          leagueId: awayClubData?.leagueId || "",
          logoUrl: awayClubData?.logo || "",
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
        updatedAt: r.updatedAt
      };
    });
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getFixturesFirestore:", err.message);
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
    const rows = queryAll(sql, params);
    return rows.map((r) => ({
      id: r.id,
      seasonId: r.season_id,
      competitionId: r.competition_id,
      competitionName: r.competition_name || r.competition_id,
      matchday: r.matchday,
      roundName: r.round_name,
      homeClubId: r.home_club_id,
      awayClubId: r.away_club_id,
      homeClub: {
        id: r.home_club_id || "TBD",
        name: r.home_name || r.home_club_id,
        shortName: r.home_short || r.home_club_id,
        country: r.home_country || "",
        leagueId: r.home_league || "",
        logoUrl: r.home_logo || "",
        active: true,
        createdAt: ""
      },
      awayClub: {
        id: r.away_club_id || "TBD",
        name: r.away_name || r.away_club_id,
        shortName: r.away_short || r.away_club_id,
        country: r.away_country || "",
        leagueId: r.away_league || "",
        logoUrl: r.away_logo || "",
        active: true,
        createdAt: ""
      },
      homeOwnerId: r.home_owner_id,
      awayOwnerId: r.away_owner_id,
      scheduledAt: r.scheduled_at,
      status: r.status,
      homeScore: r.home_score !== null && r.home_score !== void 0 ? r.home_score : void 0,
      awayScore: r.away_score !== null && r.away_score !== void 0 ? r.away_score : void 0,
      winnerClubId: r.winner_club_id || void 0,
      resultConfirmedAt: r.result_confirmed_at || void 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }
}
async function getFixtureByIdFirestore(fixtureId, currentUserId) {
  try {
    const db = getFirestoreDb();
    const doc = await db.collection(COLLECTIONS.FIXTURES).doc(fixtureId).get();
    if (doc.exists) {
      const r2 = doc.data();
      const homeDoc = await db.collection(COLLECTIONS.CLUBS).doc(r2.homeClubId).get();
      const awayDoc = await db.collection(COLLECTIONS.CLUBS).doc(r2.awayClubId).get();
      const homeClubData = homeDoc.exists ? homeDoc.data() : null;
      const awayClubData = awayDoc.exists ? awayDoc.data() : null;
      return {
        id: r2.id,
        seasonId: r2.seasonId,
        competitionId: r2.competitionId,
        competitionName: r2.competitionName || r2.competitionId,
        matchday: r2.matchday,
        roundName: r2.roundName,
        homeClubId: r2.homeClubId,
        awayClubId: r2.awayClubId,
        homeClub: {
          id: r2.homeClubId || "TBD",
          name: homeClubData?.name || r2.homeClubId,
          shortName: homeClubData?.shortName || r2.homeClubId,
          country: homeClubData?.country || "",
          leagueId: homeClubData?.leagueId || "",
          logoUrl: homeClubData?.logo || "",
          active: true,
          createdAt: ""
        },
        awayClub: {
          id: r2.awayClubId || "TBD",
          name: awayClubData?.name || r2.awayClubId,
          shortName: awayClubData?.shortName || r2.awayClubId,
          country: awayClubData?.country || "",
          leagueId: awayClubData?.leagueId || "",
          logoUrl: awayClubData?.logo || "",
          active: true,
          createdAt: ""
        },
        homeOwnerId: r2.homeOwnerId,
        awayOwnerId: r2.awayOwnerId,
        scheduledAt: r2.scheduledAt,
        status: r2.status,
        homeScore: r2.homeScore ?? void 0,
        awayScore: r2.awayScore ?? void 0,
        winnerClubId: r2.winnerClubId ?? void 0,
        resultConfirmedAt: r2.resultConfirmedAt ?? void 0,
        createdAt: r2.createdAt,
        updatedAt: r2.updatedAt
      };
    }
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getFixtureByIdFirestore:", err.message);
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
  return {
    id: r.id,
    seasonId: r.season_id,
    competitionId: r.competition_id,
    competitionName: r.competition_name || r.competition_id,
    matchday: r.matchday,
    roundName: r.round_name,
    homeClubId: r.home_club_id,
    awayClubId: r.away_club_id,
    homeClub: {
      id: r.home_club_id || "TBD",
      name: r.home_name || r.home_club_id,
      shortName: r.home_short || r.home_club_id,
      country: r.home_country || "",
      leagueId: r.home_league || "",
      logoUrl: r.home_logo || "",
      active: true,
      createdAt: ""
    },
    awayClub: {
      id: r.away_club_id || "TBD",
      name: r.away_name || r.away_club_id,
      shortName: r.away_short || r.away_club_id,
      country: r.away_country || "",
      leagueId: r.away_league || "",
      logoUrl: r.away_logo || "",
      active: true,
      createdAt: ""
    },
    homeOwnerId: r.home_owner_id,
    awayOwnerId: r.away_owner_id,
    scheduledAt: r.scheduled_at,
    status: r.status,
    homeScore: r.home_score !== null && r.home_score !== void 0 ? r.home_score : void 0,
    awayScore: r.away_score !== null && r.away_score !== void 0 ? r.away_score : void 0,
    winnerClubId: r.winner_club_id || void 0,
    resultConfirmedAt: r.result_confirmed_at || void 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
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
  const teams = [...clubIds];
  if (teams.length % 2 !== 0) {
    teams.push("BYE");
  }
  const numTeams = teams.length;
  const numRounds = numTeams - 1;
  const halfSize = numTeams / 2;
  const generatedFixtures = [];
  const startDate = /* @__PURE__ */ new Date("2026-08-15T15:00:00.000Z");
  const now = (/* @__PURE__ */ new Date()).toISOString();
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
  const totalRounds = numRounds * 2;
  for (let round = 0; round < numRounds; round++) {
    const matchday = numRounds + round + 1;
    const matchDate = new Date(startDate.getTime() + (numRounds + round) * 7 * 24 * 60 * 60 * 1e3).toISOString();
    const leg1Matches = generatedFixtures.filter((f) => f.matchday === round + 1);
    for (const leg1 of leg1Matches) {
      const homeSlug = leg1.awayClubId.replace("club-", "");
      const awaySlug = leg1.homeClubId.replace("club-", "");
      const id = `fix-${competitionId}-md${matchday}-${homeSlug}-vs-${awaySlug}`;
      generatedFixtures.push({
        id,
        competitionId,
        competitionName: comp.name,
        seasonId: comp.seasonId,
        matchday,
        roundName: `Matchday ${matchday}`,
        homeClubId: leg1.awayClubId,
        // Reversed
        awayClubId: leg1.homeClubId,
        // Reversed
        scheduledAt: matchDate,
        status: "SCHEDULED",
        createdAt: now,
        updatedAt: now
      });
    }
  }
  const toDeleteSnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", competitionId).get();
  if (!toDeleteSnap.empty) {
    const batchSize2 = 400;
    for (let i = 0; i < toDeleteSnap.docs.length; i += batchSize2) {
      const chunk = toDeleteSnap.docs.slice(i, i + batchSize2);
      const batch = db.batch();
      chunk.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
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
  await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).update({
    status: "active",
    hasFixtures: true,
    fixtureCount: verifySnap.size,
    fixturesCount: verifySnap.size,
    generationStatus: "generated",
    updatedAt: now
  });
  invalidateFirestoreCache("firestore:comp");
  return { generated: verifySnap.size, matchdays: totalRounds };
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
  const clubList = clubs.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.short_name,
    logoUrl: c.logo_url,
    managerUsername: void 0
  }));
  const fixtureList = confirmedFixtures.map((f) => ({
    homeClubId: f.home_club_id,
    awayClubId: f.away_club_id,
    homeScore: f.home_score ?? 0,
    awayScore: f.away_score ?? 0
  }));
  return computeAndSortStandings(clubList, fixtureList, formatConfig);
}
async function getCompetitionStandingsFirestore(competitionId, options = {}) {
  const cacheKey = `firestore:standings:${competitionId}`;
  if (!options.forceRefresh) {
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
  }
  try {
    const db = getFirestoreDb();
    const docRef = db.collection(COLLECTIONS.STANDINGS).doc(competitionId);
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      const data = docSnap.data();
      if (Array.isArray(data.rows) && data.rows.length > 0) {
        setInCache(cacheKey, data.rows, 6e4);
        return data.rows;
      }
    }
    const rows = await rebuildCompetitionStandingsFirestore(competitionId);
    setInCache(cacheKey, rows, 6e4);
    return rows;
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getCompetitionStandingsFirestore:", err.message);
    const rows = fallbackCalculateStandings(competitionId);
    setInCache(cacheKey, rows, 6e4);
    return rows;
  }
}
async function rebuildCompetitionStandingsFirestore(competitionId) {
  const cacheKey = `firestore:standings:${competitionId}`;
  try {
    const db = getFirestoreDb();
    const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
    if (!compDoc.exists) {
      return fallbackCalculateStandings(competitionId);
    }
    const comp = compDoc.data();
    const seasonId = comp.seasonId || "season-2026-27";
    const formatConfig = comp.formatConfig || {};
    let clubs = [];
    const partSnap = await db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where("competitionId", "==", competitionId).get();
    if (!partSnap.empty) {
      const parts = partSnap.docs.map((d) => d.data());
      const clubIds = parts.map((p) => p.clubId);
      const clubsSnap = await db.collection(COLLECTIONS.CLUBS).where("id", "in", clubIds.slice(0, 30)).get();
      const clubMap = new Map(clubsSnap.docs.map((d) => [d.id, d.data()]));
      clubs = parts.map((p) => {
        const c = clubMap.get(p.clubId);
        return {
          id: p.clubId,
          name: c?.name || p.clubId,
          shortName: c?.shortName || p.clubId.substring(0, 4).toUpperCase(),
          logoUrl: c?.logo || "",
          managerUsername: p.ownerUsername || c?.managerUsername
        };
      });
    } else if (comp.leagueId) {
      const clubsSnap = await db.collection(COLLECTIONS.CLUBS).where("leagueId", "==", comp.leagueId).where("isActive", "==", true).get();
      clubs = clubsSnap.docs.map((d) => {
        const c = d.data();
        return {
          id: d.id,
          name: c.name,
          shortName: c.shortName,
          logoUrl: c.logo,
          managerUsername: c.managerUsername
        };
      });
    }
    const fixSnap = await db.collection(COLLECTIONS.FIXTURES).where("competitionId", "==", competitionId).where("status", "==", "CONFIRMED").get();
    const confirmedFixtures = fixSnap.docs.map((d) => d.data()).filter((f) => f.homeScore !== null && f.homeScore !== void 0 && f.awayScore !== null && f.awayScore !== void 0).map((f) => ({
      homeClubId: f.homeClubId,
      awayClubId: f.awayClubId,
      homeScore: f.homeScore ?? 0,
      awayScore: f.awayScore ?? 0
    }));
    const rankedRows = computeAndSortStandings(clubs, confirmedFixtures, formatConfig);
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
    setInCache(cacheKey, rankedRows, 6e4);
    return rankedRows;
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] rebuildCompetitionStandingsFirestore:", err.message);
    const rows = fallbackCalculateStandings(competitionId);
    setInCache(cacheKey, rows, 6e4);
    return rows;
  }
}
async function calculateCompetitionStandingsFirestore(competitionId) {
  return getCompetitionStandingsFirestore(competitionId);
}
async function submitFixtureResultFirestore(userId, fixtureId, homeScore, awayScore, proofUrl) {
  const db = getFirestoreDb();
  if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
    throw new Error("Scores must be non-negative integers.");
  }
  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();
  if (!fixDoc.exists) {
    throw new Error(`Fixture with ID '${fixtureId}' not found.`);
  }
  const fixture = fixDoc.data();
  if (fixture.status === "CONFIRMED") {
    throw new Error("This match result is already CONFIRMED and cannot be modified.");
  }
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
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const submissionId = `sub-${fixtureId}-${userId}`;
  const subRef = db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc(submissionId);
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
  await fixRef.update({
    status: newStatus,
    homeScore: confirmedHomeScore,
    awayScore: confirmedAwayScore,
    winnerClubId,
    resultConfirmedAt: confirmedAt,
    updatedAt: now
  });
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
      await rebuildCompetitionStandingsFirestore(fixture.competitionId);
    } catch (standingsErr) {
      console.warn("[STANDINGS_UPDATE] Non-blocking standings update error on confirmation:", standingsErr);
    }
  }
  invalidateFirestoreCache("firestore:comp");
  return await getFixtureByIdFirestore(fixtureId, userId);
}
function getCanonicalTelegramUserId(telegramId) {
  const raw = String(telegramId).trim();
  const cleanId = raw.startsWith("user-") ? raw.slice(5) : raw;
  return `user-${cleanId}`;
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
    } else {
      const existing = userDoc.data();
      const updatedAdmin = existing.isAdmin || isAdmin;
      await userDocRef.update({
        username,
        firstName,
        lastName,
        photoUrl: photoUrl || existing.photoUrl || "",
        isAdmin: updatedAdmin,
        updatedAt: now
      });
    }
    const verifyDoc = await userDocRef.get();
    if (verifyDoc.exists) {
      const persisted = verifyDoc.data();
      return {
        id: persisted.id || docId,
        telegramId: persisted.telegramId || telegramId,
        username: persisted.username || username,
        firstName: persisted.firstName || firstName,
        lastName: persisted.lastName || lastName,
        photoUrl: persisted.photoUrl || photoUrl,
        isAdmin: Boolean(persisted.isAdmin),
        isSuspended: Boolean(persisted.isSuspended),
        createdAt: persisted.createdAt || now,
        updatedAt: persisted.updatedAt || now
      };
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
async function reopenFixtureFirestore(adminUserId, fixtureId, notes) {
  const db = getFirestoreDb();
  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();
  if (!fixDoc.exists) {
    throw new Error(`Fixture '${fixtureId}' not found.`);
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
      await rebuildCompetitionStandingsFirestore(fixDoc.data().competitionId);
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
  return { success: true, fixtureId };
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
      await rebuildCompetitionStandingsFirestore(fixture.competitionId);
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
async function getDisputesFirestore(status = "OPEN") {
  const db = getFirestoreDb();
  let query = db.collection(COLLECTIONS.DISPUTES);
  if (status) {
    query = query.where("status", "==", status);
  }
  const snap = await query.get();
  const disputes = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const fixture = await getFixtureByIdFirestore(data.fixtureId);
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
  return disputes;
}
async function getAllUsersFirestore() {
  const db = getFirestoreDb();
  const snap = await db.collection(COLLECTIONS.USERS).orderBy("createdAt", "desc").get();
  return snap.docs.map((d) => {
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
}
async function getAuditLogsFirestore(limit = 50) {
  const db = getFirestoreDb();
  const snap = await db.collection(COLLECTIONS.AUDIT_LOGS).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((d) => {
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
      createdAt: data.createdAt
    };
  });
}
async function createAuditLogFirestore(actorUserId, action, entityType, entityId, oldValue, newValue, ipAddress) {
  const db = getFirestoreDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await db.collection(COLLECTIONS.AUDIT_LOGS).add({
    actorUserId,
    action,
    entityType,
    entityId,
    oldValueJson: oldValue ? JSON.stringify(oldValue) : null,
    newValueJson: newValue ? JSON.stringify(newValue) : null,
    ipAddress: ipAddress || null,
    createdAt: now
  });
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
async function getUserNotificationsFirestore(userId, limit = 20) {
  const validTypes = [
    "MATCH_SCHEDULED",
    "RESULT_SUBMITTED",
    "RESULT_CONFIRMED",
    "DISPUTE_OPENED",
    "DISPUTE_RESOLVED",
    "SYSTEM"
  ];
  try {
    const db = getFirestoreDb();
    const snap = await db.collection(COLLECTIONS.NOTIFICATIONS).where("userId", "==", userId).orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs.map((d) => {
      const data = d.data();
      const notifType = validTypes.includes(data.type) ? data.type : "SYSTEM";
      return {
        id: d.id,
        userId: data.userId,
        type: notifType,
        title: data.title,
        message: data.message,
        isRead: data.isRead,
        createdAt: data.createdAt
      };
    });
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] getUserNotificationsFirestore:", err.message);
    const rows = queryAll(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    );
    return rows.map((r) => {
      const notifType = validTypes.includes(r.type) ? r.type : "SYSTEM";
      return {
        id: r.id,
        userId: r.user_id,
        type: notifType,
        title: r.title,
        message: r.message,
        isRead: Boolean(r.is_read),
        createdAt: r.created_at
      };
    });
  }
}
async function markNotificationsReadFirestore(userId) {
  try {
    const db = getFirestoreDb();
    const snap = await db.collection(COLLECTIONS.NOTIFICATIONS).where("userId", "==", userId).where("isRead", "==", false).get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.update(doc.ref, { isRead: true }));
      await batch.commit();
    }
  } catch (err) {
    console.warn("[FIRESTORE FALLBACK] markNotificationsReadFirestore:", err.message);
    queryRun(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [userId]);
  }
}
var ClubConflictError, ClubNotFoundError, serverCache;
var init_firestoreStore = __esm({
  "src/server/firebase/firestoreStore.ts"() {
    init_admin();
    init_db();
    init_collections();
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
  }
});

// src/server/app.ts
init_db();
import express from "express";

// src/server/db/seed.ts
init_db();
var SEED_SEASON = {
  id: "season-2026-27",
  name: "2026/27 Season",
  status: "active",
  startDate: "2026-08-15",
  endDate: "2027-05-30"
};
var SEED_LEAGUES = [
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
var SEED_CLUBS = [
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
var SEED_COMPETITIONS = [
  // --- DOMESTIC LEAGUES ---
  {
    id: "comp-premier-league-2026",
    seasonId: "season-2026-27",
    leagueId: "league-premier-league",
    name: "Premier League",
    type: "LEAGUE",
    scheduleMode: "GENERATED_SCHEDULE",
    formatConfig: { rounds: 38, homeAndAway: true, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ["points", "goalDifference", "goalsFor", "headToHead"], qualificationSpots: 5 }
  },
  {
    id: "comp-la-liga-2026",
    seasonId: "season-2026-27",
    leagueId: "league-la-liga",
    name: "La Liga",
    type: "LEAGUE",
    scheduleMode: "GENERATED_SCHEDULE",
    formatConfig: { rounds: 38, homeAndAway: true, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ["points", "headToHead", "goalDifference", "goalsFor"], qualificationSpots: 5 }
  },
  {
    id: "comp-serie-a-2026",
    seasonId: "season-2026-27",
    leagueId: "league-serie-a",
    name: "Serie A",
    type: "LEAGUE",
    scheduleMode: "GENERATED_SCHEDULE",
    formatConfig: { rounds: 38, homeAndAway: true, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ["points", "headToHead", "goalDifference", "goalsFor"], qualificationSpots: 5 }
  },
  {
    id: "comp-bundesliga-2026",
    seasonId: "season-2026-27",
    leagueId: "league-bundesliga",
    name: "Bundesliga",
    type: "LEAGUE",
    scheduleMode: "GENERATED_SCHEDULE",
    formatConfig: { rounds: 34, homeAndAway: true, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ["points", "goalDifference", "goalsFor", "headToHead"], qualificationSpots: 5 }
  },
  {
    id: "comp-ligue-1-2026",
    seasonId: "season-2026-27",
    leagueId: "league-ligue-1",
    name: "Ligue 1",
    type: "LEAGUE",
    scheduleMode: "GENERATED_SCHEDULE",
    formatConfig: { rounds: 34, homeAndAway: true, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ["points", "goalDifference", "goalsFor", "headToHead"], qualificationSpots: 4 }
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
    id: "comp-efl-cup-2026",
    seasonId: "season-2026-27",
    leagueId: "league-premier-league",
    name: "EFL Cup",
    type: "KNOCKOUT",
    scheduleMode: "GENERATED_SCHEDULE",
    formatConfig: { rounds: 5, singleLeg: true, extraTime: true, penalties: true }
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
  // --- EUROPEAN COMPETITIONS ---
  {
    id: "comp-champions-league-2026",
    seasonId: "season-2026-27",
    name: "UEFA Champions League",
    type: "EUROPEAN_LEAGUE_PHASE",
    scheduleMode: "GENERATED_SCHEDULE",
    formatConfig: { leaguePhaseTeams: 24, matchesPerTeam: 8, directQualifiers: 8, playoffTeams: 16, knockoutTeams: 16 }
  },
  {
    id: "comp-europa-league-2026",
    seasonId: "season-2026-27",
    name: "UEFA Europa League",
    type: "EUROPEAN_LEAGUE_PHASE",
    scheduleMode: "GENERATED_SCHEDULE",
    formatConfig: { leaguePhaseTeams: 36, matchesPerTeam: 8, knockoutTeams: 16 }
  },
  {
    id: "comp-conference-league-2026",
    seasonId: "season-2026-27",
    name: "UEFA Conference League",
    type: "EUROPEAN_LEAGUE_PHASE",
    scheduleMode: "GENERATED_SCHEDULE",
    formatConfig: { leaguePhaseTeams: 36, matchesPerTeam: 6, knockoutTeams: 16 }
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

// src/server/auth/telegramAuth.ts
init_firestoreStore();
import crypto from "crypto";
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
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(cleanToken).digest();
    const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    const calculatedHashBuf = Buffer.from(calculatedHash, "hex");
    const receivedHashBuf = Buffer.from(hash, "hex");
    if (calculatedHashBuf.length !== receivedHashBuf.length || !crypto.timingSafeEqual(calculatedHashBuf, receivedHashBuf)) {
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
async function authMiddleware(req, res, next) {
  const isDev = process.env.ENABLE_DEV_AUTH === "true" || process.env.NODE_ENV !== "production";
  const initData = req.headers["x-telegram-init-data"] || req.query.initData;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (initData) {
    if (botToken) {
      const verifyResult = verifyTelegramWebAppData(initData, botToken);
      if (verifyResult.isValid && verifyResult.user) {
        try {
          req.user = await getOrCreateTelegramUser(verifyResult.user);
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
          req.user = await getOrCreateTelegramUser(parsed);
          return next();
        }
      } catch {
      }
    }
  }
  const devUserId = req.headers["x-dev-user-id"];
  if (isDev && devUserId) {
    try {
      const user = await getOrCreateDevUser(devUserId);
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
init_admin();

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
      batch.set(ref, {
        id: l.id,
        name: l.name,
        country: l.country,
        tier: l.tier,
        logo: l.logo_url,
        createdAt: l.created_at || (/* @__PURE__ */ new Date()).toISOString()
      });
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
        batch.set(ref, {
          id: c.id,
          name: c.name,
          shortName: c.short_name,
          leagueId: c.league_id,
          country: c.country,
          logo: c.logo_url,
          isActive: c.active !== void 0 ? Boolean(c.active) : c.is_active !== void 0 ? Boolean(c.is_active) : true,
          createdAt: c.created_at || (/* @__PURE__ */ new Date()).toISOString()
        });
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

// src/server/app.ts
init_collections();

// src/server/routes/health.routes.ts
init_admin();
init_collections();
import { Router } from "express";
var healthRouter = Router();
healthRouter.get("/", async (req, res) => {
  const status = getFirebaseStatus();
  let isConnected = false;
  let connectionWarning = null;
  try {
    const db = getFirestoreDb();
    if (db && status.isConfigured) {
      await db.collection(COLLECTIONS.SEASONS).limit(1).get();
      isConnected = true;
    } else {
      isConnected = true;
    }
  } catch (err) {
    connectionWarning = err.message;
    isConnected = true;
  }
  res.status(200).json({
    status: "ok",
    database: "firestore",
    connected: isConnected,
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

// src/server/routes/auth.routes.ts
import { Router as Router2 } from "express";
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
init_firestoreStore();
var authRouter = Router2();
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
          const currentClub = await getUserActiveClubFirestore(user.id, "season-2026-27");
          console.log(`[TELEGRAM AUTH - DEV SANDBOX] user=${user.username} (id: ${user.telegramId}), isAdmin=${user.isAdmin}`);
          res.json({ success: true, user, currentClub });
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
    const currentClub = await getUserActiveClubFirestore(user.id, "season-2026-27");
    console.log(`[TELEGRAM AUTH]
initData received: YES
parsed user id: ${verifyResult.user.id}
username: ${verifyResult.user.username || "(none)"}
auth_date valid: ${verifyResult.authDate ? "YES" : "NO"}
HMAC valid: YES
internal user: ${user.id}
isAdmin: ${user.isAdmin ? "YES" : "NO"}`);
    res.json({ success: true, user, currentClub });
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
    const currentClub = await getUserActiveClubFirestore(user.id, "season-2026-27");
    res.json({ success: true, user, currentClub });
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
import { Router as Router3 } from "express";

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
  const rawCode = err.code ?? (err.status ?? "");
  const rawMsg = err.message || String(err);
  const strCode = String(rawCode).toUpperCase();
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
var seasonsRouter = Router3();
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
import { Router as Router4 } from "express";
var leaguesRouter = Router4();
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
  const seasonId = req.query.seasonId || "season-2026-27";
  const leagueId = resolveLeagueId(req.params.id);
  const currentUserId = req.user?.id;
  try {
    const clubs = await getClubsByLeagueFirestore(leagueId, seasonId, currentUserId);
    res.json({ clubs });
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/leagues/${req.params.id}/clubs`);
  }
});

// src/server/routes/clubs.routes.ts
import { Router as Router5 } from "express";
init_firestoreStore();
var clubsRouter = Router5();
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
      const contentType = response.headers.get("content-type") || "image/png";
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      imageCache.set(imageUrl, {
        buffer,
        contentType,
        expiry: now + 7 * 24 * 60 * 60 * 1e3
      });
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=2592000, immutable");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(buffer);
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
  const seasonId = req.query.seasonId || "season-2026-27";
  const currentUserId = req.user?.id;
  try {
    const clubs = await getAvailableClubsFirestore(seasonId, currentUserId);
    res.json({ clubs });
  } catch (err) {
    handleFirestoreError(res, err, "GET /api/clubs/available");
  }
});
clubsRouter.get("/:id/crest", async (req, res) => {
  const clubId = req.params.id;
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const club = await getClubByIdFirestore(clubId, seasonId);
    if (!club || !club.logoUrl) {
      const svg = generateFallbackSvgBadge(club?.name || clubId, club?.shortName);
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(Buffer.from(svg, "utf-8"));
      return;
    }
    await fetchAndServeImage(club.logoUrl, res, club.name, club.shortName);
  } catch (err) {
    const svg = generateFallbackSvgBadge(clubId);
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(Buffer.from(svg, "utf-8"));
  }
});
clubsRouter.get("/:id", async (req, res) => {
  const seasonId = req.query.seasonId || "season-2026-27";
  const currentUserId = req.user?.id;
  try {
    const club = await getClubByIdFirestore(req.params.id, seasonId, currentUserId);
    if (!club) {
      res.status(404).json({ error: "Club not found", code: "NOT_FOUND", message: `Club '${req.params.id}' not found.` });
      return;
    }
    res.json({ club });
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/clubs/${req.params.id}`);
  }
});
clubsRouter.post("/:id/claim", requireAuth, async (req, res) => {
  const seasonId = req.body.seasonId || "season-2026-27";
  const userId = req.user.id;
  const clubId = req.params.id;
  try {
    const result = await claimClubAtomicFirestore(userId, clubId, seasonId);
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
import { Router as Router6 } from "express";
init_firestoreStore();
var competitionsRouter = Router6();
competitionsRouter.get("/", async (req, res) => {
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const competitions = await getAllCompetitionsFirestore(seasonId);
    res.json({ competitions });
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
competitionsRouter.get("/:id/standings", async (req, res) => {
  try {
    const standings = await calculateCompetitionStandingsFirestore(req.params.id);
    res.json({ standings });
  } catch (err) {
    handleFirestoreError(res, err, `GET /api/competitions/${req.params.id}/standings`);
  }
});
competitionsRouter.get("/:id/fixtures", async (req, res) => {
  const matchday = req.query.matchday ? parseInt(req.query.matchday, 10) : void 0;
  const status = req.query.status;
  try {
    const fixtures = await getFixturesFirestore({
      competitionId: req.params.id,
      matchday,
      status
    });
    res.json({ fixtures });
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
    const standings = await rebuildCompetitionStandingsFirestore(req.params.id);
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

// src/server/routes/fixtures.routes.ts
import { Router as Router7 } from "express";
import { z as z2 } from "zod";
init_firestoreStore();
var fixturesRouter = Router7();
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
    res.json({
      success: true,
      message: updatedFixture.status === "CONFIRMED" ? "Match result confirmed!" : updatedFixture.status === "DISPUTED" ? "Scores differ! Match has been marked DISPUTED and sent to admin." : "Score submitted! Awaiting opponent confirmation.",
      fixture: updatedFixture
    });
  } catch (err) {
    handleFirestoreError(res, err, `POST /api/fixtures/${fixtureId}/result`);
  }
});

// src/server/routes/me.routes.ts
import { Router as Router8 } from "express";
init_firestoreStore();
var meRouter = Router8();
meRouter.get("/", requireAuth, async (req, res) => {
  const user = req.user;
  const seasonId = req.query.seasonId || "season-2026-27";
  try {
    const currentClub = await getUserActiveClubFirestore(user.id, seasonId);
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
      currentClub,
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
  try {
    await markNotificationsReadFirestore(userId);
    res.json({ success: true });
  } catch (err) {
    handleFirestoreError(res, err, "POST /api/me/notifications/read");
  }
});

// src/server/routes/admin.routes.ts
import { Router as Router9 } from "express";
import { z as z3 } from "zod";
init_adminService();
init_firestoreStore();
init_knockoutEngine();

// src/server/tournament/qualificationEngine.ts
init_admin();
init_collections();
init_firestoreStore();
init_adminService();
init_notificationService();
async function evaluateSeasonQualifications(seasonId = "season-2026-27") {
  const db = getFirestoreDb();
  const qualifications = [];
  let participantsAdded = 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const [compSnap, existingPartsSnap, occupanciesSnap] = await Promise.all([
    db.collection(COLLECTIONS.COMPETITIONS).where("seasonId", "==", seasonId).get(),
    db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where("seasonId", "==", seasonId).get(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).get()
  ]);
  const allComps = compSnap.docs.map((d) => d.data());
  const leagues = allComps.filter((c) => c.type === "LEAGUE");
  const existingPartIds = new Set(existingPartsSnap.docs.map((d) => d.id));
  const occupancyMap = /* @__PURE__ */ new Map();
  for (const doc of occupanciesSnap.docs) {
    const data = doc.data();
    if (data.userId && data.clubId) {
      occupancyMap.set(data.clubId, data.userId);
    }
  }
  const uclComp = allComps.find(
    (c) => c.type === "EUROPEAN_LEAGUE_PHASE" && (c.name.toLowerCase().includes("champions league") || c.id.includes("ucl"))
  );
  const uelComp = allComps.find(
    (c) => c.type === "EUROPEAN_LEAGUE_PHASE" && (c.name.toLowerCase().includes("europa league") || c.id.includes("uel"))
  );
  const ueclComp = allComps.find(
    (c) => c.type === "EUROPEAN_LEAGUE_PHASE" && (c.name.toLowerCase().includes("conference league") || c.id.includes("uecl"))
  );
  const newParticipants = [];
  const notificationsToSend = [];
  for (const league of leagues) {
    const standings = await calculateCompetitionStandingsFirestore(league.id);
    if (standings.length === 0) continue;
    const formatConfig = league.formatConfig || {};
    const isLigue1 = league.id.includes("ligue-1") || league.name.toLowerCase().includes("ligue 1");
    const uclSpots = isLigue1 ? 4 : formatConfig.qualificationSpots || 5;
    const uelSpots = 1;
    const ueclSpots = 1;
    if (uclComp) {
      for (let i = 0; i < Math.min(uclSpots, standings.length); i++) {
        const row = standings[i];
        const ownerUserId = occupancyMap.get(row.clubId) || null;
        const reason = `${league.name} Rank #${row.position} (UCL Spot)`;
        qualifications.push({
          seasonId,
          sourceCompetitionId: league.id,
          sourceCompetitionName: league.name,
          targetCompetitionId: uclComp.id,
          targetCompetitionName: uclComp.name,
          clubId: row.clubId,
          clubName: row.clubName,
          ownerUserId,
          rank: row.position,
          reason
        });
        const partId = `part-${uclComp.id}-${row.clubId}`;
        if (!existingPartIds.has(partId)) {
          newParticipants.push({
            id: partId,
            competitionId: uclComp.id,
            clubId: row.clubId,
            seasonId,
            ownerUserId: ownerUserId || void 0,
            sourceCompetitionId: league.id,
            sourceCompetitionName: league.name,
            sourcePosition: row.position,
            qualificationReason: reason,
            qualificationTimestamp: now,
            seedNumber: qualifications.length,
            createdAt: now
          });
          existingPartIds.add(partId);
          participantsAdded++;
          if (ownerUserId) {
            notificationsToSend.push({
              userId: ownerUserId,
              title: "\u{1F3C6} Qualified for UEFA Champions League!",
              message: `Congratulations! ${row.clubName} finished #${row.position} in ${league.name} and qualified for the UEFA Champions League!`
            });
          }
        }
      }
    }
    if (uelComp) {
      for (let i = uclSpots; i < Math.min(uclSpots + uelSpots, standings.length); i++) {
        const row = standings[i];
        const ownerUserId = occupancyMap.get(row.clubId) || null;
        const reason = `${league.name} Rank #${row.position} (UEL Spot)`;
        qualifications.push({
          seasonId,
          sourceCompetitionId: league.id,
          sourceCompetitionName: league.name,
          targetCompetitionId: uelComp.id,
          targetCompetitionName: uelComp.name,
          clubId: row.clubId,
          clubName: row.clubName,
          ownerUserId,
          rank: row.position,
          reason
        });
        const partId = `part-${uelComp.id}-${row.clubId}`;
        if (!existingPartIds.has(partId)) {
          newParticipants.push({
            id: partId,
            competitionId: uelComp.id,
            clubId: row.clubId,
            seasonId,
            ownerUserId: ownerUserId || void 0,
            sourceCompetitionId: league.id,
            sourceCompetitionName: league.name,
            sourcePosition: row.position,
            qualificationReason: reason,
            qualificationTimestamp: now,
            seedNumber: qualifications.length,
            createdAt: now
          });
          existingPartIds.add(partId);
          participantsAdded++;
          if (ownerUserId) {
            notificationsToSend.push({
              userId: ownerUserId,
              title: "Qualified for UEFA Europa League",
              message: `Congratulations! ${row.clubName} finished #${row.position} in ${league.name} and qualified for the UEFA Europa League!`
            });
          }
        }
      }
    }
    if (ueclComp) {
      for (let i = uclSpots + uelSpots; i < Math.min(uclSpots + uelSpots + ueclSpots, standings.length); i++) {
        const row = standings[i];
        const ownerUserId = occupancyMap.get(row.clubId) || null;
        const reason = `${league.name} Rank #${row.position} (UECL Spot)`;
        qualifications.push({
          seasonId,
          sourceCompetitionId: league.id,
          sourceCompetitionName: league.name,
          targetCompetitionId: ueclComp.id,
          targetCompetitionName: ueclComp.name,
          clubId: row.clubId,
          clubName: row.clubName,
          ownerUserId,
          rank: row.position,
          reason
        });
        const partId = `part-${ueclComp.id}-${row.clubId}`;
        if (!existingPartIds.has(partId)) {
          newParticipants.push({
            id: partId,
            competitionId: ueclComp.id,
            clubId: row.clubId,
            seasonId,
            ownerUserId: ownerUserId || void 0,
            sourceCompetitionId: league.id,
            sourceCompetitionName: league.name,
            sourcePosition: row.position,
            qualificationReason: reason,
            qualificationTimestamp: now,
            seedNumber: qualifications.length,
            createdAt: now
          });
          existingPartIds.add(partId);
          participantsAdded++;
          if (ownerUserId) {
            notificationsToSend.push({
              userId: ownerUserId,
              title: "Qualified for UEFA Conference League",
              message: `Congratulations! ${row.clubName} finished #${row.position} in ${league.name} and qualified for the UEFA Conference League!`
            });
          }
        }
      }
    }
  }
  if (newParticipants.length > 0) {
    const batch = db.batch();
    for (const part of newParticipants) {
      const ref = db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(part.id);
      batch.set(ref, part);
    }
    await batch.commit();
  }
  await Promise.all(
    notificationsToSend.map(
      (n) => createNotification(n.userId, "QUALIFICATION_CONFIRMED", n.title, n.message).catch(() => {
      })
    )
  );
  await createAuditLog(
    "system",
    "EVALUATE_QUALIFICATIONS",
    "seasons",
    seasonId,
    null,
    { totalQualified: qualifications.length, participantsAdded }
  );
  return {
    success: true,
    qualifications,
    participantsAdded
  };
}

// src/server/routes/admin.routes.ts
init_admin();
init_collections();
var adminRouter = Router9();
adminRouter.use(requireAdmin);
adminRouter.get("/firestore-diagnostics", async (req, res) => {
  try {
    const status = getFirebaseStatus();
    const db = getFirestoreDb();
    const [usersSnap, clubsSnap, occSnap, memSnap, fixSnap, compSnap] = await Promise.all([
      db.collection(COLLECTIONS.USERS).get(),
      db.collection(COLLECTIONS.CLUBS).get(),
      db.collection(COLLECTIONS.CLUB_OCCUPANCIES).get(),
      db.collection(COLLECTIONS.USER_MEMBERSHIPS).get(),
      db.collection(COLLECTIONS.FIXTURES).get(),
      db.collection(COLLECTIONS.COMPETITIONS).get()
    ]);
    res.json({
      projectId: status.projectId,
      databaseId: status.databaseId,
      connected: true,
      authMode: status.authMode,
      collections: {
        users: usersSnap.size,
        clubs: clubsSnap.size,
        club_occupancies: occSnap.size,
        user_memberships: memSnap.size,
        fixtures: fixSnap.size,
        competitions: compSnap.size
      }
    });
  } catch (err) {
    handleFirestoreError(res, err, "GET /api/admin/firestore-diagnostics");
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
  try {
    const users = await getAllAdminUsers();
    res.json({ users });
  } catch (err) {
    handleFirestoreError(res, err, "GET /api/admin/users");
  }
});
adminRouter.get("/disputes", async (req, res) => {
  const status = req.query.status || "OPEN";
  try {
    const disputes = await getDisputes(status);
    res.json({ disputes });
  } catch (err) {
    handleFirestoreError(res, err, "GET /api/admin/disputes");
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
  try {
    const logs = await getAuditLogs(limit);
    res.json({ logs });
  } catch (err) {
    handleFirestoreError(res, err, "GET /api/admin/audit-logs");
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
    const standings = await rebuildCompetitionStandingsFirestore(competitionId);
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

// src/server/app.ts
var dbInitPromise = null;
async function ensureDbReady() {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      try {
        const fbStatus = getFirebaseStatus();
        await initDatabase();
        seedDatabase();
        repairSeason202627Roster();
        console.log(`[BOOT] SQLite baseline ready from: ${getDbFilePath()}`);
        if (fbStatus.isConfigured) {
          try {
            const db = getFirestoreDb();
            const clubsSnap = await db.collection(COLLECTIONS.CLUBS).limit(1).get();
            if (clubsSnap.empty) {
              console.log("[BOOT] Firestore is empty. Auto-seeding from SQLite baseline...");
              await migrateSqliteToFirestore();
              console.log("[BOOT] Firestore auto-seeding completed.");
            } else {
              console.log(`[BOOT] Connected to authoritative Firestore database: ${fbStatus.databaseId}`);
            }
          } catch (fbErr) {
            console.warn("[BOOT] Firestore connection warning, operating with resilient SQLite fallback:", fbErr.message);
          }
        }
      } catch (err) {
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
  app2.use("/api/health", healthRouter);
  app2.use("/api/auth", authRouter);
  app2.use("/api/seasons", seasonsRouter);
  app2.use("/api/leagues", leaguesRouter);
  app2.use("/api/clubs", clubsRouter);
  app2.use("/api/competitions", competitionsRouter);
  app2.use("/api/fixtures", fixturesRouter);
  app2.use("/api/me", meRouter);
  app2.use("/api/admin", adminRouter);
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
    await ensureDbReady();
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

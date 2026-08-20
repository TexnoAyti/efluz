// src/server/app.ts
import express from "express";

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
var dbInstance = null;
var IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
var DEFAULT_DATA_DIR = IS_SERVERLESS ? "/tmp/data" : path.resolve(process.cwd(), "data");
var DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
var DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, "efootball.sqlite");
var SCHEMA_FILE = path.resolve(process.cwd(), "src", "server", "db", "schema.sql");
function getDbFilePath() {
  return DB_FILE;
}
function resolveSqlWasmPath() {
  const modDir = getModuleDir();
  const candidates = [
    // 1. In same directory as compiled serverless handler (e.g., /var/task/api/sql-wasm.wasm)
    path.join(modDir, "sql-wasm.wasm"),
    // 2. In api/ folder relative to project root / task root
    path.resolve(process.cwd(), "api", "sql-wasm.wasm"),
    // 3. In parent directory (e.g. if modDir is /var/task/api, check /var/task/sql-wasm.wasm)
    path.join(modDir, "..", "sql-wasm.wasm"),
    path.join(modDir, "..", "api", "sql-wasm.wasm"),
    path.resolve(process.cwd(), "sql-wasm.wasm"),
    // 4. In dist/ folder
    path.resolve(process.cwd(), "dist", "sql-wasm.wasm"),
    path.join(modDir, "..", "dist", "sql-wasm.wasm"),
    // 5. In public/ folder
    path.resolve(process.cwd(), "public", "sql-wasm.wasm"),
    // 6. In node_modules fallback (local dev or standard node environment)
    path.resolve(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    path.join(modDir, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm")
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
          return candidate;
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
  const wasmBinary = fs.readFileSync(wasmPath);
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
    wasmBinary
  });
  if (fs.existsSync(DB_FILE)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE);
      if (fileBuffer.length > 0) {
        dbInstance = new SQL.Database(fileBuffer);
        dbInstance.exec("SELECT 1");
        console.log(` [DB] path=${DB_FILE}`);
        console.log(" [DB] initialized=true (loaded from disk)");
      } else {
        dbInstance = new SQL.Database();
        console.log(` [DB] path=${DB_FILE}`);
        console.log(" [DB] initialized=true (empty file, initialized new)");
      }
    } catch (err) {
      console.warn(" [DB] Failed to load existing SQLite database or image was malformed, creating fresh one:", err);
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
        dbInstance = new SQL.Database(fileBuffer);
        console.log(` [DB] Loaded bundled database from: ${bundledDbPath}`);
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
    const tempFile = `${DB_FILE}.tmp`;
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
var transactionDepth = 0;
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

// src/server/db/seed.ts
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
    logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/leagues/premier-league.svg"
  },
  {
    id: "league-la-liga",
    name: "La Liga",
    country: "Spain",
    tier: 1,
    logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/leagues/laliga.svg"
  },
  {
    id: "league-serie-a",
    name: "Serie A",
    country: "Italy",
    tier: 1,
    logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/leagues/serie-a.svg"
  },
  {
    id: "league-bundesliga",
    name: "Bundesliga",
    country: "Germany",
    tier: 1,
    logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/leagues/bundesliga.svg"
  },
  {
    id: "league-ligue-1",
    name: "Ligue 1",
    country: "France",
    tier: 1,
    logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/leagues/ligue-1.svg"
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
  { id: "club-coventry", name: "Coventry City", shortName: "COV", country: "England", leagueId: "league-premier-league", logoUrl: "https://resources.premierleague.com/premierleague/badges/t83.svg" },
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
  { id: "club-alaves", name: "Deportivo Alav\xE9s", shortName: "ALA", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/alaves.svg" },
  { id: "club-athletic-club", name: "Athletic Club", shortName: "ATH", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/athletic-club.svg" },
  { id: "club-atletico-madrid", name: "Atl\xE9tico de Madrid", shortName: "ATM", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/atletico-madrid.svg" },
  { id: "club-barcelona", name: "FC Barcelona", shortName: "BAR", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/barcelona.svg" },
  { id: "club-celta-vigo", name: "RC Celta", shortName: "CEL", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/celta.svg" },
  { id: "club-deportivo-la-coruna", name: "Deportivo La Coru\xF1a", shortName: "DEP", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/deportivo-la-coruna.svg" },
  { id: "club-getafe", name: "Getafe CF", shortName: "GET", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/getafe.svg" },
  { id: "club-girona", name: "Girona FC", shortName: "GIR", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/girona.svg" },
  { id: "club-las-palmas", name: "UD Las Palmas", shortName: "LPA", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/las-palmas.svg" },
  { id: "club-malaga", name: "M\xE1laga CF", shortName: "MCF", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/malaga.svg" },
  { id: "club-mallorca", name: "RCD Mallorca", shortName: "MLL", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/mallorca.svg" },
  { id: "club-osasuna", name: "CA Osasuna", shortName: "OSA", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/osasuna.svg" },
  { id: "club-racing-santander", name: "Racing Santander", shortName: "RAC", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/racing-santander.svg" },
  { id: "club-rayo-vallecano", name: "Rayo Vallecano", shortName: "RAY", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/rayo-vallecano.svg" },
  { id: "club-real-betis", name: "Real Betis", shortName: "BET", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/real-betis.svg" },
  { id: "club-real-madrid", name: "Real Madrid", shortName: "RMA", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/real-madrid.svg" },
  { id: "club-real-sociedad", name: "Real Sociedad", shortName: "RSO", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/real-sociedad.svg" },
  { id: "club-sevilla", name: "Sevilla FC", shortName: "SEV", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/sevilla.svg" },
  { id: "club-valencia", name: "Valencia CF", shortName: "VAL", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/valencia.svg" },
  { id: "club-villarreal", name: "Villarreal CF", shortName: "VIL", country: "Spain", leagueId: "league-la-liga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/villarreal.svg" },
  // --- SERIE A (20 CLUBS - 2026/27) ---
  { id: "club-atalanta", name: "Atalanta", shortName: "ATA", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/atalanta.svg" },
  { id: "club-bologna", name: "Bologna FC", shortName: "BOL", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/bologna.svg" },
  { id: "club-cagliari", name: "Cagliari Calcio", shortName: "CAG", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/cagliari.svg" },
  { id: "club-empoli", name: "Empoli FC", shortName: "EMP", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/empoli.svg" },
  { id: "club-fiorentina", name: "ACF Fiorentina", shortName: "FIO", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/fiorentina.svg" },
  { id: "club-frosinone", name: "Frosinone", shortName: "FRO", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/frosinone.svg" },
  { id: "club-genoa", name: "Genoa CFC", shortName: "GEN", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/genoa.svg" },
  { id: "club-inter", name: "Inter Milan", shortName: "INT", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/inter.svg" },
  { id: "club-juventus", name: "Juventus", shortName: "JUV", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/juventus.svg" },
  { id: "club-lazio", name: "SS Lazio", shortName: "LAZ", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/lazio.svg" },
  { id: "club-lecce", name: "US Lecce", shortName: "LEC", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/lecce.svg" },
  { id: "club-milan", name: "AC Milan", shortName: "MIL", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/milan.svg" },
  { id: "club-monza", name: "Monza", shortName: "MON", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/monza.svg" },
  { id: "club-napoli", name: "SSC Napoli", shortName: "NAP", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/napoli.svg" },
  { id: "club-parma", name: "Parma Calcio", shortName: "PAR", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/parma.svg" },
  { id: "club-roma", name: "AS Roma", shortName: "ROM", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/roma.svg" },
  { id: "club-torino", name: "Torino FC", shortName: "TOR", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/torino.svg" },
  { id: "club-udinese", name: "Udinese Calcio", shortName: "UDI", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/udinese.svg" },
  { id: "club-venezia", name: "Venezia", shortName: "VEN", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/venezia.svg" },
  { id: "club-verona", name: "Hellas Verona", shortName: "VER", country: "Italy", leagueId: "league-serie-a", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/verona.svg" },
  // --- BUNDESLIGA (18 CLUBS - 2026/27) ---
  { id: "club-augsburg", name: "FC Augsburg", shortName: "FCA", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/augsburg.svg" },
  { id: "club-bayern", name: "FC Bayern M\xFCnchen", shortName: "FCB", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/bayern.svg" },
  { id: "club-bochum", name: "VfL Bochum", shortName: "BOC", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/bochum.svg" },
  { id: "club-dortmund", name: "Borussia Dortmund", shortName: "BVB", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/dortmund.svg" },
  { id: "club-eintracht-frankfurt", name: "Eintracht Frankfurt", shortName: "SGE", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/frankfurt.svg" },
  { id: "club-freiburg", name: "SC Freiburg", shortName: "SCF", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/freiburg.svg" },
  { id: "club-gladbach", name: "Borussia M\xF6nchengladbach", shortName: "BMG", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/gladbach.svg" },
  { id: "club-heidenheim", name: "1. FC Heidenheim", shortName: "HDH", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/heidenheim.svg" },
  { id: "club-hoffenheim", name: "TSG Hoffenheim", shortName: "TSG", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/hoffenheim.svg" },
  { id: "club-holstein-kiel", name: "Holstein Kiel", shortName: "KSV", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/holstein-kiel.svg" },
  { id: "club-leipzig", name: "RB Leipzig", shortName: "RBL", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/leipzig.svg" },
  { id: "club-leverkusen", name: "Bayer 04 Leverkusen", shortName: "B04", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/leverkusen.svg" },
  { id: "club-mainz", name: "1. FSV Mainz 05", shortName: "M05", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/mainz.svg" },
  { id: "club-st-pauli", name: "FC St. Pauli", shortName: "STP", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/st-pauli.svg" },
  { id: "club-stuttgart", name: "VfB Stuttgart", shortName: "VFB", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/stuttgart.svg" },
  { id: "club-union-berlin", name: "1. FC Union Berlin", shortName: "FCU", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/union-berlin.svg" },
  { id: "club-werder-bremen", name: "SV Werder Bremen", shortName: "SVW", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/bremen.svg" },
  { id: "club-wolfsburg", name: "VfL Wolfsburg", shortName: "WOB", country: "Germany", leagueId: "league-bundesliga", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/wolfsburg.svg" },
  // --- LIGUE 1 (18 CLUBS - 2026/27) ---
  { id: "club-auxerre", name: "AJ Auxerre", shortName: "AJA", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/auxerre.svg" },
  { id: "club-brest", name: "Stade Brestois 29", shortName: "SB29", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/brest.svg" },
  { id: "club-le-mans", name: "Le Mans FC", shortName: "LMFC", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/le-mans.svg" },
  { id: "club-lens", name: "RC Lens", shortName: "RCL", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/lens.svg" },
  { id: "club-lille", name: "LOSC Lille", shortName: "LOSC", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/lille.svg" },
  { id: "club-lyon", name: "Olympique Lyonnais", shortName: "OL", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/lyon.svg" },
  { id: "club-marseille", name: "Olympique de Marseille", shortName: "OM", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/marseille.svg" },
  { id: "club-monaco", name: "AS Monaco", shortName: "ASM", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/monaco.svg" },
  { id: "club-montpellier", name: "Montpellier HSC", shortName: "MHSC", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/montpellier.svg" },
  { id: "club-nantes", name: "FC Nantes", shortName: "FCN", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/nantes.svg" },
  { id: "club-nice", name: "OGC Nice", shortName: "OGCN", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/nice.svg" },
  { id: "club-paris-fc", name: "Paris FC", shortName: "PFC", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/paris-fc.svg" },
  { id: "club-psg", name: "Paris Saint-Germain", shortName: "PSG", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/psg.svg" },
  { id: "club-reims", name: "Stade de Reims", shortName: "SDR", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/reims.svg" },
  { id: "club-rennes", name: "Stade Rennais FC", shortName: "SRFC", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/rennes.svg" },
  { id: "club-strasbourg", name: "RC Strasbourg Alsace", shortName: "RCSA", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/strasbourg.svg" },
  { id: "club-toulouse", name: "Toulouse FC", shortName: "TFC", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/toulouse.svg" },
  { id: "club-troyes", name: "ESTAC Troyes", shortName: "TRO", country: "France", leagueId: "league-ligue-1", logoUrl: "https://cdn.jsdelivr.net/gh/footbally/assets/logos/teams/troyes.svg" }
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
  {
    id: "comp-trophee-des-champions-2026",
    seasonId: "season-2026-27",
    leagueId: "league-ligue-1",
    name: "Troph\xE9e des Champions",
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
    console.log(
      ` [REPAIR] 2026/27 Roster repaired: ${activatedClubs} clubs activated, ${deactivatedClubs} stale clubs deactivated.`
    );
    return { activatedClubs, deactivatedClubs, totalActive: activatedClubs };
  });
}

// src/server/auth/telegramAuth.ts
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
function getOrCreateTelegramUser(tgUser) {
  const telegramId = String(tgUser.id);
  const username = tgUser.username || `tg_${telegramId}`;
  const firstName = tgUser.first_name || "Player";
  const lastName = tgUser.last_name || "";
  const photoUrl = tgUser.photo_url || "";
  const adminIds = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((s) => s.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
  const isAdmin = adminIds.includes(telegramId.toLowerCase()) || Boolean(username) && adminIds.includes(username.toLowerCase()) ? 1 : 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let existing = queryGet("SELECT * FROM users WHERE telegram_id = ?", [telegramId]);
  if (!existing) {
    const newId = `user-${telegramId}`;
    queryRun(
      "INSERT INTO users (id, telegram_id, username, first_name, last_name, photo_url, is_admin, is_suspended, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
      [newId, telegramId, username, firstName, lastName, photoUrl, isAdmin, now, now]
    );
    existing = queryGet("SELECT * FROM users WHERE telegram_id = ?", [telegramId]);
  } else {
    queryRun(
      "UPDATE users SET username = ?, first_name = ?, last_name = ?, photo_url = ?, is_admin = CASE WHEN is_admin = 1 THEN 1 ELSE ? END, updated_at = ? WHERE telegram_id = ?",
      [username, firstName, lastName, photoUrl, isAdmin, now, telegramId]
    );
    existing = queryGet("SELECT * FROM users WHERE telegram_id = ?", [telegramId]);
  }
  return {
    id: existing.id,
    telegramId: existing.telegram_id,
    username: existing.username,
    firstName: existing.first_name,
    lastName: existing.last_name,
    photoUrl: existing.photo_url,
    isAdmin: Boolean(existing.is_admin),
    isSuspended: Boolean(existing.is_suspended),
    createdAt: existing.created_at,
    updatedAt: existing.updated_at
  };
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
function getOrCreateDevUser(devUserId) {
  const isDevAuthEnabled = process.env.ENABLE_DEV_AUTH === "true" || process.env.NODE_ENV !== "production";
  if (!isDevAuthEnabled) {
    throw new Error("Development sandbox authentication is disabled in production.");
  }
  const profile = DEV_PROFILES.find((p) => p.id === devUserId || p.username === devUserId) || DEV_PROFILES[0];
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let existing = queryGet("SELECT * FROM users WHERE telegram_id = ?", [profile.telegramId]);
  if (!existing) {
    queryRun(
      'INSERT INTO users (id, telegram_id, username, first_name, last_name, photo_url, is_admin, is_suspended, created_at, updated_at) VALUES (?, ?, ?, ?, ?, "", ?, 0, ?, ?)',
      [profile.id, profile.telegramId, profile.username, profile.firstName, profile.lastName, profile.isAdmin ? 1 : 0, now, now]
    );
    existing = queryGet("SELECT * FROM users WHERE telegram_id = ?", [profile.telegramId]);
  }
  return {
    id: existing.id,
    telegramId: existing.telegram_id,
    username: existing.username,
    firstName: existing.first_name,
    lastName: existing.last_name,
    photoUrl: existing.photo_url,
    isAdmin: Boolean(existing.is_admin),
    isSuspended: Boolean(existing.is_suspended),
    createdAt: existing.created_at,
    updatedAt: existing.updated_at
  };
}

// src/server/middleware/authMiddleware.ts
function authMiddleware(req, res, next) {
  const isDev = process.env.ENABLE_DEV_AUTH === "true" || process.env.NODE_ENV !== "production";
  const initData = req.headers["x-telegram-init-data"] || req.query.initData;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (initData) {
    if (botToken) {
      const verifyResult = verifyTelegramWebAppData(initData, botToken);
      if (verifyResult.isValid && verifyResult.user) {
        req.user = getOrCreateTelegramUser(verifyResult.user);
        return next();
      }
    } else if (isDev) {
      try {
        const urlParams = new URLSearchParams(initData);
        const userRaw = urlParams.get("user");
        if (userRaw) {
          const parsed = JSON.parse(userRaw);
          req.user = getOrCreateTelegramUser(parsed);
          return next();
        }
      } catch {
      }
    }
  }
  const devUserId = req.headers["x-dev-user-id"];
  if (isDev && devUserId) {
    try {
      const user = getOrCreateDevUser(devUserId);
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

// src/server/routes/health.routes.ts
import { Router } from "express";
var healthRouter = Router();
healthRouter.get("/", (req, res) => {
  try {
    const db = getDb();
    const result = db.exec("SELECT 1 as alive;");
    res.json({
      status: "ok",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      database: result.length > 0 ? "connected" : "error",
      version: "1.0.0"
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
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

// src/server/services/clubService.ts
var ClubConflictError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ClubConflictError";
  }
};
var ClubNotFoundError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ClubNotFoundError";
  }
};
function getClubsByLeague(leagueId, seasonId) {
  const clubs = queryAll(
    `SELECT
        c.*,
        l.id AS league_id,
        l.name AS league_name,
        slc.season_id,
        slc.is_active,
        u.username AS owner_username,
        u.first_name AS owner_first_name,
        cm.user_id AS owner_user_id,
        cm.claimed_at
    FROM season_league_clubs slc
    JOIN clubs c
        ON c.id = slc.club_id
    JOIN leagues l
        ON l.id = slc.league_id
    LEFT JOIN club_memberships cm
        ON cm.club_id = c.id
        AND cm.season_id = slc.season_id
        AND cm.status = 'active'
    LEFT JOIN users u
        ON u.id = cm.user_id
    WHERE
        slc.season_id = ?
        AND slc.league_id = ?
        AND slc.is_active = 1
    ORDER BY c.name;`,
    [seasonId, leagueId]
  );
  return clubs.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.short_name,
    country: c.country,
    leagueId: c.league_id,
    leagueName: c.league_name,
    logoUrl: c.logo_url,
    active: Boolean(c.active),
    claimedByUserId: c.owner_user_id || null,
    claimedByUsername: c.owner_username || null,
    owner: c.owner_user_id ? {
      userId: c.owner_user_id,
      username: c.owner_username || "Unknown",
      firstName: c.owner_first_name || "Player",
      claimedAt: c.claimed_at
    } : null,
    createdAt: c.created_at
  }));
}
function getClubById(clubId, seasonId) {
  const c = queryGet(
    `SELECT c.*,
            l.id as league_id,
            l.name as league_name,
            cm.user_id as owner_user_id,
            u.username as owner_username,
            u.first_name as owner_first_name,
            cm.claimed_at
     FROM clubs c
     LEFT JOIN leagues l ON c.league_id = l.id
     LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = ? AND cm.status = 'active'
     LEFT JOIN users u ON cm.user_id = u.id
     WHERE c.id = ?`,
    [seasonId, clubId]
  );
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    shortName: c.short_name,
    country: c.country,
    leagueId: c.league_id,
    logoUrl: c.logo_url,
    active: Boolean(c.active),
    claimedByUserId: c.owner_user_id || null,
    claimedByUsername: c.owner_username || null,
    owner: c.owner_user_id ? {
      userId: c.owner_user_id,
      username: c.owner_username || "Unknown",
      firstName: c.owner_first_name || "Player",
      claimedAt: c.claimed_at
    } : null,
    createdAt: c.created_at
  };
}
function getUserActiveClub(userId, seasonId) {
  const membership = queryGet(
    'SELECT club_id FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = "active"',
    [userId, seasonId]
  );
  if (!membership) return null;
  return getClubById(membership.club_id, seasonId);
}
function claimClubAtomic(userId, clubId, seasonId) {
  return dbTransaction(() => {
    const club = queryGet(
      `SELECT c.id, c.name 
       FROM season_league_clubs slc
       JOIN clubs c ON slc.club_id = c.id
       WHERE slc.club_id = ? AND slc.season_id = ? AND slc.is_active = 1`,
      [clubId, seasonId]
    );
    if (!club) {
      throw new ClubNotFoundError(`Club with ID '${clubId}' is not an active top-flight club in season '${seasonId}'.`);
    }
    const existingUserClub = queryGet(
      `SELECT cm.club_id, c.name
       FROM club_memberships cm
       JOIN clubs c ON cm.club_id = c.id
       WHERE cm.user_id = ? AND cm.season_id = ? AND cm.status = 'active'`,
      [userId, seasonId]
    );
    if (existingUserClub) {
      if (existingUserClub.club_id === clubId) {
        const fullClub2 = getClubById(clubId, seasonId);
        return { success: true, club: fullClub2 };
      }
      throw new ClubConflictError(`You already own '${existingUserClub.name}' in this season.`);
    }
    const existingOwner = queryGet(
      `SELECT cm.user_id, u.username
       FROM club_memberships cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.club_id = ? AND cm.season_id = ? AND cm.status = 'active'`,
      [clubId, seasonId]
    );
    if (existingOwner) {
      throw new ClubConflictError(
        `'${club.name}' has already been claimed by @${existingOwner.username || "another player"}.`
      );
    }
    const membershipId = `cm-${seasonId}-${clubId}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      queryRun(
        'INSERT INTO club_memberships (id, season_id, club_id, user_id, claimed_at, status) VALUES (?, ?, ?, ?, ?, "active")',
        [membershipId, seasonId, clubId, userId, now]
      );
    } catch (err) {
      if (err.message && err.message.includes("UNIQUE constraint failed")) {
        throw new ClubConflictError(`'${club.name}' has just been claimed by another player.`);
      }
      throw err;
    }
    const fullClub = getClubById(clubId, seasonId);
    return { success: true, club: fullClub };
  });
}

// src/server/routes/auth.routes.ts
var authRouter = Router2();
var telegramAuthSchema = z.object({
  initData: z.string().min(1, "initData is required")
});
var devAuthSchema = z.object({
  devUserId: z.string().min(1, "devUserId is required")
});
authRouter.post("/telegram", validateBody(telegramAuthSchema), (req, res) => {
  const { initData } = req.body;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    if (process.env.ENABLE_DEV_AUTH === "true" || process.env.NODE_ENV !== "production") {
      try {
        const urlParams = new URLSearchParams(initData);
        const userRaw = urlParams.get("user");
        if (userRaw) {
          const user2 = getOrCreateTelegramUser(JSON.parse(userRaw));
          const currentClub2 = getUserActiveClub(user2.id, "season-2026-27");
          console.log(`[TELEGRAM AUTH - DEV SANDBOX] user=${user2.username} (id: ${user2.telegramId}), isAdmin=${user2.isAdmin}`);
          res.json({ success: true, user: user2, currentClub: currentClub2 });
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
  const user = getOrCreateTelegramUser(verifyResult.user);
  const currentClub = getUserActiveClub(user.id, "season-2026-27");
  console.log(`[TELEGRAM AUTH]
initData received: YES
parsed user id: ${verifyResult.user.id}
username: ${verifyResult.user.username || "(none)"}
auth_date valid: ${verifyResult.authDate ? "YES" : "NO"}
HMAC valid: YES
internal user: ${user.id}
isAdmin: ${user.isAdmin ? "YES" : "NO"}`);
  res.json({ success: true, user, currentClub });
});
authRouter.post("/dev", validateBody(devAuthSchema), (req, res) => {
  const isDev = process.env.ENABLE_DEV_AUTH === "true" || process.env.NODE_ENV !== "production";
  if (!isDev) {
    res.status(403).json({ error: "Dev auth is disabled in production." });
    return;
  }
  try {
    const user = getOrCreateDevUser(req.body.devUserId);
    const currentClub = getUserActiveClub(user.id, "season-2026-27");
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
import { Router as Router3 } from "express";
var seasonsRouter = Router3();
seasonsRouter.get("/", (req, res) => {
  const rows = queryAll("SELECT * FROM seasons ORDER BY start_date DESC");
  const seasons = rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    startDate: r.start_date,
    endDate: r.end_date,
    createdAt: r.created_at
  }));
  res.json({ seasons });
});
seasonsRouter.get("/:id", (req, res) => {
  const row = queryGet("SELECT * FROM seasons WHERE id = ?", [req.params.id]);
  if (!row) {
    res.status(404).json({ error: "Season not found" });
    return;
  }
  const season = {
    id: row.id,
    name: row.name,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at
  };
  res.json({ season });
});

// src/server/routes/leagues.routes.ts
import { Router as Router4 } from "express";
var leaguesRouter = Router4();
leaguesRouter.get("/", (req, res) => {
  const seasonId = req.query.seasonId || "season-2026-27";
  const rows = queryAll(
    `SELECT l.*, COUNT(slc.club_id) as total_clubs
     FROM leagues l
     LEFT JOIN season_league_clubs slc ON l.id = slc.league_id AND slc.season_id = ? AND slc.is_active = 1
     GROUP BY l.id
     ORDER BY l.tier ASC, l.name ASC`,
    [seasonId]
  );
  const leagues = rows.map((r) => ({
    id: r.id,
    name: r.name,
    country: r.country,
    tier: r.tier,
    logoUrl: r.logo_url,
    totalClubs: Number(r.total_clubs) || 0,
    createdAt: r.created_at
  }));
  res.json({ leagues });
});
var LEAGUE_ID_ALIASES = {
  "league-epl": "league-premier-league",
  "league-laliga": "league-la-liga",
  "league-seriea": "league-serie-a",
  "league-ligue1": "league-ligue-1"
};
function resolveLeagueId(id) {
  return LEAGUE_ID_ALIASES[id] || id;
}
leaguesRouter.get("/:id", (req, res) => {
  const leagueId = resolveLeagueId(req.params.id);
  const row = queryGet("SELECT * FROM leagues WHERE id = ?", [leagueId]);
  if (!row) {
    res.status(404).json({ error: "League not found" });
    return;
  }
  const league = {
    id: row.id,
    name: row.name,
    country: row.country,
    tier: row.tier,
    logoUrl: row.logo_url,
    createdAt: row.created_at
  };
  res.json({ league });
});
leaguesRouter.get("/:id/clubs", (req, res) => {
  const seasonId = req.query.seasonId || "season-2026-27";
  const leagueId = resolveLeagueId(req.params.id);
  const clubs = getClubsByLeague(leagueId, seasonId);
  console.log(`[LEAGUE CLUBS]`);
  console.log(`season=${seasonId}`);
  console.log(`league=${leagueId}`);
  console.log(`count=${clubs.length}`);
  res.json({ clubs });
});

// src/server/routes/clubs.routes.ts
import { Router as Router5 } from "express";
var clubsRouter = Router5();
clubsRouter.get("/:id", (req, res) => {
  const seasonId = req.query.seasonId || "season-2026-27";
  const club = getClubById(req.params.id, seasonId);
  if (!club) {
    res.status(404).json({ error: "Club not found" });
    return;
  }
  res.json({ club });
});
clubsRouter.post("/:id/claim", requireAuth, (req, res) => {
  const seasonId = req.body.seasonId || "season-2026-27";
  const userId = req.user.id;
  const clubId = req.params.id;
  try {
    const result = claimClubAtomic(userId, clubId, seasonId);
    res.json({
      success: true,
      message: `Successfully claimed ${result.club.name}!`,
      club: result.club
    });
  } catch (err) {
    if (err instanceof ClubConflictError) {
      res.status(409).json({
        error: "Conflict",
        message: err.message
      });
      return;
    }
    if (err instanceof ClubNotFoundError) {
      res.status(404).json({
        error: "Not Found",
        message: err.message
      });
      return;
    }
    console.error("Error claiming club:", err);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to claim club." });
  }
});

// src/server/routes/competitions.routes.ts
import { Router as Router6 } from "express";

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

// src/server/tournament/fixtureEngine.ts
function generateRoundRobinSchedule(clubIds, options = {}) {
  const homeAndAway = options.homeAndAway !== false;
  const list = [...clubIds];
  let hasBye = false;
  if (list.length % 2 !== 0) {
    list.push("__BYE__");
    hasBye = true;
  }
  const n = list.length;
  const numRounds = n - 1;
  const matchesPerRound = n / 2;
  const firstLegMatchups = [];
  const rotatingTeams = list.slice(1);
  for (let round = 0; round < numRounds; round++) {
    const matchday = round + 1;
    const roundTeams = [list[0], ...rotatingTeams];
    for (let match = 0; match < matchesPerRound; match++) {
      let teamA = roundTeams[match];
      let teamB = roundTeams[n - 1 - match];
      if (teamA === "__BYE__" || teamB === "__BYE__") {
        continue;
      }
      let home = teamA;
      let away = teamB;
      if (match === 0) {
        if (round % 2 === 1) {
          home = teamB;
          away = teamA;
        }
      } else {
        if ((round + match) % 2 === 1) {
          home = teamB;
          away = teamA;
        }
      }
      firstLegMatchups.push({
        matchday,
        homeClubId: home,
        awayClubId: away
      });
    }
    const last = rotatingTeams.pop();
    rotatingTeams.unshift(last);
  }
  if (!homeAndAway) {
    return firstLegMatchups;
  }
  const secondLegMatchups = [];
  for (const match of firstLegMatchups) {
    secondLegMatchups.push({
      matchday: match.matchday + numRounds,
      homeClubId: match.awayClubId,
      // Invert home/away
      awayClubId: match.homeClubId
    });
  }
  return [...firstLegMatchups, ...secondLegMatchups];
}
function generateUCL24LeaguePhaseSchedule(clubIds, options = {}) {
  if (clubIds.length !== 24) {
    throw new Error(`UCL 24-team league phase requires exactly 24 clubs (received ${clubIds.length}).`);
  }
  const n = 24;
  const numRounds = 8;
  const roundPairs = [];
  for (let r = 0; r < numRounds; r++) {
    const pairs = [];
    pairs.push([23, r]);
    for (let i = 1; i <= 11; i++) {
      const u = (r + i) % 23;
      const v = (r - i + 23) % 23;
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
function calculateMatchdayDate(seasonStartDate, matchday, daysInterval = 7) {
  const base = new Date(seasonStartDate);
  if (isNaN(base.getTime())) {
    return (/* @__PURE__ */ new Date()).toISOString();
  }
  const matchDate = new Date(base.getTime() + (matchday - 1) * daysInterval * 24 * 60 * 60 * 1e3);
  matchDate.setUTCHours(15, 0, 0, 0);
  return matchDate.toISOString();
}

// src/server/services/notificationService.ts
function createNotification(userId, type, title, message, data) {
  const id = `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const dataJson = data ? JSON.stringify(data) : null;
  queryRun(
    "INSERT INTO notifications (id, user_id, type, title, message, data_json, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
    [id, userId, type, title, message, dataJson, now]
  );
}
function getUserNotifications(userId, limit = 20) {
  const rows = queryAll(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    [userId, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    type: r.type,
    title: r.title,
    message: r.message,
    data: r.data_json ? JSON.parse(r.data_json) : void 0,
    isRead: Boolean(r.is_read),
    createdAt: r.created_at
  }));
}
function markNotificationsAsRead(userId) {
  queryRun("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [userId]);
}

// src/server/services/adminService.ts
function createAuditLog(actorUserId, action, entityType, entityId, oldValue, newValue, ipAddress) {
  const actor = queryGet("SELECT username FROM users WHERE id = ?", [actorUserId]);
  const actorUsername = actor?.username || "admin";
  const id = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  queryRun(
    `INSERT INTO audit_logs (id, actor_user_id, actor_username, action, entity_type, entity_id, old_value_json, new_value_json, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      actorUserId,
      actorUsername,
      action,
      entityType,
      entityId,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      ipAddress || null,
      now
    ]
  );
}
function getDisputes(status = "OPEN") {
  const rows = queryAll(
    `SELECT d.*,
            f.competition_id, f.matchday, f.home_club_id, f.away_club_id, f.scheduled_at, f.status as fixture_status,
            hs.id as hs_id, hs.home_score as hs_home, hs.away_score as hs_away, hs.proof_url as hs_proof, hs.submitted_by_user_id as hs_user_id, hs.created_at as hs_created,
            asub.id as as_id, asub.home_score as as_home, asub.away_score as as_away, asub.proof_url as as_proof, asub.submitted_by_user_id as as_user_id, asub.created_at as as_created
     FROM disputes d
     JOIN fixtures f ON d.fixture_id = f.id
     LEFT JOIN result_submissions hs ON d.home_submission_id = hs.id
     LEFT JOIN result_submissions asub ON d.away_submission_id = asub.id
     WHERE d.status = ?
     ORDER BY d.created_at DESC`,
    [status]
  );
  return rows.map((r) => ({
    id: r.id,
    fixtureId: r.fixture_id,
    seasonId: r.season_id,
    status: r.status,
    resolvedByUserId: r.resolved_by_user_id || void 0,
    resolutionNotes: r.resolution_notes || void 0,
    resolvedAt: r.resolved_at || void 0,
    createdAt: r.created_at,
    fixture: getFixtureById(r.fixture_id) || void 0,
    homeSubmission: r.hs_id ? {
      id: r.hs_id,
      fixtureId: r.fixture_id,
      submittedByUserId: r.hs_user_id,
      clubId: r.home_club_id,
      homeScore: r.hs_home,
      awayScore: r.hs_away,
      proofUrl: r.hs_proof || void 0,
      createdAt: r.hs_created
    } : void 0,
    awaySubmission: r.as_id ? {
      id: r.as_id,
      fixtureId: r.fixture_id,
      submittedByUserId: r.as_user_id,
      clubId: r.away_club_id,
      homeScore: r.as_home,
      awayScore: r.as_away,
      proofUrl: r.as_proof || void 0,
      createdAt: r.as_created
    } : void 0
  }));
}
function resolveDispute(adminUserId, disputeId, params) {
  return dbTransaction(() => {
    const dispute = queryGet("SELECT * FROM disputes WHERE id = ?", [disputeId]);
    if (!dispute) {
      throw new Error(`Dispute with ID '${disputeId}' not found.`);
    }
    const fixture = queryGet("SELECT * FROM fixtures WHERE id = ?", [dispute.fixture_id]);
    if (!fixture) {
      throw new Error(`Fixture '${dispute.fixture_id}' not found.`);
    }
    const submissions = queryAll("SELECT * FROM result_submissions WHERE fixture_id = ?", [dispute.fixture_id]);
    const homeSub = submissions.find((s) => s.club_id === fixture.home_club_id);
    const awaySub = submissions.find((s) => s.club_id === fixture.away_club_id);
    let finalHomeScore = 0;
    let finalAwayScore = 0;
    let finalStatus = "CONFIRMED";
    let winnerClubId = null;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (params.action === "CONFIRM_HOME_SUBMISSION") {
      if (!homeSub) throw new Error("Home submission not found.");
      finalHomeScore = homeSub.home_score;
      finalAwayScore = homeSub.away_score;
    } else if (params.action === "CONFIRM_AWAY_SUBMISSION") {
      if (!awaySub) throw new Error("Away submission not found.");
      finalHomeScore = awaySub.home_score;
      finalAwayScore = awaySub.away_score;
    } else if (params.action === "MANUAL_SCORE") {
      if (params.manualHomeScore === void 0 || params.manualAwayScore === void 0) {
        throw new Error("Manual scores must be provided.");
      }
      finalHomeScore = params.manualHomeScore;
      finalAwayScore = params.manualAwayScore;
    } else if (params.action === "CANCEL_MATCH") {
      finalStatus = "CANCELLED";
    }
    if (finalStatus === "CONFIRMED") {
      if (finalHomeScore > finalAwayScore) winnerClubId = fixture.home_club_id;
      else if (finalAwayScore > finalHomeScore) winnerClubId = fixture.away_club_id;
    }
    queryRun(
      `UPDATE fixtures SET
        status = ?,
        home_score = ?,
        away_score = ?,
        winner_club_id = ?,
        result_confirmed_at = ?,
        updated_at = ?
       WHERE id = ?`,
      [
        finalStatus,
        finalStatus === "CONFIRMED" ? finalHomeScore : null,
        finalStatus === "CONFIRMED" ? finalAwayScore : null,
        winnerClubId,
        finalStatus === "CONFIRMED" ? now : null,
        now,
        fixture.id
      ]
    );
    queryRun(
      `UPDATE disputes SET
        status = 'RESOLVED',
        resolved_by_user_id = ?,
        resolution_notes = ?,
        resolved_at = ?
       WHERE id = ?`,
      [adminUserId, params.notes || `Resolved via ${params.action}`, now, disputeId]
    );
    createAuditLog(
      adminUserId,
      "RESOLVE_DISPUTE",
      "fixtures",
      fixture.id,
      { status: fixture.status, homeScore: fixture.home_score, awayScore: fixture.away_score },
      { status: finalStatus, homeScore: finalHomeScore, awayScore: finalAwayScore, action: params.action, notes: params.notes }
    );
    const homeOwner = queryGet(
      'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
      [fixture.home_club_id, fixture.season_id]
    );
    const awayOwner = queryGet(
      'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
      [fixture.away_club_id, fixture.season_id]
    );
    const message = `Admin resolved match dispute. Final Score: ${finalHomeScore} - ${finalAwayScore}. Status: ${finalStatus}.`;
    if (homeOwner) createNotification(homeOwner.user_id, "DISPUTE_RESOLVED", "Dispute Resolved by Admin", message);
    if (awayOwner) createNotification(awayOwner.user_id, "DISPUTE_RESOLVED", "Dispute Resolved by Admin", message);
    if (finalStatus === "CONFIRMED") {
      advanceKnockoutWinner(fixture.id);
    }
    return {
      success: true,
      dispute: getDisputes("RESOLVED").find((d) => d.id === disputeId) || {}
    };
  });
}
function reopenFixture(adminUserId, fixtureId, notes) {
  return dbTransaction(() => {
    const fixture = queryGet("SELECT * FROM fixtures WHERE id = ?", [fixtureId]);
    if (!fixture) throw new Error(`Fixture '${fixtureId}' not found.`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    queryRun(
      `UPDATE fixtures SET
        status = 'SCHEDULED',
        home_score = NULL,
        away_score = NULL,
        winner_club_id = NULL,
        result_confirmed_at = NULL,
        updated_at = ?
       WHERE id = ?`,
      [now, fixtureId]
    );
    queryRun("DELETE FROM result_submissions WHERE fixture_id = ?", [fixtureId]);
    queryRun('UPDATE disputes SET status = "CANCELLED", resolution_notes = "Fixture reopened by admin" WHERE fixture_id = ?', [fixtureId]);
    createAuditLog(adminUserId, "REOPEN_FIXTURE", "fixtures", fixtureId, fixture, { status: "SCHEDULED", notes });
    return { success: true };
  });
}
function getAllAdminUsers() {
  const rows = queryAll("SELECT * FROM users ORDER BY created_at DESC");
  return rows.map((r) => ({
    id: r.id,
    telegramId: r.telegram_id,
    username: r.username,
    firstName: r.first_name,
    lastName: r.last_name,
    photoUrl: r.photo_url,
    isAdmin: Boolean(r.is_admin),
    isSuspended: Boolean(r.is_suspended),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}
function getAuditLogs(limit = 50) {
  const rows = queryAll("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?", [limit]);
  return rows.map((r) => ({
    id: r.id,
    actorUserId: r.actor_user_id,
    actorUsername: r.actor_username,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    oldValue: r.old_value_json,
    newValue: r.new_value_json,
    ipAddress: r.ip_address,
    createdAt: r.created_at
  }));
}

// src/server/tournament/knockoutEngine.ts
function generateKnockoutBracket(competitionId, options = {}) {
  return dbTransaction(() => {
    const comp = queryGet("SELECT * FROM competitions WHERE id = ?", [competitionId]);
    if (!comp) {
      throw new Error(`Competition '${competitionId}' not found.`);
    }
    const existingFixtures = queryGet(
      "SELECT COUNT(*) as cnt FROM fixtures WHERE competition_id = ?",
      [competitionId]
    );
    if (existingFixtures && existingFixtures.cnt > 0) {
      return { generated: existingFixtures.cnt, rounds: 0 };
    }
    let clubIds = options.participants;
    if (!clubIds || clubIds.length === 0) {
      const parts = queryAll(
        "SELECT club_id FROM competition_participants WHERE competition_id = ? ORDER BY seed_number ASC",
        [competitionId]
      );
      clubIds = parts.map((p) => p.club_id);
    }
    if (clubIds.length === 0 && comp.league_id) {
      const leagueClubs = queryAll(
        `SELECT slc.club_id 
         FROM season_league_clubs slc 
         JOIN clubs c ON slc.club_id = c.id
         WHERE slc.league_id = ? AND slc.season_id = ? AND slc.is_active = 1 
         ORDER BY c.name ASC`,
        [comp.league_id, comp.season_id]
      );
      clubIds = leagueClubs.map((c) => c.club_id);
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
    const firstRoundMatches = bracketSize / 2;
    for (let i = 0; i < firstRoundMatches; i++) {
      const homeClubId = clubIds[i * 2] || null;
      const awayClubId = clubIds[i * 2 + 1] || null;
      const fixtureId = `fix-${competitionId}-r1-m${i}`;
      const roundName = getRoundName(1);
      queryRun(
        `INSERT INTO fixtures (
          id, season_id, competition_id, matchday, round_name,
          home_club_id, away_club_id, scheduled_at, status,
          home_score, away_score, winner_club_id, result_confirmed_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'SCHEDULED', NULL, NULL, NULL, NULL, ?, ?)`,
        [
          fixtureId,
          comp.season_id,
          competitionId,
          roundName,
          homeClubId || "TBD",
          awayClubId || "TBD",
          now,
          now,
          now
        ]
      );
      totalGenerated++;
    }
    for (let round = 2; round <= totalRounds; round++) {
      const matchesInRound = Math.pow(2, totalRounds - round);
      const roundName = getRoundName(round);
      for (let m = 0; m < matchesInRound; m++) {
        const fixtureId = `fix-${competitionId}-r${round}-m${m}`;
        queryRun(
          `INSERT INTO fixtures (
            id, season_id, competition_id, matchday, round_name,
            home_club_id, away_club_id, scheduled_at, status,
            home_score, away_score, winner_club_id, result_confirmed_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'TBD', 'TBD', ?, 'SCHEDULED', NULL, NULL, NULL, NULL, ?, ?)`,
          [
            fixtureId,
            comp.season_id,
            competitionId,
            round,
            roundName,
            now,
            now,
            now
          ]
        );
        totalGenerated++;
      }
    }
    queryRun('UPDATE competitions SET status = "active" WHERE id = ?', [competitionId]);
    return { generated: totalGenerated, rounds: totalRounds };
  });
}
function advanceKnockoutWinner(fixtureId) {
  return dbTransaction(() => {
    const fixture = queryGet("SELECT * FROM fixtures WHERE id = ?", [fixtureId]);
    if (!fixture || fixture.status !== "CONFIRMED" || !fixture.winner_club_id) {
      return { advanced: false };
    }
    const comp = queryGet("SELECT * FROM competitions WHERE id = ?", [fixture.competition_id]);
    if (!comp || comp.type !== "KNOCKOUT" && comp.type !== "SUPER_CUP" && comp.type !== "EUROPEAN_KNOCKOUT") {
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
    const nextFixture = queryGet("SELECT * FROM fixtures WHERE id = ?", [nextFixtureId]);
    if (!nextFixture) {
      const championClub = queryGet("SELECT * FROM clubs WHERE id = ?", [fixture.winner_club_id]);
      if (championClub) {
        createAuditLog(
          "system",
          "TOURNAMENT_CHAMPION_CROWNED",
          "competitions",
          comp.id,
          null,
          { championClubId: championClub.id, championName: championClub.name }
        );
        const owner = queryGet(
          'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
          [championClub.id, comp.season_id]
        );
        if (owner) {
          createNotification(
            owner.user_id,
            "TOURNAMENT_CHAMPION",
            `\u{1F3C6} Champion of ${comp.name}!`,
            `Congratulations! ${championClub.name} has won the ${comp.name} title!`
          );
        }
      }
      return { advanced: true, winnerClubId: fixture.winner_club_id };
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const updateColumn = isHomeSlot ? "home_club_id" : "away_club_id";
    queryRun(
      `UPDATE fixtures SET ${updateColumn} = ?, updated_at = ? WHERE id = ?`,
      [fixture.winner_club_id, now, nextFixtureId]
    );
    const updatedNext = queryGet("SELECT * FROM fixtures WHERE id = ?", [nextFixtureId]);
    if (updatedNext.home_club_id !== "TBD" && updatedNext.away_club_id !== "TBD") {
      const homeOwner = queryGet(
        'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
        [updatedNext.home_club_id, comp.season_id]
      );
      const awayOwner = queryGet(
        'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
        [updatedNext.away_club_id, comp.season_id]
      );
      const notifMsg = `Your next match in ${comp.name} (${updatedNext.round_name}) is scheduled!`;
      if (homeOwner) createNotification(homeOwner.user_id, "NEXT_ROUND_MATCH", `Next Round in ${comp.name}`, notifMsg);
      if (awayOwner) createNotification(awayOwner.user_id, "NEXT_ROUND_MATCH", `Next Round in ${comp.name}`, notifMsg);
    }
    createAuditLog(
      "system",
      "KNOCKOUT_ADVANCE",
      "fixtures",
      nextFixtureId,
      { previousFixtureId: fixture.id },
      { round: nextRound, slot: isHomeSlot ? "HOME" : "AWAY", advancedClubId: fixture.winner_club_id }
    );
    return { advanced: true, targetFixtureId: nextFixtureId, winnerClubId: fixture.winner_club_id };
  });
}

// src/server/services/fixtureService.ts
function generateCompetitionFixtures(competitionId) {
  return dbTransaction(() => {
    const comp = queryGet("SELECT * FROM competitions WHERE id = ?", [competitionId]);
    if (!comp) {
      throw new Error(`Competition '${competitionId}' not found.`);
    }
    if (comp.type === "KNOCKOUT" || comp.type === "SUPER_CUP" || comp.type === "EUROPEAN_KNOCKOUT") {
      const res = generateKnockoutBracket(competitionId);
      return { generated: res.generated, matchdays: res.rounds };
    }
    if (comp.schedule_mode === "OFFICIAL_IMPORT") {
      throw new Error(
        `Competition '${comp.name}' (${comp.id}) is configured for OFFICIAL_IMPORT. Please import official fixtures.`
      );
    }
    const existingCount = queryGet(
      "SELECT COUNT(*) as cnt FROM fixtures WHERE competition_id = ?",
      [competitionId]
    );
    if (existingCount && existingCount.cnt > 0) {
      const maxMatchday2 = queryGet(
        "SELECT MAX(matchday) as max_md FROM fixtures WHERE competition_id = ?",
        [competitionId]
      );
      return { generated: existingCount.cnt, matchdays: maxMatchday2?.max_md || 0 };
    }
    const season = queryGet("SELECT * FROM seasons WHERE id = ?", [comp.season_id]);
    const seasonStartDate = season?.start_date || (/* @__PURE__ */ new Date()).toISOString();
    let clubs = queryAll(
      "SELECT club_id FROM competition_participants WHERE competition_id = ? ORDER BY seed_number ASC",
      [competitionId]
    );
    if (clubs.length === 0 && comp.league_id) {
      const leagueClubs = queryAll(
        `SELECT slc.club_id 
         FROM season_league_clubs slc 
         JOIN clubs c ON slc.club_id = c.id
         WHERE slc.league_id = ? AND slc.season_id = ? AND slc.is_active = 1 
         ORDER BY c.name ASC`,
        [comp.league_id, comp.season_id]
      );
      clubs = leagueClubs;
    }
    const clubIds = clubs.map((c) => c.club_id);
    if (clubIds.length < 2) {
      throw new Error(`Competition needs at least 2 clubs to generate fixtures (found ${clubIds.length}).`);
    }
    let matchups;
    if (comp.type === "EUROPEAN_LEAGUE_PHASE" && clubIds.length === 24) {
      matchups = generateUCL24LeaguePhaseSchedule(clubIds);
    } else {
      matchups = generateRoundRobinSchedule(clubIds, { homeAndAway: true });
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let maxMatchday = 0;
    for (const m of matchups) {
      const fixtureId = `fix-${comp.id}-md${m.matchday}-${m.homeClubId.replace("club-", "")}-vs-${m.awayClubId.replace("club-", "")}`;
      const scheduledDate = calculateMatchdayDate(seasonStartDate, m.matchday, 7);
      if (m.matchday > maxMatchday) {
        maxMatchday = m.matchday;
      }
      queryRun(
        `INSERT INTO fixtures (
          id, season_id, competition_id, matchday, round_name,
          home_club_id, away_club_id, scheduled_at, status,
          home_score, away_score, winner_club_id, result_confirmed_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', NULL, NULL, NULL, NULL, ?, ?)`,
        [
          fixtureId,
          comp.season_id,
          comp.id,
          m.matchday,
          `Matchday ${m.matchday}`,
          m.homeClubId,
          m.awayClubId,
          scheduledDate,
          now,
          now
        ]
      );
    }
    queryRun('UPDATE competitions SET status = "active" WHERE id = ?', [competitionId]);
    return { generated: matchups.length, matchdays: maxMatchday };
  });
}
function resetCompetitionFixtures(competitionId) {
  return dbTransaction(() => {
    queryRun(
      "DELETE FROM result_submissions WHERE fixture_id IN (SELECT id FROM fixtures WHERE competition_id = ?)",
      [competitionId]
    );
    const delRes = queryRun("DELETE FROM fixtures WHERE competition_id = ?", [competitionId]);
    queryRun('UPDATE competitions SET status = "upcoming" WHERE id = ?', [competitionId]);
    const genRes = generateCompetitionFixtures(competitionId);
    return { deleted: delRes.changes, generated: genRes.generated, matchdays: genRes.matchdays };
  });
}
function getFixtures(filter) {
  let sql = `
    SELECT f.*,
           comp.name as competition_name,
           hc.name as home_name, hc.short_name as home_short, hc.logo_url as home_logo,
           ac.name as away_name, ac.short_name as away_short, ac.logo_url as away_logo,
           hcm.user_id as home_owner_id,
           acm.user_id as away_owner_id
    FROM fixtures f
    JOIN competitions comp ON f.competition_id = comp.id
    JOIN clubs hc ON f.home_club_id = hc.id
    JOIN clubs ac ON f.away_club_id = ac.id
    LEFT JOIN club_memberships hcm ON hc.id = hcm.club_id AND hcm.season_id = f.season_id AND hcm.status = 'active'
    LEFT JOIN club_memberships acm ON ac.id = acm.club_id AND acm.season_id = f.season_id AND acm.status = 'active'
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
  if (filter.clubId) {
    sql += " AND (f.home_club_id = ? OR f.away_club_id = ?)";
    params.push(filter.clubId, filter.clubId);
  }
  if (filter.userId) {
    sql += " AND (hcm.user_id = ? OR acm.user_id = ?)";
    params.push(filter.userId, filter.userId);
  }
  sql += " ORDER BY f.matchday ASC, f.scheduled_at ASC";
  if (filter.limit) {
    sql += " LIMIT ?";
    params.push(filter.limit);
  }
  const rows = queryAll(sql, params);
  return rows.map((r) => ({
    id: r.id,
    seasonId: r.season_id,
    competitionId: r.competition_id,
    competitionName: r.competition_name,
    matchday: r.matchday,
    roundName: r.round_name,
    homeClubId: r.home_club_id,
    awayClubId: r.away_club_id,
    homeClub: {
      id: r.home_club_id,
      name: r.home_name,
      shortName: r.home_short,
      country: "",
      leagueId: "",
      logoUrl: r.home_logo,
      active: true,
      createdAt: ""
    },
    awayClub: {
      id: r.away_club_id,
      name: r.away_name,
      shortName: r.away_short,
      country: "",
      leagueId: "",
      logoUrl: r.away_logo,
      active: true,
      createdAt: ""
    },
    homeOwnerId: r.home_owner_id || void 0,
    awayOwnerId: r.away_owner_id || void 0,
    scheduledAt: r.scheduled_at,
    status: r.status,
    homeScore: r.home_score,
    awayScore: r.away_score,
    winnerClubId: r.winner_club_id,
    resultConfirmedAt: r.result_confirmed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}
function getFixtureById(fixtureId, currentUserId) {
  const row = queryGet(
    `SELECT f.*,
            comp.name as competition_name,
            hc.name as home_name, hc.short_name as home_short, hc.logo_url as home_logo,
            ac.name as away_name, ac.short_name as away_short, ac.logo_url as away_logo,
            hcm.user_id as home_owner_id,
            acm.user_id as away_owner_id
     FROM fixtures f
     JOIN competitions comp ON f.competition_id = comp.id
     JOIN clubs hc ON f.home_club_id = hc.id
     JOIN clubs ac ON f.away_club_id = ac.id
     LEFT JOIN club_memberships hcm ON hc.id = hcm.club_id AND hcm.season_id = f.season_id AND hcm.status = 'active'
     LEFT JOIN club_memberships acm ON ac.id = acm.club_id AND acm.season_id = f.season_id AND acm.status = 'active'
     WHERE f.id = ?`,
    [fixtureId]
  );
  if (!row) return null;
  const submissions = queryAll(
    "SELECT * FROM result_submissions WHERE fixture_id = ?",
    [fixtureId]
  );
  let userSub = null;
  let opponentSub = null;
  for (const s of submissions) {
    const formatted = {
      id: s.id,
      fixtureId: s.fixture_id,
      submittedByUserId: s.submitted_by_user_id,
      clubId: s.club_id,
      homeScore: s.home_score,
      awayScore: s.away_score,
      proofUrl: s.proof_url || void 0,
      createdAt: s.created_at
    };
    if (currentUserId && s.submitted_by_user_id === currentUserId) {
      userSub = formatted;
    } else {
      opponentSub = formatted;
    }
  }
  return {
    id: row.id,
    seasonId: row.season_id,
    competitionId: row.competition_id,
    competitionName: row.competition_name,
    matchday: row.matchday,
    roundName: row.round_name,
    homeClubId: row.home_club_id,
    awayClubId: row.away_club_id,
    homeClub: {
      id: row.home_club_id,
      name: row.home_name,
      shortName: row.home_short,
      country: "",
      leagueId: "",
      logoUrl: row.home_logo,
      active: true,
      createdAt: ""
    },
    awayClub: {
      id: row.away_club_id,
      name: row.away_name,
      shortName: row.away_short,
      country: "",
      leagueId: "",
      logoUrl: row.away_logo,
      active: true,
      createdAt: ""
    },
    homeOwnerId: row.home_owner_id || void 0,
    awayOwnerId: row.away_owner_id || void 0,
    scheduledAt: row.scheduled_at,
    status: row.status,
    homeScore: row.home_score,
    awayScore: row.away_score,
    winnerClubId: row.winner_club_id,
    resultConfirmedAt: row.result_confirmed_at,
    submissionsCount: submissions.length,
    userSubmission: userSub,
    opponentSubmission: opponentSub,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// src/server/tournament/qualificationEngine.ts
function evaluateSeasonQualifications(seasonId) {
  return dbTransaction(() => {
    const qualifications = [];
    let participantsAdded = 0;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const leagues = queryAll(
      "SELECT * FROM competitions WHERE season_id = ? AND type = 'LEAGUE'",
      [seasonId]
    );
    const uclComp = queryGet(
      "SELECT * FROM competitions WHERE season_id = ? AND type = 'EUROPEAN_LEAGUE_PHASE' AND name LIKE '%Champions League%'",
      [seasonId]
    );
    const uelComp = queryGet(
      "SELECT * FROM competitions WHERE season_id = ? AND type = 'EUROPEAN_LEAGUE_PHASE' AND name LIKE '%Europa League%'",
      [seasonId]
    );
    const ueclComp = queryGet(
      "SELECT * FROM competitions WHERE season_id = ? AND type = 'EUROPEAN_LEAGUE_PHASE' AND name LIKE '%Conference League%'",
      [seasonId]
    );
    for (const league of leagues) {
      const standings = calculateCompetitionStandings(league.id);
      if (standings.length === 0) continue;
      let formatConfig = {};
      try {
        formatConfig = JSON.parse(league.format_config_json || "{}");
      } catch {
        formatConfig = {};
      }
      const isLigue1 = league.id.includes("ligue-1") || league.name.toLowerCase().includes("ligue 1");
      const uclSpots = isLigue1 ? 4 : formatConfig.qualificationSpots || 5;
      const uelSpots = 1;
      const ueclSpots = 1;
      if (uclComp) {
        for (let i = 0; i < Math.min(uclSpots, standings.length); i++) {
          const row = standings[i];
          const owner = queryGet(
            'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
            [row.clubId, seasonId]
          );
          const reason = `${league.name} Rank #${row.position} (UCL Spot)`;
          qualifications.push({
            seasonId,
            sourceCompetitionId: league.id,
            sourceCompetitionName: league.name,
            targetCompetitionId: uclComp.id,
            targetCompetitionName: uclComp.name,
            clubId: row.clubId,
            clubName: row.clubName,
            ownerUserId: owner?.user_id || null,
            rank: row.position,
            reason
          });
          const partId = `part-${uclComp.id}-${row.clubId}`;
          const existing = queryGet("SELECT id FROM competition_participants WHERE competition_id = ? AND club_id = ?", [
            uclComp.id,
            row.clubId
          ]);
          if (!existing) {
            queryRun(
              `INSERT INTO competition_participants (
                id, competition_id, club_id, season_id, owner_user_id,
                source_competition_id, source_position, qualification_reason,
                qualification_timestamp, seed_number, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                partId,
                uclComp.id,
                row.clubId,
                seasonId,
                owner?.user_id || null,
                league.id,
                row.position,
                reason,
                now,
                qualifications.length,
                now
              ]
            );
            participantsAdded++;
            if (owner) {
              createNotification(
                owner.user_id,
                "QUALIFICATION_CONFIRMED",
                "\u{1F3C6} Qualified for UEFA Champions League!",
                `Congratulations! ${row.clubName} finished #${row.position} in ${league.name} and qualified for the UEFA Champions League!`
              );
            }
          }
        }
      }
      if (uelComp) {
        for (let i = uclSpots; i < Math.min(uclSpots + uelSpots, standings.length); i++) {
          const row = standings[i];
          const owner = queryGet(
            'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
            [row.clubId, seasonId]
          );
          const reason = `${league.name} Rank #${row.position} (UEL Spot)`;
          qualifications.push({
            seasonId,
            sourceCompetitionId: league.id,
            sourceCompetitionName: league.name,
            targetCompetitionId: uelComp.id,
            targetCompetitionName: uelComp.name,
            clubId: row.clubId,
            clubName: row.clubName,
            ownerUserId: owner?.user_id || null,
            rank: row.position,
            reason
          });
          const partId = `part-${uelComp.id}-${row.clubId}`;
          const existing = queryGet("SELECT id FROM competition_participants WHERE competition_id = ? AND club_id = ?", [
            uelComp.id,
            row.clubId
          ]);
          if (!existing) {
            queryRun(
              `INSERT INTO competition_participants (
                id, competition_id, club_id, season_id, owner_user_id,
                source_competition_id, source_position, qualification_reason,
                qualification_timestamp, seed_number, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                partId,
                uelComp.id,
                row.clubId,
                seasonId,
                owner?.user_id || null,
                league.id,
                row.position,
                reason,
                now,
                qualifications.length,
                now
              ]
            );
            participantsAdded++;
            if (owner) {
              createNotification(
                owner.user_id,
                "QUALIFICATION_CONFIRMED",
                "Qualified for UEFA Europa League",
                `Congratulations! ${row.clubName} finished #${row.position} in ${league.name} and qualified for the UEFA Europa League!`
              );
            }
          }
        }
      }
      if (ueclComp) {
        for (let i = uclSpots + uelSpots; i < Math.min(uclSpots + uelSpots + ueclSpots, standings.length); i++) {
          const row = standings[i];
          const owner = queryGet(
            'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
            [row.clubId, seasonId]
          );
          const reason = `${league.name} Rank #${row.position} (UECL Spot)`;
          qualifications.push({
            seasonId,
            sourceCompetitionId: league.id,
            sourceCompetitionName: league.name,
            targetCompetitionId: ueclComp.id,
            targetCompetitionName: ueclComp.name,
            clubId: row.clubId,
            clubName: row.clubName,
            ownerUserId: owner?.user_id || null,
            rank: row.position,
            reason
          });
          const partId = `part-${ueclComp.id}-${row.clubId}`;
          const existing = queryGet("SELECT id FROM competition_participants WHERE competition_id = ? AND club_id = ?", [
            ueclComp.id,
            row.clubId
          ]);
          if (!existing) {
            queryRun(
              `INSERT INTO competition_participants (
                id, competition_id, club_id, season_id, owner_user_id,
                source_competition_id, source_position, qualification_reason,
                qualification_timestamp, seed_number, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                partId,
                ueclComp.id,
                row.clubId,
                seasonId,
                owner?.user_id || null,
                league.id,
                row.position,
                reason,
                now,
                qualifications.length,
                now
              ]
            );
            participantsAdded++;
            if (owner) {
              createNotification(
                owner.user_id,
                "QUALIFICATION_CONFIRMED",
                "Qualified for UEFA Conference League",
                `Congratulations! ${row.clubName} finished #${row.position} in ${league.name} and qualified for the UEFA Conference League!`
              );
            }
          }
        }
      }
    }
    createAuditLog(
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
  });
}

// src/server/tournament/competitionEngine.ts
var CompetitionEngine = class {
  /**
   * Generates fixtures for any competition type (LEAGUE, KNOCKOUT, SUPER_CUP, EUROPEAN)
   */
  static generateSchedule(competitionId) {
    const comp = queryGet("SELECT * FROM competitions WHERE id = ?", [competitionId]);
    if (!comp) {
      throw new Error(`Competition '${competitionId}' not found.`);
    }
    if (comp.type === "LEAGUE" || comp.type === "EUROPEAN_LEAGUE_PHASE") {
      return generateCompetitionFixtures(competitionId);
    } else if (comp.type === "KNOCKOUT" || comp.type === "SUPER_CUP" || comp.type === "EUROPEAN_KNOCKOUT") {
      return generateKnockoutBracket(competitionId);
    } else {
      throw new Error(`Unsupported competition type '${comp.type}'`);
    }
  }
  /**
   * Retrieves or computes official standings for a competition
   */
  static getStandings(competitionId) {
    return calculateCompetitionStandings(competitionId);
  }
  /**
   * Advances tournament state upon match confirmation
   */
  static handleMatchConfirmed(fixtureId) {
    return advanceKnockoutWinner(fixtureId);
  }
  /**
   * Evaluates end-of-season European qualifications and supercup participants
   */
  static evaluateQualifications(seasonId) {
    return evaluateSeasonQualifications(seasonId);
  }
};

// src/server/routes/competitions.routes.ts
var competitionsRouter = Router6();
competitionsRouter.get("/", (req, res) => {
  const seasonId = req.query.seasonId || "season-2026-27";
  const rows = queryAll(
    "SELECT * FROM competitions WHERE season_id = ? ORDER BY type ASC, name ASC",
    [seasonId]
  );
  const competitions = rows.map((r) => ({
    id: r.id,
    seasonId: r.season_id,
    leagueId: r.league_id || void 0,
    name: r.name,
    type: r.type,
    scheduleMode: r.schedule_mode,
    status: r.status,
    formatConfig: r.format_config_json ? JSON.parse(r.format_config_json) : {},
    createdAt: r.created_at
  }));
  res.json({ competitions });
});
competitionsRouter.get("/:id", (req, res) => {
  const row = queryGet("SELECT * FROM competitions WHERE id = ?", [req.params.id]);
  if (!row) {
    res.status(404).json({ error: "Competition not found" });
    return;
  }
  const competition = {
    id: row.id,
    seasonId: row.season_id,
    leagueId: row.league_id || void 0,
    name: row.name,
    type: row.type,
    scheduleMode: row.schedule_mode,
    status: row.status,
    formatConfig: row.format_config_json ? JSON.parse(row.format_config_json) : {},
    createdAt: row.created_at
  };
  res.json({ competition });
});
competitionsRouter.get("/:id/standings", (req, res) => {
  try {
    const standings = calculateCompetitionStandings(req.params.id);
    res.json({ standings });
  } catch (err) {
    res.status(500).json({ error: "Failed to calculate standings", message: err.message });
  }
});
competitionsRouter.get("/:id/fixtures", (req, res) => {
  const matchday = req.query.matchday ? parseInt(req.query.matchday, 10) : void 0;
  const status = req.query.status;
  const fixtures = getFixtures({
    competitionId: req.params.id,
    matchday,
    status
  });
  res.json({ fixtures });
});
competitionsRouter.get("/:id/participants", (req, res) => {
  try {
    const rows = queryAll(
      `SELECT 
        cp.*,
        c.name as club_name,
        c.short_name as club_short_name,
        c.logo_url as club_logo_url,
        u.username as owner_username,
        sc.name as source_competition_name
       FROM competition_participants cp
       JOIN clubs c ON cp.club_id = c.id
       LEFT JOIN users u ON cp.owner_user_id = u.id
       LEFT JOIN competitions sc ON cp.source_competition_id = sc.id
       WHERE cp.competition_id = ?
       ORDER BY cp.seed_number ASC, cp.created_at ASC`,
      [req.params.id]
    );
    const participants = rows.map((r) => ({
      id: r.id,
      competitionId: r.competition_id,
      clubId: r.club_id,
      clubName: r.club_name,
      clubShortName: r.club_short_name,
      clubLogoUrl: r.club_logo_url,
      seasonId: r.season_id,
      ownerUserId: r.owner_user_id,
      ownerUsername: r.owner_username,
      sourceCompetitionId: r.source_competition_id,
      sourceCompetitionName: r.source_competition_name,
      sourcePosition: r.source_position,
      qualificationReason: r.qualification_reason,
      qualificationTimestamp: r.qualification_timestamp,
      seedNumber: r.seed_number,
      createdAt: r.created_at
    }));
    res.json({ participants });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch participants", message: err.message });
  }
});
competitionsRouter.post("/:id/generate-fixtures", requireAdmin, (req, res) => {
  try {
    const result = CompetitionEngine.generateSchedule(req.params.id);
    res.json({
      success: true,
      message: `Generated schedule successfully.`,
      result
    });
  } catch (err) {
    res.status(400).json({ error: "Failed to generate schedule", message: err.message });
  }
});

// src/server/routes/fixtures.routes.ts
import { Router as Router7 } from "express";
import { z as z2 } from "zod";

// src/server/services/resultService.ts
var ResultSubmissionError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ResultSubmissionError";
  }
};
function submitFixtureResult(userId, fixtureId, homeScore, awayScore, proofUrl) {
  return dbTransaction(() => {
    if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
      throw new ResultSubmissionError("Scores must be non-negative integers.");
    }
    const fixture = queryGet("SELECT * FROM fixtures WHERE id = ?", [fixtureId]);
    if (!fixture) {
      throw new ResultSubmissionError(`Fixture with ID '${fixtureId}' not found.`);
    }
    if (fixture.status === "CONFIRMED") {
      throw new ResultSubmissionError("This match result is already CONFIRMED and cannot be modified.");
    }
    const userMemberships = queryAll(
      'SELECT club_id FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = "active"',
      [userId, fixture.season_id]
    );
    const userClubIds = userMemberships.map((m) => m.club_id);
    const isHome = userClubIds.includes(fixture.home_club_id);
    const isAway = userClubIds.includes(fixture.away_club_id);
    if (!isHome && !isAway) {
      throw new ResultSubmissionError("You do not own either the home or away club in this fixture.");
    }
    const userClubId = isHome ? fixture.home_club_id : fixture.away_club_id;
    const opponentClubId = isHome ? fixture.away_club_id : fixture.home_club_id;
    const existingSubmission = queryGet(
      "SELECT id FROM result_submissions WHERE fixture_id = ? AND submitted_by_user_id = ?",
      [fixtureId, userId]
    );
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (existingSubmission) {
      queryRun(
        "UPDATE result_submissions SET home_score = ?, away_score = ?, proof_url = ?, created_at = ? WHERE id = ?",
        [homeScore, awayScore, proofUrl || null, now, existingSubmission.id]
      );
    } else {
      const submissionId = `sub-${fixtureId}-${userId}`;
      queryRun(
        "INSERT INTO result_submissions (id, fixture_id, submitted_by_user_id, club_id, home_score, away_score, proof_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [submissionId, fixtureId, userId, userClubId, homeScore, awayScore, proofUrl || null, now]
      );
    }
    const allSubmissions = queryAll(
      "SELECT * FROM result_submissions WHERE fixture_id = ?",
      [fixtureId]
    );
    const opponentMembership = queryGet(
      'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
      [opponentClubId, fixture.season_id]
    );
    const opponentUserId = opponentMembership?.user_id;
    let newStatus = "AWAITING_RESULT";
    let confirmedHomeScore = null;
    let confirmedAwayScore = null;
    let winnerClubId = null;
    let confirmedAt = null;
    if (allSubmissions.length >= 2) {
      const [sub1, sub2] = allSubmissions;
      const scoresMatch = sub1.home_score === sub2.home_score && sub1.away_score === sub2.away_score;
      if (scoresMatch) {
        newStatus = "CONFIRMED";
        confirmedHomeScore = sub1.home_score;
        confirmedAwayScore = sub1.away_score;
        confirmedAt = now;
        if (confirmedHomeScore > confirmedAwayScore) {
          winnerClubId = fixture.home_club_id;
        } else if (confirmedAwayScore > confirmedHomeScore) {
          winnerClubId = fixture.away_club_id;
        }
        queryRun(
          'UPDATE disputes SET status = "RESOLVED", resolution_notes = "Auto-resolved by identical submissions", resolved_at = ? WHERE fixture_id = ?',
          [now, fixtureId]
        );
        createNotification(
          userId,
          "RESULT_CONFIRMED",
          "Match Result Confirmed!",
          `Your match result (${confirmedHomeScore} - ${confirmedAwayScore}) has been verified and confirmed.`
        );
        if (opponentUserId) {
          createNotification(
            opponentUserId,
            "RESULT_CONFIRMED",
            "Match Result Confirmed!",
            `Your match result (${confirmedHomeScore} - ${confirmedAwayScore}) has been verified and confirmed.`
          );
        }
      } else {
        newStatus = "DISPUTED";
        const disputeId = `disp-${fixtureId}`;
        const existingDispute = queryGet("SELECT id FROM disputes WHERE fixture_id = ?", [fixtureId]);
        const homeSub = allSubmissions.find((s) => s.club_id === fixture.home_club_id);
        const awaySub = allSubmissions.find((s) => s.club_id === fixture.away_club_id);
        if (!existingDispute) {
          queryRun(
            'INSERT INTO disputes (id, fixture_id, season_id, home_submission_id, away_submission_id, status, created_at) VALUES (?, ?, ?, ?, ?, "OPEN", ?)',
            [disputeId, fixtureId, fixture.season_id, homeSub?.id || sub1.id, awaySub?.id || sub2.id, now]
          );
        } else {
          queryRun(
            'UPDATE disputes SET home_submission_id = ?, away_submission_id = ?, status = "OPEN" WHERE id = ?',
            [homeSub?.id || sub1.id, awaySub?.id || sub2.id, existingDispute.id]
          );
        }
        createNotification(
          userId,
          "RESULT_DISPUTED",
          "Score Mismatch / Disputed Match",
          `Your submitted score differs from your opponent's (${sub1.home_score}-${sub1.away_score} vs ${sub2.home_score}-${sub2.away_score}). An admin will review the proofs.`
        );
        if (opponentUserId) {
          createNotification(
            opponentUserId,
            "RESULT_DISPUTED",
            "Score Mismatch / Disputed Match",
            `Your submitted score differs from your opponent's (${sub1.home_score}-${sub1.away_score} vs ${sub2.home_score}-${sub2.away_score}). An admin will review the proofs.`
          );
        }
      }
    } else {
      newStatus = "PENDING_CONFIRMATION";
      if (opponentUserId) {
        createNotification(
          opponentUserId,
          "RESULT_AWAITING_OPPONENT",
          "Opponent Submitted Match Score",
          `Your opponent has submitted a match result. Please submit your score to confirm the result.`
        );
      }
    }
    queryRun(
      `UPDATE fixtures SET
        status = ?,
        home_score = ?,
        away_score = ?,
        winner_club_id = ?,
        result_confirmed_at = ?,
        updated_at = ?
       WHERE id = ?`,
      [newStatus, confirmedHomeScore, confirmedAwayScore, winnerClubId, confirmedAt, now, fixtureId]
    );
    if (newStatus === "CONFIRMED") {
      createAuditLog(
        userId,
        "RESULT_CONFIRMED",
        "fixtures",
        fixtureId,
        { status: fixture.status },
        { status: "CONFIRMED", homeScore: confirmedHomeScore, awayScore: confirmedAwayScore, winnerClubId }
      );
      advanceKnockoutWinner(fixtureId);
    } else if (newStatus === "DISPUTED") {
      createAuditLog(
        userId,
        "RESULT_DISPUTED",
        "fixtures",
        fixtureId,
        { status: fixture.status },
        { status: "DISPUTED", allSubmissions }
      );
    }
    return getFixtureById(fixtureId, userId);
  });
}

// src/server/routes/fixtures.routes.ts
var fixturesRouter = Router7();
var resultSubmissionSchema = z2.object({
  homeScore: z2.number().int().min(0, "Home score must be >= 0"),
  awayScore: z2.number().int().min(0, "Away score must be >= 0"),
  proofUrl: z2.string().optional()
});
fixturesRouter.get("/:id", (req, res) => {
  const currentUserId = req.user?.id;
  const fixture = getFixtureById(req.params.id, currentUserId);
  if (!fixture) {
    res.status(404).json({ error: "Fixture not found" });
    return;
  }
  res.json({ fixture });
});
fixturesRouter.post("/:id/result", requireAuth, validateBody(resultSubmissionSchema), (req, res) => {
  const userId = req.user.id;
  const fixtureId = req.params.id;
  const { homeScore, awayScore, proofUrl } = req.body;
  try {
    const updatedFixture = submitFixtureResult(userId, fixtureId, homeScore, awayScore, proofUrl);
    res.json({
      success: true,
      message: updatedFixture.status === "CONFIRMED" ? "Match result confirmed!" : updatedFixture.status === "DISPUTED" ? "Scores differ! Match has been marked DISPUTED and sent to admin." : "Score submitted! Awaiting opponent confirmation.",
      fixture: updatedFixture
    });
  } catch (err) {
    if (err instanceof ResultSubmissionError) {
      res.status(400).json({ error: "Bad Request", message: err.message });
      return;
    }
    console.error("Error submitting result:", err);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to submit result." });
  }
});

// src/server/routes/me.routes.ts
import { Router as Router8 } from "express";
var meRouter = Router8();
meRouter.get("/", requireAuth, (req, res) => {
  const user = req.user;
  const seasonId = req.query.seasonId || "season-2026-27";
  const currentClub = getUserActiveClub(user.id, seasonId);
  let stats = {
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
    const confirmedMatches = queryAll(
      `SELECT f.* FROM fixtures f
       WHERE (f.home_club_id = ? OR f.away_club_id = ?) AND f.status = 'CONFIRMED' AND f.season_id = ?`,
      [currentClub.id, currentClub.id, seasonId]
    );
    for (const m of confirmedMatches) {
      stats.matchesPlayed++;
      const isHome = m.home_club_id === currentClub.id;
      const myScore = isHome ? m.home_score : m.away_score;
      const oppScore = isHome ? m.away_score : m.home_score;
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
  res.json({
    authenticated: true,
    user,
    currentClub,
    stats
  });
});
meRouter.get("/matches", requireAuth, (req, res) => {
  const userId = req.user.id;
  const seasonId = req.query.seasonId || "season-2026-27";
  const status = req.query.status;
  const fixtures = getFixtures({
    userId,
    seasonId,
    status
  });
  res.json({ fixtures });
});
meRouter.get("/notifications", requireAuth, (req, res) => {
  const userId = req.user.id;
  const notifications = getUserNotifications(userId, 30);
  res.json({ notifications });
});
meRouter.post("/notifications/read", requireAuth, (req, res) => {
  const userId = req.user.id;
  markNotificationsAsRead(userId);
  res.json({ success: true });
});

// src/server/routes/admin.routes.ts
import { Router as Router9 } from "express";
import { z as z3 } from "zod";
var adminRouter = Router9();
adminRouter.use(requireAdmin);
var resolveDisputeSchema = z3.object({
  action: z3.enum(["CONFIRM_HOME_SUBMISSION", "CONFIRM_AWAY_SUBMISSION", "MANUAL_SCORE", "CANCEL_MATCH"]),
  manualHomeScore: z3.number().int().min(0).optional(),
  manualAwayScore: z3.number().int().min(0).optional(),
  notes: z3.string().optional()
});
var reopenFixtureSchema = z3.object({
  notes: z3.string().optional()
});
adminRouter.get("/users", (req, res) => {
  const users = getAllAdminUsers();
  res.json({ users });
});
adminRouter.get("/disputes", (req, res) => {
  const status = req.query.status || "OPEN";
  const disputes = getDisputes(status);
  res.json({ disputes });
});
adminRouter.post("/disputes/:id/resolve", validateBody(resolveDisputeSchema), (req, res) => {
  const adminUserId = req.user.id;
  const disputeId = req.params.id;
  try {
    const result = resolveDispute(adminUserId, disputeId, req.body);
    res.json({
      success: true,
      message: "Dispute resolved successfully.",
      dispute: result.dispute
    });
  } catch (err) {
    res.status(400).json({ error: "Failed to resolve dispute", message: err.message });
  }
});
adminRouter.post("/fixtures/:id/reopen", validateBody(reopenFixtureSchema), (req, res) => {
  const adminUserId = req.user.id;
  const fixtureId = req.params.id;
  try {
    const result = reopenFixture(adminUserId, fixtureId, req.body.notes);
    res.json({
      success: true,
      message: "Fixture has been reopened for submissions.",
      result
    });
  } catch (err) {
    res.status(400).json({ error: "Failed to reopen fixture", message: err.message });
  }
});
adminRouter.get("/audit-logs", (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
  const logs = getAuditLogs(limit);
  res.json({ logs });
});
adminRouter.post("/fixtures/generate", (req, res) => {
  const { competitionId } = req.body;
  if (!competitionId) {
    res.status(400).json({ error: "competitionId is required" });
    return;
  }
  try {
    const result = CompetitionEngine.generateSchedule(competitionId);
    res.json({
      success: true,
      message: `Generated competition schedule.`,
      result
    });
  } catch (err) {
    res.status(400).json({ error: "Failed to generate schedule", message: err.message });
  }
});
adminRouter.post("/knockouts/generate", (req, res) => {
  const { competitionId } = req.body;
  if (!competitionId) {
    res.status(400).json({ error: "competitionId is required" });
    return;
  }
  try {
    const result = generateKnockoutBracket(competitionId);
    res.json({
      success: true,
      message: `Generated ${result.generated} knockout matches across ${result.rounds} rounds.`,
      result
    });
  } catch (err) {
    res.status(400).json({ error: "Failed to generate knockout bracket", message: err.message });
  }
});
adminRouter.post("/qualifications/evaluate", (req, res) => {
  const seasonId = req.body.seasonId || "season-2026-27";
  try {
    const result = evaluateSeasonQualifications(seasonId);
    res.json({
      success: true,
      message: `Evaluated European qualifications: ${result.qualifications.length} spots assigned, ${result.participantsAdded} participants registered.`,
      result
    });
  } catch (err) {
    res.status(400).json({ error: "Failed to evaluate qualifications", message: err.message });
  }
});
adminRouter.post("/fixtures/reset", (req, res) => {
  const { competitionId } = req.body;
  if (!competitionId) {
    res.status(400).json({ error: "competitionId is required" });
    return;
  }
  try {
    const result = resetCompetitionFixtures(competitionId);
    res.json({
      success: true,
      message: `Reset and regenerated schedule for competition '${competitionId}'.`,
      result
    });
  } catch (err) {
    res.status(400).json({ error: "Failed to reset schedule", message: err.message });
  }
});
adminRouter.post("/fixtures/regenerate-domestic", (req, res) => {
  const seasonId = req.body.seasonId || "season-2026-27";
  try {
    const domesticComps = queryAll(
      'SELECT id, name FROM competitions WHERE season_id = ? AND type = "LEAGUE"',
      [seasonId]
    );
    const results = [];
    for (const comp of domesticComps) {
      const resData = resetCompetitionFixtures(comp.id);
      results.push({ competitionId: comp.id, name: comp.name, ...resData });
    }
    res.json({
      success: true,
      message: `Regenerated domestic league fixtures for season '${seasonId}'.`,
      results
    });
  } catch (err) {
    res.status(400).json({ error: "Failed to regenerate domestic fixtures", message: err.message });
  }
});

// src/server/app.ts
var dbInitPromise = null;
async function ensureDbReady() {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      try {
        await initDatabase();
        seedDatabase();
        repairSeason202627Roster();
        console.log(`[BOOT] Database path: ${getDbFilePath()}`);
        console.log("[BOOT] Active season: season-2026-27");
        const plCount = queryGet(`SELECT COUNT(*) as c FROM season_league_clubs WHERE season_id = 'season-2026-27' AND league_id = 'league-premier-league' AND is_active = 1`)?.c || 0;
        const llCount = queryGet(`SELECT COUNT(*) as c FROM season_league_clubs WHERE season_id = 'season-2026-27' AND league_id = 'league-la-liga' AND is_active = 1`)?.c || 0;
        const saCount = queryGet(`SELECT COUNT(*) as c FROM season_league_clubs WHERE season_id = 'season-2026-27' AND league_id = 'league-serie-a' AND is_active = 1`)?.c || 0;
        const blCount = queryGet(`SELECT COUNT(*) as c FROM season_league_clubs WHERE season_id = 'season-2026-27' AND league_id = 'league-bundesliga' AND is_active = 1`)?.c || 0;
        const l1Count = queryGet(`SELECT COUNT(*) as c FROM season_league_clubs WHERE season_id = 'season-2026-27' AND league_id = 'league-ligue-1' AND is_active = 1`)?.c || 0;
        const totalActive = Number(plCount) + Number(llCount) + Number(saCount) + Number(blCount) + Number(l1Count);
        console.log(`[BOOT] 96 clubs verified (${plCount}/${llCount}/${saCount}/${blCount}/${l1Count}, total: ${totalActive})`);
      } catch (err) {
        console.error("[BOOT] Error initializing database:", err);
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

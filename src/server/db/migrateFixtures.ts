import type { Database } from 'sql.js';

/** Preserve the existing schema, custom columns, indexes and triggers. Fail closed on unfamiliar DDL. */
export function migrateFixturesTableIfNeeded(db: Database): { migrated: boolean; recordsPreserved: number; reason?: string } {
  const ddl = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='fixtures'")[0]?.values[0]?.[0];
  if (!ddl) return { migrated: false, recordsPreserved: 0, reason: 'fixtures table does not exist' };
  const columns = db.exec('PRAGMA table_xinfo(fixtures)')[0].values;
  const names = columns.map(c => String(c[1]));
  const metadata = ['source_fixture_id', 'source_winner_slot', 'home_source_fixture_id', 'away_source_fixture_id', 'home_source_winner_slot', 'away_source_winner_slot'];
  const missing = metadata.filter(name => !names.includes(name));
  const needsNullable = columns.some(c => ['home_club_id', 'away_club_id'].includes(String(c[1])) && Number(c[3]) === 1);
  const scalar = (sql: string) => Number(db.exec(sql)[0]?.values[0]?.[0] || 0);
  const dirty = scalar("SELECT count(*) FROM fixtures WHERE home_club_id IN ('TBD','') OR away_club_id IN ('TBD','')");
  if (!needsNullable && !missing.length && !dirty) return { migrated: false, recordsPreserved: 0, reason: 'already up-to-date' };
  const count = scalar('SELECT count(*) FROM fixtures');
  const fk = scalar('PRAGMA foreign_keys');
  const quote = (name: string) => '"' + name.replace(/"/g, '""') + '"';
  const schemaObjects = db.exec("SELECT sql FROM sqlite_master WHERE tbl_name='fixtures' AND type IN ('index','trigger') AND sql IS NOT NULL")[0]?.values || [];
  const originalViolations = JSON.stringify(db.exec('PRAGMA foreign_key_check'));
  let transaction = false;
  try {
    db.run('PRAGMA foreign_keys=OFF');
    db.run('BEGIN IMMEDIATE');
    transaction = true;
    if (needsNullable) {
      let replacement = String(ddl).replace(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"fixtures"|`fixtures`|\[fixtures\]|fixtures)/i, 'CREATE TABLE fixtures_migration_temp');
      for (const name of ['home_club_id', 'away_club_id']) {
        const pattern = new RegExp('((?:"' + name + '"|`' + name + '`|\\[' + name + '\\]|\\b' + name + '\\b)[^,]*?)\\s+NOT\\s+NULL(?:\\s+ON\\s+CONFLICT\\s+\\w+)?', 'i');
        replacement = replacement.replace(pattern, '$1');
      }
      if (replacement === String(ddl)) throw new Error('Unrecognized fixtures schema');
      db.run(replacement);
      const tempCols = db.exec('PRAGMA table_xinfo(fixtures_migration_temp)')[0].values;
      if (tempCols.some(c => ['home_club_id','away_club_id'].includes(String(c[1])) && Number(c[3]) === 1)) throw new Error('Nullable migration could not preserve schema');
      const writable = columns.filter(c => Number(c[6]) === 0).map(c => String(c[1]));
      const projection = writable.map(name => ['home_club_id','away_club_id'].includes(name) ? `CASE WHEN ${quote(name)} IN ('TBD','') THEN NULL ELSE ${quote(name)} END` : quote(name)).join(',');
      const fields = writable.map(quote).join(',');
      db.run(`INSERT INTO fixtures_migration_temp (${fields}) SELECT ${projection} FROM fixtures`);
      if (scalar('SELECT count(*) FROM fixtures_migration_temp') !== count || db.exec(`SELECT ${projection} FROM fixtures EXCEPT SELECT ${fields} FROM fixtures_migration_temp`).length) throw new Error('Fixture data preservation check failed');
      db.run('DROP TABLE fixtures');
      db.run('ALTER TABLE fixtures_migration_temp RENAME TO fixtures');
      for (const [sql] of schemaObjects) db.run(String(sql));
    } else if (dirty) {
      db.run("UPDATE fixtures SET home_club_id = CASE WHEN home_club_id IN ('TBD','') THEN NULL ELSE home_club_id END, away_club_id = CASE WHEN away_club_id IN ('TBD','') THEN NULL ELSE away_club_id END WHERE home_club_id IN ('TBD','') OR away_club_id IN ('TBD','')");
    }
    for (const name of missing) db.run(`ALTER TABLE fixtures ADD COLUMN ${quote(name)} TEXT`);
    if (JSON.stringify(db.exec('PRAGMA foreign_key_check')) !== originalViolations) throw new Error('Migration changed foreign key integrity');
    db.run('COMMIT');
    transaction = false;
    return { migrated: true, recordsPreserved: count };
  } catch (error) {
    if (transaction) db.run('ROLLBACK');
    throw error;
  } finally {
    db.run(`PRAGMA foreign_keys=${fk}`);
  }
}

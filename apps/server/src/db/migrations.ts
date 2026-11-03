import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  /** Unique and permanent: a renamed migration runs again. */
  readonly name: string
  readonly sql: string
}

// Better Auth manages its own tables through `npm run db:migrate`. Application
// tables record each applied migration by name, so a migration runs once per database.
export function runMigrations(db: DatabaseSync, migrations: ReadonlyArray<Migration>) {
  db.exec('CREATE TABLE IF NOT EXISTS migration (name TEXT PRIMARY KEY, appliedAt TEXT NOT NULL)')

  const applied = db.prepare('SELECT 1 FROM migration WHERE name = ?')
  const record = db.prepare('INSERT INTO migration (name, appliedAt) VALUES (?, ?)')

  for (const migration of migrations) {
    if (applied.get(migration.name)) continue

    db.exec('BEGIN IMMEDIATE')

    try {
      db.exec(migration.sql)
      record.run(migration.name, new Date().toISOString())
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

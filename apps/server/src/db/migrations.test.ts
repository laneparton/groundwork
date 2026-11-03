import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { runMigrations } from './migrations.ts'

const names = (db: DatabaseSync) =>
  db
    .prepare('SELECT name FROM migration ORDER BY name')
    .all()
    .map((row) => row['name'])

describe('runMigrations', () => {
  it('applies each migration once and records it', () => {
    const db = new DatabaseSync(':memory:')
    const migrations = [{ name: 'a', sql: 'CREATE TABLE a (id INTEGER)' }]

    runMigrations(db, migrations)
    runMigrations(db, migrations)

    expect(names(db)).toEqual(['a'])
  })

  it('rolls back a failed migration and leaves earlier ones applied', () => {
    const db = new DatabaseSync(':memory:')

    const migrations = [
      { name: 'a', sql: 'CREATE TABLE a (id INTEGER)' },
      { name: 'b', sql: 'CREATE TABLE b (id INTEGER); INSERT INTO missing VALUES (1);' },
    ]

    expect(() => runMigrations(db, migrations)).toThrow('no such table: missing')
    expect(names(db)).toEqual(['a'])
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'b'`).get()).toBeUndefined()
  })
})

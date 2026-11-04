import { mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from '@effect/vitest'
import { Context, Effect, Exit, Fiber, Layer, Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { withEnv } from '../test/config.ts'
import { Database, DatabaseLive, write } from './service.ts'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

describe('Database', () => {
  it.effect('creates the database directory and enables WAL and foreign keys', () => {
    const directory = mkdtempSync(join(tmpdir(), 'groundwork-db-'))
    directories.push(directory)

    return Effect.gen(function* () {
      const db = yield* Database

      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
      expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    }).pipe(
      Effect.provide(
        DatabaseLive.pipe(
          Layer.provide(withEnv({ DATABASE_PATH: join(directory, 'nested', 'test.sqlite') })),
        ),
      ),
    )
  })

  it.effect('closes the connection when its scope closes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'groundwork-db-'))
    directories.push(directory)

    const live = DatabaseLive.pipe(
      Layer.provide(withEnv({ DATABASE_PATH: join(directory, 'test.sqlite') })),
    )

    return Effect.gen(function* () {
      const scope = yield* Scope.make()
      const db = Context.get(yield* Layer.buildWithScope(live, scope), Database)

      expect(db.isOpen).toBe(true)
      yield* Scope.close(scope, Exit.void)
      expect(db.isOpen).toBe(false)
    })
  })
})

describe('write', () => {
  const setup = () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE t (value INTEGER)')

    return db
  }

  const count = (db: DatabaseSync) => db.prepare('SELECT count(*) AS n FROM t').get()

  it.effect('waits for an open transaction to finish before writing', () =>
    Effect.gen(function* () {
      const db = setup()
      db.exec('BEGIN')

      let wrote = false

      const fiber = yield* Effect.forkChild(
        write(db, () => {
          wrote = true
          db.exec('INSERT INTO t VALUES (1)')
        }),
      )

      yield* TestClock.adjust('100 millis')
      expect(wrote).toBe(false)

      db.exec('ROLLBACK')
      yield* TestClock.adjust('1 millis')
      yield* Fiber.join(fiber)

      // The write ran after the rollback, so it was not undone with it.
      expect(count(db)).toEqual({ n: 1 })
    }),
  )

  it.effect('gives up after five seconds', () =>
    Effect.gen(function* () {
      const db = setup()
      db.exec('BEGIN')

      let settled = false

      const fiber = yield* Effect.forkChild(
        Effect.exit(write(db, () => db.exec('INSERT INTO t VALUES (1)'))).pipe(
          Effect.ensuring(Effect.sync(() => (settled = true))),
        ),
      )

      yield* TestClock.adjust('4900 millis')
      expect(settled).toBe(false)

      yield* TestClock.adjust('200 millis')
      const exit = yield* Fiber.join(fiber)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(count(db)).toEqual({ n: 0 })
    }),
  )
})

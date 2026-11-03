import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { withEnv } from '../test/config.ts'
import { Database, DatabaseLive } from './service.ts'

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
})

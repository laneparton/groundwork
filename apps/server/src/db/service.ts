import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context, Effect, Layer } from 'effect'
import { DatabaseConfig } from '../config.ts'

// One SQLite connection shared by Better Auth and the conversation store, so
// conversations can reference users with a foreign key.
export class Database extends Context.Service<Database, DatabaseSync>()('groundwork/Database') {}

export const DatabaseLive = Layer.effect(Database)(
  Effect.gen(function* () {
    const config = yield* DatabaseConfig

    return yield* Effect.acquireRelease(
      Effect.sync(() => {
        mkdirSync(dirname(config.path), { recursive: true })
        const db = new DatabaseSync(config.path)
        db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

        return db
      }),
      (db) => Effect.sync(() => db.close()),
    )
  }),
)

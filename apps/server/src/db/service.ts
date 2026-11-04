import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context, Effect, Layer, Schedule, Schema } from 'effect'
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

class TransactionOpen extends Schema.TaggedError<TransactionOpen>()('TransactionOpen', {}) {}

/**
 * Runs a synchronous write once no other transaction is open on the shared connection.
 * Better Auth keeps its transactions open across awaits; a write made meanwhile would
 * fail to begin its own transaction or be committed and rolled back with Better Auth's.
 * The write itself runs in one tick, so nothing interleaves with it.
 */
export function write<A>(db: DatabaseSync, run: () => A) {
  return Effect.suspend(() =>
    db.isTransaction ? Effect.fail(new TransactionOpen()) : Effect.sync(run),
  ).pipe(
    Effect.retry({
      schedule: Schedule.spaced('1 millis').pipe(Schedule.upTo({ duration: '5 seconds' })),
    }),
    Effect.orDie,
  )
}

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { betterAuth } from 'better-auth'
import { Context, Effect, Layer, Redacted } from 'effect'
import { AuthConfig } from '../config.ts'

function createAuth(options: { database: DatabaseSync; secret: string; baseURL: string; trustedOrigins: string[] }) {
  return betterAuth({ ...options, appName: 'Groundwork', emailAndPassword: { enabled: true } })
}

export class Auth extends Context.Service<Auth, ReturnType<typeof createAuth>>()('groundwork/Auth') {}

export const AuthLive = Layer.effect(Auth)(Effect.gen(function* () {
  const config = yield* AuthConfig
  if (Redacted.value(config.secret).length < 32) {
    return yield* Effect.die(new Error('BETTER_AUTH_SECRET must contain at least 32 characters.'))
  }
  const database = yield* Effect.acquireRelease(
    Effect.sync(() => {
      mkdirSync(dirname(config.databasePath), { recursive: true })
      const db = new DatabaseSync(config.databasePath)
      db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
      return db
    }),
    (db) => Effect.sync(() => db.close()),
  )
  return createAuth({
    database,
    secret: Redacted.value(config.secret),
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins.split(',').map((origin) => origin.trim()).filter(Boolean),
  })
}))

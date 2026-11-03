import type { DatabaseSync } from 'node:sqlite'
import { betterAuth } from 'better-auth'
import { Context, Effect, Layer, Redacted } from 'effect'
import { AuthConfig } from '../config.ts'
import { Database } from '../db/service.ts'

function createAuth(options: {
  database: DatabaseSync
  secret: string
  baseURL: string
  trustedOrigins: string[]
}) {
  return betterAuth({
    ...options,
    appName: 'Groundwork',
    emailAndPassword: { enabled: true },
    // Better Auth skips the CSRF origin check when NODE_ENV is test; keep it on so tests
    // exercise the same protection production runs.
    advanced: { disableOriginCheck: false },
  })
}

export class Auth extends Context.Service<Auth, ReturnType<typeof createAuth>>()(
  'groundwork/Auth',
) {}

export const AuthLive = Layer.effect(Auth)(
  Effect.gen(function* () {
    const config = yield* AuthConfig

    const database = yield* Database

    return createAuth({
      database,
      secret: Redacted.value(config.secret),
      baseURL: config.baseURL,
      trustedOrigins: [...config.trustedOrigins],
    })
  }),
)

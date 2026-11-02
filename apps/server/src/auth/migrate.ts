import { NodeRuntime } from '@effect/platform-node'
import { getMigrations } from 'better-auth/db/migration'
import { Effect, Layer } from 'effect'
import { DatabaseLive } from '../db/service.ts'
import { Auth, AuthLive } from './service.ts'

const migrate = Effect.gen(function* () {
  const auth = yield* Auth
  yield* Effect.tryPromise(async () => {
    const migration = await getMigrations(auth.options)
    await migration.runMigrations()
  })
  yield* Effect.log('Auth database migrations applied.')
}).pipe(Effect.provide(AuthLive.pipe(Layer.provide(DatabaseLive))))

NodeRuntime.runMain(migrate)

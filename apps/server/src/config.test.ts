import { describe, expect, it } from '@effect/vitest'
import { Effect, Redacted } from 'effect'
import { AuthConfig, ChatConfig, DatabaseConfig, ServerConfig, WarehouseConfig } from './config.ts'
import { defaultMaxBytesBilled, publicDataset } from './data/query.ts'
import { withEnv } from './test/config.ts'

const secret = 'x'.repeat(32)

describe('config', () => {
  it.effect('defaults the server address', () =>
    Effect.gen(function* () {
      expect(yield* ServerConfig.host).toBe('127.0.0.1')
      expect(yield* ServerConfig.port).toBe(3000)
    }).pipe(Effect.provide(withEnv({}))),
  )

  it.effect('requires both chat settings', () =>
    Effect.gen(function* () {
      expect(yield* Effect.isFailure(ChatConfig)).toBe(true)

      const chat = yield* ChatConfig.pipe(
        Effect.provide(withEnv({ OPENAI_API_KEY: 'sk-test', CHAT_MODEL: 'model' })),
      )

      expect(Redacted.value(chat.apiKey)).toBe('sk-test')
      expect(chat.model).toBe('model')
    }).pipe(Effect.provide(withEnv({ CHAT_MODEL: 'model' }))),
  )

  it.effect('rejects a short auth secret', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(AuthConfig)

      expect(String(error)).toContain('BETTER_AUTH_SECRET must contain at least 32 characters.')
    }).pipe(Effect.provide(withEnv({ BETTER_AUTH_SECRET: 'short' }))),
  )

  it.effect('defaults the auth URL and trusted origins', () =>
    Effect.gen(function* () {
      const auth = yield* AuthConfig

      expect(Redacted.value(auth.secret)).toBe(secret)
      expect(auth.baseURL).toBe('http://localhost:3000')
      expect(auth.trustedOrigins).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173'])
    }).pipe(Effect.provide(withEnv({ BETTER_AUTH_SECRET: secret }))),
  )

  it.effect('trims trusted origins and drops empty ones', () =>
    Effect.gen(function* () {
      expect((yield* AuthConfig).trustedOrigins).toEqual(['https://a.test', 'https://b.test'])
    }).pipe(
      Effect.provide(
        withEnv({
          BETTER_AUTH_SECRET: secret,
          AUTH_TRUSTED_ORIGINS: ' https://a.test , ,https://b.test',
        }),
      ),
    ),
  )

  it.effect.each<{ env: Record<string, string>; path: string }>([
    { env: {}, path: '.data/groundwork.sqlite' },
    { env: { AUTH_DATABASE_PATH: 'old.sqlite' }, path: 'old.sqlite' },
    { env: { AUTH_DATABASE_PATH: 'old.sqlite', DATABASE_PATH: 'new.sqlite' }, path: 'new.sqlite' },
  ])('resolves the database path from $env', ({ env, path }) =>
    Effect.gen(function* () {
      expect((yield* DatabaseConfig).path).toBe(path)
    }).pipe(Effect.provide(withEnv(env))),
  )

  it.effect('defaults the warehouse to the public dataset without a project', () =>
    Effect.gen(function* () {
      const warehouse = yield* WarehouseConfig

      expect(warehouse.dataset).toBe(publicDataset)
      expect(warehouse.maxBytesBilled).toBe(defaultMaxBytesBilled)
      expect(warehouse.projectId._tag).toBe('None')
    }).pipe(Effect.provide(withEnv({}))),
  )

  it.effect('reads a bounded warehouse dataset', () =>
    Effect.gen(function* () {
      const warehouse = yield* WarehouseConfig

      expect(warehouse.dataset).toBe('my-project.pilot_1')
      expect(warehouse.maxBytesBilled).toBe(5)
    }).pipe(
      Effect.provide(
        withEnv({
          BIGQUERY_PROJECT_ID: 'my-project',
          BIGQUERY_DATASET: 'my-project.pilot_1',
          BIGQUERY_MAX_BYTES_BILLED: '5',
        }),
      ),
    ),
  )

  it.effect.each(['pilot', 'My-Project.pilot', 'project.1pilot', 'project.pilot.extra'])(
    'rejects the dataset %s',
    (dataset) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(WarehouseConfig)

        expect(String(error)).toContain('BIGQUERY_DATASET must be a project.dataset identifier.')
      }).pipe(Effect.provide(withEnv({ BIGQUERY_DATASET: dataset }))),
  )
})

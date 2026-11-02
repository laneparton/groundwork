import { Config, Schema } from 'effect'
import { defaultMaxBytesBilled, publicDataset } from './data/query.ts'

export const ServerConfig = {
  host: Config.NonEmptyString('HOST').pipe(Config.withDefault('127.0.0.1')),
  port: Config.Port('PORT').pipe(Config.withDefault(3000)),
}

export const ChatConfig = Config.all({
  apiKey: Config.schema(Schema.RedactedFromValue(Schema.NonEmptyString), 'OPENAI_API_KEY'),
  model: Config.NonEmptyString('CHAT_MODEL'),
})

export const AuthConfig = Config.all({
  secret: Config.schema(
    Schema.RedactedFromValue(
      Schema.String.check(
        Schema.isMinLength(32, {
          message: 'BETTER_AUTH_SECRET must contain at least 32 characters.',
        }),
      ),
    ),
    'BETTER_AUTH_SECRET',
  ),
  baseURL: Config.NonEmptyString('BETTER_AUTH_URL').pipe(
    Config.withDefault('http://localhost:3000'),
  ),
  trustedOrigins: Config.Array(Schema.String, 'AUTH_TRUSTED_ORIGINS').pipe(
    Config.withDefault(['http://localhost:5173', 'http://127.0.0.1:5173']),
    Config.map((origins) => origins.map((origin) => origin.trim()).filter(Boolean)),
  ),
})

export const DatabaseConfig = Config.all({
  path: Config.NonEmptyString('AUTH_DATABASE_PATH').pipe(Config.withDefault('.data/auth.sqlite')),
})

export const WarehouseConfig = Config.all({
  projectId: Config.NonEmptyString('BIGQUERY_PROJECT_ID').pipe(Config.option),
  dataset: Config.schema(
    Schema.String.check(
      Schema.isPattern(/^[a-z][a-z0-9-]*\.[A-Za-z_][A-Za-z0-9_]*$/, {
        message: 'BIGQUERY_DATASET must be a project.dataset identifier.',
      }),
    ),
    'BIGQUERY_DATASET',
  ).pipe(Config.withDefault(publicDataset)),
  maxBytesBilled: Config.Int('BIGQUERY_MAX_BYTES_BILLED').pipe(
    Config.withDefault(defaultMaxBytesBilled),
  ),
})

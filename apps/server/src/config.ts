import { Config } from 'effect'

export const ServerConfig = {
  host: Config.NonEmptyString('HOST').pipe(Config.withDefault('127.0.0.1')),
  port: Config.Port('PORT').pipe(Config.withDefault(3000)),
}

export const ChatConfig = Config.all({
  apiKey: Config.Redacted('OPENAI_API_KEY'),
  model: Config.NonEmptyString('CHAT_MODEL'),
})

export const AuthConfig = Config.all({
  secret: Config.Redacted('BETTER_AUTH_SECRET'),
  baseURL: Config.NonEmptyString('BETTER_AUTH_URL').pipe(
    Config.withDefault('http://localhost:3000'),
  ),
  databasePath: Config.NonEmptyString('AUTH_DATABASE_PATH').pipe(
    Config.withDefault('.data/auth.sqlite'),
  ),
  trustedOrigins: Config.String('AUTH_TRUSTED_ORIGINS').pipe(
    Config.withDefault('http://localhost:5173,http://127.0.0.1:5173'),
  ),
})

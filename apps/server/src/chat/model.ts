import { createOpenAI } from '@ai-sdk/openai'
import { Effect, Redacted } from 'effect'
import { ChatConfig } from '../config.ts'
import { ChatUnavailable } from '../http/errors.ts'

export const configuredModel = Effect.gen(function* () {
  const config = yield* ChatConfig.pipe(
    Effect.mapError(
      () =>
        new ChatUnavailable({
          message: 'Set OPENAI_API_KEY and CHAT_MODEL in the server .env to enable chat.',
        }),
    ),
  )

  const apiKey = Redacted.value(config.apiKey)

  if (apiKey.trim().length === 0) {
    return yield* Effect.fail(
      new ChatUnavailable({
        message: 'Set OPENAI_API_KEY in the server .env to enable chat.',
      }),
    )
  }

  return createOpenAI({ apiKey })(config.model)
})

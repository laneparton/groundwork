import { createOpenAI } from '@ai-sdk/openai'
import { validateUIMessages } from 'ai'
import { Effect, Redacted } from 'effect'
import { HttpServerResponse } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { createChatResponse } from '../chat/stream-response.ts'
import { ChatConfig } from '../config.ts'
import { Auth } from '../auth/service.ts'
import { Api } from './api.ts'

export const ChatHandlers = HttpApiBuilder.group(Api, 'chat', (handlers) =>
  handlers.handle('chat', ({ payload, request }) => Effect.gen(function* () {
    const auth = yield* Auth
    const session = yield* Effect.tryPromise({
      try: () => auth.api.getSession({ headers: new Headers(request.headers) }),
      catch: () => new Error('Session lookup failed.'),
    }).pipe(Effect.orDie)
    if (!session) {
      return yield* Effect.fail({ _tag: 'Unauthorized' as const, message: 'Sign in to chat.' })
    }
    const messages = yield* Effect.tryPromise({
      try: () => validateUIMessages({ messages: payload.messages }),
      catch: () => ({ _tag: 'InvalidChatRequest' as const, message: 'Invalid chat messages.' }),
    })
    const config = yield* ChatConfig.pipe(Effect.mapError(() => ({
      _tag: 'ChatUnavailable' as const,
      message: 'Set OPENAI_API_KEY and CHAT_MODEL in the server .env to enable chat.',
    })))
    if (Redacted.value(config.apiKey).trim().length === 0) {
      return yield* Effect.fail({
        _tag: 'ChatUnavailable' as const,
        message: 'Set OPENAI_API_KEY in the server .env to enable chat.',
      })
    }
    const model = createOpenAI({ apiKey: Redacted.value(config.apiKey) })(config.model)
    // The request scope stays open while the response streams. Stop the model
    // when the client disconnects or presses Stop.
    const controller = yield* Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (controller) => Effect.sync(() => controller.abort()),
    )
    const response = yield* Effect.tryPromise({
      try: () => createChatResponse(model, messages, controller.signal),
      catch: () => ({ _tag: 'InvalidChatRequest' as const, message: 'Messages could not be converted for the model.' }),
    })
    return HttpServerResponse.fromWeb(response)
  })),
)

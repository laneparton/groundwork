import { validateUIMessages } from 'ai'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { requireSession } from '../auth/session.ts'
import { configuredModel } from '../chat/model.ts'
import { streamResponse } from '../chat/stream-response.ts'
import { Api } from './api.ts'
import { InvalidChatRequest } from './errors.ts'

export const ChatHandlers = HttpApiBuilder.group(Api, 'chat', (handlers) =>
  handlers.handle('chat', ({ payload, request }) =>
    Effect.gen(function* () {
      yield* requireSession(new Headers(request.headers))

      const messages = yield* Effect.tryPromise({
        try: () => validateUIMessages({ messages: payload.messages }),
        catch: () => new InvalidChatRequest({ message: 'Invalid chat messages.' }),
      })

      const model = yield* configuredModel

      return yield* streamResponse(model, messages)
    }),
  ),
)

import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { requireSession } from '../auth/session.ts'
import { streamChatResponse } from '../chat/stream-response.ts'
import { Api } from './api.ts'

export const ChatHandlers = HttpApiBuilder.group(Api, 'chat', (handlers) =>
  handlers.handle('chat', ({ payload, request }) =>
    Effect.gen(function* () {
      yield* requireSession(new Headers(request.headers))

      return yield* streamChatResponse(payload.messages)
    }),
  ),
)

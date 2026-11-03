import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { requireSession } from '../auth/session.ts'
import { streamChatResponse, validateUserMessage } from '../chat/stream-response.ts'
import { ConversationStore } from '../conversations/store.ts'
import { Api } from './api.ts'

export const ChatHandlers = HttpApiBuilder.group(Api, 'chat', (handlers) =>
  handlers.handle('chat', ({ payload, request }) =>
    Effect.gen(function* () {
      const session = yield* requireSession(new Headers(request.headers))
      const store = yield* ConversationStore
      const message = yield* validateUserMessage(payload.message)
      const turn = yield* store.beginTurn(session.user.id, payload.id, message, payload.parentId)

      // Once streaming starts, the response's end releases the turn.
      return yield* streamChatResponse(turn.messages, turn.finish).pipe(
        Effect.onError(() => turn.release),
      )
    }),
  ),
)

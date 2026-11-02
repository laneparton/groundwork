import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { requireSession } from '../auth/session.ts'
import { streamChatResponse } from '../chat/stream-response.ts'
import { ConversationNotFound, ConversationStore } from '../conversations/store.ts'
import { Api } from './api.ts'

export const ChatHandlers = HttpApiBuilder.group(Api, 'chat', (handlers) =>
  handlers.handle('chat', ({ payload, request }) =>
    Effect.gen(function* () {
      const session = yield* requireSession(new Headers(request.headers))
      const store = yield* ConversationStore

      if (!store.get(session.user.id, payload.id)) {
        return yield* Effect.fail(new ConversationNotFound({ message: 'Conversation not found.' }))
      }

      return yield* streamChatResponse(payload.messages, (messages) => {
        store.saveMessages(session.user.id, payload.id, messages)
      })
    }),
  ),
)

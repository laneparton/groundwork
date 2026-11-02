import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { requireSession } from '../auth/session.ts'
import { ConversationNotFound, ConversationStore } from '../conversations/store.ts'
import { Api } from './api.ts'

const notFound = new ConversationNotFound({ message: 'Conversation not found.' })

export const ConversationHandlers = HttpApiBuilder.group(Api, 'conversations', (handlers) =>
  handlers
    .handle('list', ({ request }) =>
      Effect.gen(function* () {
        const session = yield* requireSession(new Headers(request.headers))
        const store = yield* ConversationStore

        return { conversations: store.list(session.user.id) }
      }),
    )
    .handle('create', ({ request }) =>
      Effect.gen(function* () {
        const session = yield* requireSession(new Headers(request.headers))
        const store = yield* ConversationStore

        return { id: store.create(session.user.id) }
      }),
    )
    .handle('get', ({ params, request }) =>
      Effect.gen(function* () {
        const session = yield* requireSession(new Headers(request.headers))
        const store = yield* ConversationStore
        const conversation = store.get(session.user.id, params.id)
        const messages = store.messages(session.user.id, params.id)

        if (!conversation || !messages) return yield* Effect.fail(notFound)

        return { ...conversation, messages }
      }),
    )
    .handle('update', ({ params, payload, request }) =>
      Effect.gen(function* () {
        const session = yield* requireSession(new Headers(request.headers))
        const store = yield* ConversationStore

        if (!store.update(session.user.id, params.id, payload)) return yield* Effect.fail(notFound)
      }),
    )
    .handle('remove', ({ params, request }) =>
      Effect.gen(function* () {
        const session = yield* requireSession(new Headers(request.headers))
        const store = yield* ConversationStore

        if (!store.remove(session.user.id, params.id)) return yield* Effect.fail(notFound)
      }),
    ),
)

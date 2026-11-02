import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { requireSession } from '../auth/session.ts'
import { ConversationStore } from '../conversations/store.ts'
import { Api } from './api.ts'

export const ConversationHandlers = HttpApiBuilder.group(Api, 'conversations', (handlers) =>
  handlers
    .handle('list', ({ request }) =>
      Effect.gen(function* () {
        const session = yield* requireSession(new Headers(request.headers))
        const store = yield* ConversationStore

        return { conversations: yield* store.list(session.user.id) }
      }),
    )
    .handle('create', ({ request }) =>
      Effect.gen(function* () {
        const session = yield* requireSession(new Headers(request.headers))
        const store = yield* ConversationStore

        return { id: yield* store.create(session.user.id) }
      }),
    )
    .handle('get', ({ params, request }) =>
      Effect.gen(function* () {
        const session = yield* requireSession(new Headers(request.headers))
        const store = yield* ConversationStore
        const conversation = yield* store.get(session.user.id, params.id)
        const messages = yield* store.messages(session.user.id, params.id)

        return { ...conversation, messages }
      }),
    )
    .handle('update', ({ params, payload, request }) =>
      Effect.gen(function* () {
        const session = yield* requireSession(new Headers(request.headers))
        const store = yield* ConversationStore

        yield* store.update(session.user.id, params.id, payload)
      }),
    )
    .handle('remove', ({ params, request }) =>
      Effect.gen(function* () {
        const session = yield* requireSession(new Headers(request.headers))
        const store = yield* ConversationStore

        yield* store.remove(session.user.id, params.id)
      }),
    ),
)

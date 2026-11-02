import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { AgentUnavailable } from '../agent/agent.ts'
import { Unauthorized } from '../auth/session.ts'
import { InvalidChatRequest } from '../chat/stream-response.ts'
import { ConversationNotFound } from '../conversations/store.ts'

export const HealthResponse = Schema.Struct({ status: Schema.Literal('ok') })

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))

// AI SDK validates the individual UI messages in the chat module.
export const ChatRequest = Schema.Struct({
  id: NonEmptyString,
  messages: Schema.Array(Schema.Unknown).check(Schema.isMinLength(1)),
})

const ConversationStatus = Schema.Literals(['regular', 'archived'])

export const ConversationSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  status: ConversationStatus,
  updatedAt: Schema.String,
})

export const Conversation = Schema.Struct({
  ...ConversationSummary.fields,
  messages: Schema.Array(Schema.Unknown),
})

export const ConversationUpdate = Schema.Struct({
  title: Schema.optional(NonEmptyString),
  status: Schema.optional(ConversationStatus),
})

const conversationParams = { id: Schema.String }

const conversationErrors = [
  Unauthorized.pipe(HttpApiSchema.status(401)),
  ConversationNotFound.pipe(HttpApiSchema.status(404)),
]

export const Api = HttpApi.make('groundwork').add(
  HttpApiGroup.make('health').add(
    HttpApiEndpoint.get('health', '/health', { success: HealthResponse }),
  ),
  HttpApiGroup.make('chat').add(
    HttpApiEndpoint.post('chat', '/chat', {
      payload: ChatRequest,
      success: HttpApiSchema.StreamUint8Array({ contentType: 'text/event-stream' }),
      error: [
        InvalidChatRequest.pipe(HttpApiSchema.status(400)),
        Unauthorized.pipe(HttpApiSchema.status(401)),
        ConversationNotFound.pipe(HttpApiSchema.status(404)),
        AgentUnavailable.pipe(HttpApiSchema.status(503)),
      ],
    }),
  ),
  HttpApiGroup.make('conversations').add(
    HttpApiEndpoint.get('list', '/conversations', {
      success: Schema.Struct({ conversations: Schema.Array(ConversationSummary) }),
      error: Unauthorized.pipe(HttpApiSchema.status(401)),
    }),
    HttpApiEndpoint.post('create', '/conversations', {
      success: Schema.Struct({ id: Schema.String }),
      error: Unauthorized.pipe(HttpApiSchema.status(401)),
    }),
    HttpApiEndpoint.get('get', '/conversations/:id', {
      params: conversationParams,
      success: Conversation,
      error: conversationErrors,
    }),
    HttpApiEndpoint.patch('update', '/conversations/:id', {
      params: conversationParams,
      payload: ConversationUpdate,
      error: conversationErrors,
    }),
    HttpApiEndpoint.delete('remove', '/conversations/:id', {
      params: conversationParams,
      error: conversationErrors,
    }),
  ),
)

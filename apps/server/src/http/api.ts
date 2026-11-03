import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { AgentUnavailable } from '../agent/agent.ts'
import { Unauthorized } from '../auth/session.ts'
import { InvalidChatRequest, SentMessage } from '../chat/stream-response.ts'
import {
  ConversationChanges,
  ConversationConflict,
  ConversationNotFound,
  ConversationSummary,
  ConversationTree,
} from '../conversations/schema.ts'

export const HealthResponse = Schema.Struct({ status: Schema.Literal('ok') })

// The server owns the history: a chat request carries only the new user message and
// the id of the stored message it follows.
export const ChatRequest = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  message: SentMessage,
  parentId: Schema.NullOr(Schema.String),
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
        ConversationConflict.pipe(HttpApiSchema.status(409)),
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
      success: ConversationSummary,
      error: conversationErrors,
    }),
    HttpApiEndpoint.get('messages', '/conversations/:id/messages', {
      params: conversationParams,
      success: ConversationTree,
      error: conversationErrors,
    }),
    HttpApiEndpoint.patch('update', '/conversations/:id', {
      params: conversationParams,
      payload: ConversationChanges,
      error: conversationErrors,
    }),
    HttpApiEndpoint.delete('remove', '/conversations/:id', {
      params: conversationParams,
      error: conversationErrors,
    }),
  ),
)

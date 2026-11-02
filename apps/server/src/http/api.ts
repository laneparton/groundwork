import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { AgentUnavailable } from '../agent/agent.ts'
import { Unauthorized } from '../auth/session.ts'
import { InvalidChatRequest } from '../chat/stream-response.ts'

export const HealthResponse = Schema.Struct({ status: Schema.Literal('ok') })

// AI SDK validates the individual UI messages in the chat module.
export const ChatRequest = Schema.Struct({
  messages: Schema.Array(Schema.Unknown).check(Schema.isMinLength(1)),
})

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
        AgentUnavailable.pipe(HttpApiSchema.status(503)),
      ],
    }),
  ),
)

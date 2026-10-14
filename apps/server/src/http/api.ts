import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { ChatUnavailable, InvalidChatRequest, Unauthorized } from './errors.ts'

export const HealthResponse = Schema.Struct({ status: Schema.Literal('ok') })

// AI SDK validates the individual UI messages in the handler.
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
        ChatUnavailable.pipe(HttpApiSchema.status(503)),
        Unauthorized.pipe(HttpApiSchema.status(401)),
      ],
    }),
  ),
)

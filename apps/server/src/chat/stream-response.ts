import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateId,
  toUIMessageStream,
  validateUIMessages,
  type UIMessage,
} from 'ai'
import { Effect, Schema } from 'effect'
import { HttpServerResponse } from 'effect/http'
import { Agent } from '../agent/agent.ts'

export class InvalidChatRequest extends Schema.TaggedError<InvalidChatRequest>()(
  'InvalidChatRequest',
  { message: Schema.String },
) {}

// The one message a client sends with a chat request. Only the server writes
// assistant messages; AI SDK validates the parts.
export const SentMessage = Schema.Struct({
  id: Schema.String,
  role: Schema.Literal('user'),
  metadata: Schema.optional(Schema.Unknown),
  parts: Schema.Unknown,
})

export function validateUserMessage(sent: typeof SentMessage.Type) {
  return Effect.gen(function* () {
    const [message] = yield* Effect.tryPromise({
      try: () => validateUIMessages({ messages: [sent] }),
      catch: () => new InvalidChatRequest({ message: 'Invalid chat message.' }),
    })

    if (!message) {
      return yield* new InvalidChatRequest({ message: 'Invalid chat message.' })
    }

    return message
  })
}

// Streams the response to `messages` and hands the full conversation to
// `saveConversation` when the stream ends, including a partial assistant message when
// the client stops or disconnects.
export function streamChatResponse<E>(
  messages: UIMessage[],
  saveConversation: (conversation: UIMessage[]) => Effect.Effect<void, E>,
) {
  return Effect.gen(function* () {
    const agent = yield* Agent

    // Stored history was valid when saved; recheck it against today's tools so a changed
    // tool fails here with a clear error instead of inside the model request.
    yield* Effect.tryPromise({
      try: () => validateUIMessages({ messages, tools: agent.tools }),
      catch: () =>
        new InvalidChatRequest({
          message: 'The stored conversation no longer matches the agent tools.',
        }),
    })

    const modelMessages = yield* Effect.tryPromise({
      try: () => convertToModelMessages(messages),
      catch: () =>
        new InvalidChatRequest({ message: 'Messages could not be converted for the model.' }),
    })

    // The final save runs after the request fiber has handed off the stream, so it
    // runs on this request's context to keep the configured logger.
    const runFork = Effect.runForkWith(yield* Effect.context<never>())

    // The request scope stays open while the response streams. Closing it, when the
    // client disconnects or presses Stop, aborts the model request and any running tool.
    const controller = yield* Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (controller) => Effect.sync(() => controller.abort()),
    )

    const result = yield* agent.stream(modelMessages, controller.signal)

    const response = createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        originalMessages: messages,
        generateMessageId: generateId,
        onEnd: ({ messages: conversation }) => {
          runFork(
            saveConversation(conversation).pipe(
              Effect.catchCause((cause) =>
                Effect.logError('Failed to save the conversation.', cause),
              ),
            ),
          )
        },
        onError: () =>
          'The model request failed. Check the server model configuration and try again.',
      }),
    })

    return HttpServerResponse.fromWeb(response)
  })
}

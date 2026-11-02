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

// Receives the conversation twice: with the user's turn before the model runs, and
// in full when the response stream ends, including a partial assistant message when
// the client stops or disconnects.
export type SaveConversation = (messages: UIMessage[]) => void

export function streamChatResponse(
  input: ReadonlyArray<unknown>,
  saveConversation: SaveConversation,
) {
  return Effect.gen(function* () {
    const agent = yield* Agent

    const messages = yield* Effect.tryPromise({
      try: () => validateUIMessages({ messages: input }),
      catch: () => new InvalidChatRequest({ message: 'Invalid chat messages.' }),
    })

    const modelMessages = yield* Effect.tryPromise({
      try: () => convertToModelMessages(messages),
      catch: () =>
        new InvalidChatRequest({ message: 'Messages could not be converted for the model.' }),
    })

    // Save the user's turn before calling the model so it survives a failed response.
    saveConversation(messages)

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
          try {
            saveConversation(conversation)
          } catch (error) {
            console.error('Failed to save the conversation.', error)
          }
        },
        onError: () =>
          'The model request failed. Check the server model configuration and try again.',
      }),
    })

    return HttpServerResponse.fromWeb(response)
  })
}

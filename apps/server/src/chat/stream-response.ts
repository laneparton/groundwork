import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  validateUIMessages,
} from 'ai'
import { Effect, Schema } from 'effect'
import { HttpServerResponse } from 'effect/http'
import { Agent } from '../agent/agent.ts'

export class InvalidChatRequest extends Schema.TaggedError<InvalidChatRequest>()(
  'InvalidChatRequest',
  { message: Schema.String },
) {}

export function streamChatResponse(input: ReadonlyArray<unknown>) {
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
        onError: () =>
          'The model request failed. Check the server model configuration and try again.',
      }),
    })

    return HttpServerResponse.fromWeb(response)
  })
}

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  stepCountIs,
  toUIMessageStream,
  type LanguageModel,
  type UIMessage,
} from 'ai'
import { Effect } from 'effect'
import { HttpServerResponse } from 'effect/http'
import { InvalidChatRequest } from '../http/errors.ts'
import { tools } from '../agent/tools.ts'
import { sourceInstructions } from '../agent/instructions.ts'

export function streamResponse(model: LanguageModel, messages: UIMessage[]) {
  return Effect.gen(function* () {
    // The request scope stays open while streaming. Abort the model request
    // when the client disconnects or presses Stop.
    const controller = yield* Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (controller) => Effect.sync(() => controller.abort()),
    )

    const response = yield* Effect.tryPromise({
      try: () => createChatResponse(model, messages, controller.signal),
      catch: () =>
        new InvalidChatRequest({
          message: 'Messages could not be converted for the model.',
        }),
    })

    return HttpServerResponse.fromWeb(response)
  })
}

export async function createChatResponse(
  model: LanguageModel,
  messages: UIMessage[],
  abortSignal: AbortSignal,
) {
  const result = streamText({
    model,
    system: sourceInstructions,
    tools,
    stopWhen: stepCountIs(25),
    messages: await convertToModelMessages(messages),
    abortSignal,
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      onError: () =>
        'The model request failed. Check the server model configuration and try again.',
    }),
  })
}

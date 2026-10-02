import { convertToModelMessages, createUIMessageStreamResponse, streamText, toUIMessageStream, type LanguageModel, type UIMessage } from 'ai'

export async function createChatResponse(model: LanguageModel, messages: UIMessage[], abortSignal: AbortSignal) {
  const result = streamText({
    model,
    messages: await convertToModelMessages(messages),
    abortSignal,
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      onError: () => 'The model request failed. Check the server model configuration and try again.',
    }),
  })
}

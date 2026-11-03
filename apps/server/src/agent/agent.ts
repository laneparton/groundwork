import { createOpenAI } from '@ai-sdk/openai'
import { stepCountIs, streamText, type ModelMessage } from 'ai'
import { Context, Effect, Layer, Option, Redacted, Schema } from 'effect'
import { ChatConfig } from '../config.ts'
import { Warehouse } from '../data/warehouse.ts'
import { buildInstructions } from './instructions.ts'
import { createTools } from './tools.ts'

const maxSteps = 25

export class AgentUnavailable extends Schema.TaggedError<AgentUnavailable>()('AgentUnavailable', {
  message: Schema.String,
}) {}

const makeAgent = Effect.gen(function* () {
  const warehouse = yield* Warehouse
  const chat = yield* Effect.option(ChatConfig)

  if (Option.isNone(chat)) {
    yield* Effect.logWarning('Chat is disabled until OPENAI_API_KEY and CHAT_MODEL are set.')
  }

  const model = Option.map(chat, (config) =>
    createOpenAI({ apiKey: Redacted.value(config.apiKey) })(config.model),
  )

  const system = buildInstructions(warehouse.dataset, warehouse.isPublicDataset)
  const tools = createTools(warehouse)

  const unavailable = new AgentUnavailable({
    message: 'Set OPENAI_API_KEY and CHAT_MODEL in the server .env to enable chat.',
  })

  return {
    /** Tool definitions, also used to validate tool parts in stored conversations. */
    tools,
    stream: (messages: ModelMessage[], abortSignal: AbortSignal) =>
      Effect.map(
        Effect.fromOption(model, () => unavailable),
        (languageModel) =>
          streamText({
            model: languageModel,
            system,
            tools,
            stopWhen: stepCountIs(maxSteps),
            messages,
            abortSignal,
          }),
      ),
  }
})

export class Agent extends Context.Service<Agent, Effect.Success<typeof makeAgent>>()(
  'groundwork/Agent',
) {}

export const AgentLive = Layer.effect(Agent)(makeAgent)

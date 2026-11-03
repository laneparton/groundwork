import { describe, expect, it } from '@effect/vitest'
import type { UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { Effect, Exit, Layer, Option, Scope } from 'effect'
import { Agent, makeAgent } from '../agent/agent.ts'
import { makeWarehouse } from '../data/warehouse.ts'
import { streamChatResponse } from './stream-response.ts'

const message: UIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }

// A model that streams nothing until the request is aborted.
const silentModel = new MockLanguageModelV4({
  doStream: async () => ({ stream: new ReadableStream({ start() {} }) }),
})

// Wraps the real agent to capture the signal the response hands to the model.
function agentCapturingSignal() {
  const agent = makeAgent(
    makeWarehouse(
      { projectId: Option.none(), dataset: 'p.pilot', maxBytesBilled: 1 },
      Option.none(),
    ),
    Option.some(silentModel),
  )

  const signals: AbortSignal[] = []

  const layer = Layer.succeed(Agent, {
    ...agent,
    stream: (messages, signal) => {
      signals.push(signal)

      return agent.stream(messages, signal)
    },
  })

  return { layer, signals }
}

describe('streamChatResponse', () => {
  it.effect('aborts the model request when the request scope closes', () => {
    const { layer, signals } = agentCapturingSignal()

    return Effect.gen(function* () {
      const scope = yield* Scope.make()

      yield* streamChatResponse([message], () => Effect.void).pipe(Scope.provide(scope))

      const [signal] = signals

      expect(signal?.aborted).toBe(false)

      // Closing the scope stands in for the client disconnecting or pressing Stop.
      yield* Scope.close(scope, Exit.void)

      expect(signal?.aborted).toBe(true)
    }).pipe(Effect.provide(layer))
  })
})

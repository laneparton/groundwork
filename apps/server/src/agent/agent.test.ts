import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { makeWarehouse, Warehouse } from '../data/warehouse.ts'
import { withEnv } from '../test/config.ts'
import { Agent, AgentLive, AgentUnavailable } from './agent.ts'

const WarehouseTest = Layer.succeed(
  Warehouse,
  makeWarehouse({ projectId: Option.none(), dataset: 'p.pilot', maxBytesBilled: 1 }, Option.none()),
)

const agentWith = (env: Record<string, string>) =>
  AgentLive.pipe(Layer.provide(WarehouseTest), Layer.provide(withEnv(env)))

describe('Agent', () => {
  it.effect('reports chat as unavailable until the model is configured', () =>
    Effect.gen(function* () {
      const agent = yield* Agent

      expect(Object.keys(agent.tools)).toEqual(['query_sql'])

      const error = yield* Effect.flip(agent.stream([], new AbortController().signal))

      expect(error).toBeInstanceOf(AgentUnavailable)
      expect(error.message).toContain('OPENAI_API_KEY')
    }).pipe(Effect.provide(agentWith({}))),
  )

  it.effect('streams from the configured model', () =>
    Effect.gen(function* () {
      const agent = yield* Agent
      const controller = new AbortController()
      controller.abort()

      // The aborted signal stops the request before it reaches the network.
      const result = yield* agent.stream([{ role: 'user', content: 'Hi' }], controller.signal)

      expect(result).toHaveProperty('textStream')
      yield* Effect.promise(() => result.consumeStream())
    }).pipe(Effect.provide(agentWith({ OPENAI_API_KEY: 'sk-test', CHAT_MODEL: 'test-model' }))),
  )
})

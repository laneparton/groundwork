import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Fiber, Layer, Option } from 'effect'
import { withEnv } from '../test/config.ts'
import { publicDataset, type QueryClient } from './query.ts'
import { makeWarehouse, Warehouse, WarehouseError, WarehouseLive } from './warehouse.ts'

const bounded = { projectId: Option.some('p'), dataset: 'p.pilot', maxBytesBilled: 10 }

// Answers every dry run as a SELECT on `p.pilot` and every query with `rows`.
const client = (rows: ReadonlyArray<object>, onResults?: () => Promise<void>): QueryClient => ({
  createQueryJob: async () => [
    {
      metadata: {
        statistics: {
          query: {
            statementType: 'SELECT',
            referencedTables: [{ projectId: 'p', datasetId: 'pilot' }],
          },
        },
      },
      cancel: async () => ({}),
      getQueryResults: async () => {
        await onResults?.()

        return [rows]
      },
    },
  ],
})

describe('Warehouse', () => {
  it.effect('explains how to configure BigQuery when no project is set', () =>
    Effect.gen(function* () {
      const warehouse = makeWarehouse({ ...bounded, projectId: Option.none() }, Option.none())
      const error = yield* Effect.flip(warehouse.query('SELECT 1'))

      expect(error).toBeInstanceOf(WarehouseError)
      expect(error.message).toContain('Set BIGQUERY_PROJECT_ID')
    }),
  )

  it.effect('returns rows from the client', () =>
    Effect.gen(function* () {
      const warehouse = makeWarehouse(bounded, Option.some(client([{ value: 1 }])))

      expect(warehouse).toMatchObject({ dataset: 'p.pilot', isPublicDataset: false })
      expect(yield* warehouse.query('SELECT 1')).toEqual({ rows: [{ value: 1 }], truncated: false })
    }),
  )

  it.effect('restricts a bounded dataset to its own tables', () =>
    Effect.gen(function* () {
      const warehouse = makeWarehouse(
        { ...bounded, dataset: 'p.other' },
        Option.some(client([{ value: 1 }])),
      )

      const error = yield* Effect.flip(warehouse.query('SELECT 1'))

      expect(error.message).toBe('Queries can only reference tables in p.other.')
    }),
  )

  it.effect('does not restrict the public dataset', () =>
    Effect.gen(function* () {
      const warehouse = makeWarehouse(
        { ...bounded, dataset: publicDataset },
        Option.some(client([{ value: 1 }])),
      )

      expect(warehouse.isPublicDataset).toBe(true)
      expect((yield* warehouse.query('SELECT 1')).rows).toEqual([{ value: 1 }])
    }),
  )

  it.effect('turns client failures into a WarehouseError with their message', () =>
    Effect.gen(function* () {
      const failing: QueryClient = { createQueryJob: async () => Promise.reject(new Error('boom')) }
      const warehouse = makeWarehouse(bounded, Option.some(failing))

      expect((yield* Effect.flip(warehouse.query('SELECT 1'))).message).toBe('boom')
    }),
  )

  it.effect('uses a generic message when the failure is not an Error', () =>
    Effect.gen(function* () {
      const failing: QueryClient = { createQueryJob: () => Promise.reject('nope') }
      const warehouse = makeWarehouse(bounded, Option.some(failing))

      expect((yield* Effect.flip(warehouse.query('SELECT 1'))).message).toBe('SQL query failed.')
    }),
  )

  it.live('aborts the query when the effect is interrupted', () =>
    Effect.gen(function* () {
      let release = () => {}
      let markStarted = () => {}

      const started = new Promise<void>((resolve) => {
        markStarted = resolve
      })

      const warehouse = makeWarehouse(
        bounded,
        Option.some(
          client([], () => {
            markStarted()

            return new Promise((resolve) => {
              release = resolve
            })
          }),
        ),
      )

      const fiber = yield* Effect.forkChild(warehouse.query('SELECT 1'))
      yield* Effect.promise(() => started)
      yield* Fiber.interrupt(fiber)
      release()

      expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true)
    }),
  )

  it.effect('builds the live warehouse from config', () =>
    Effect.gen(function* () {
      const warehouse = yield* Warehouse

      expect(warehouse.dataset).toBe(publicDataset)
      expect(yield* Effect.flip(warehouse.query('SELECT 1'))).toBeInstanceOf(WarehouseError)
    }).pipe(Effect.provide(WarehouseLive.pipe(Layer.provide(withEnv({}))))),
  )
})

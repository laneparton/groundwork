import { asSchema } from 'ai'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { WarehouseError, type Warehouse } from '../data/warehouse.ts'
import { createTools } from './tools.ts'

const warehouse = (query: Warehouse['Service']['query']): Warehouse['Service'] => ({
  dataset: 'p.pilot',
  isPublicDataset: false,
  query,
})

const run = (
  tools: ReturnType<typeof createTools>,
  sql: string,
  abortSignal = new AbortController().signal,
) =>
  tools.query_sql.execute?.(
    { sql },
    { toolCallId: 'call-1', messages: [], context: {}, abortSignal },
  )

describe('query_sql tool', () => {
  it('describes the dataset it queries', () => {
    const tools = createTools(warehouse(() => Effect.die('unused')))

    expect(tools.query_sql.description).toContain('against p.pilot')
  })

  it('validates and trims the SQL input', async () => {
    const schema = asSchema(
      createTools(warehouse(() => Effect.die('unused'))).query_sql.inputSchema,
    )

    expect(await schema.validate?.({ sql: '  SELECT 1  ' })).toEqual({
      success: true,
      value: { sql: 'SELECT 1' },
    })
    expect((await schema.validate?.({ sql: '   ' }))?.success).toBe(false)
  })

  it('returns query results to the model', async () => {
    const queries: string[] = []

    const tools = createTools(
      warehouse((sql) => {
        queries.push(sql)

        return Effect.succeed({ rows: [{ value: 1 }], truncated: false })
      }),
    )

    expect(await run(tools, 'SELECT 1')).toEqual({ rows: [{ value: 1 }], truncated: false })
    expect(queries).toEqual(['SELECT 1'])
  })

  it('returns warehouse errors to the model as data', async () => {
    const tools = createTools(
      warehouse(() => Effect.fail(new WarehouseError({ message: 'Bad SQL' }))),
    )

    expect(await run(tools, 'SELECT nope')).toEqual({ error: 'Bad SQL' })
  })

  it('stops the query when the request is aborted', async () => {
    let interrupted = false

    const tools = createTools(
      warehouse(() =>
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true
            }),
          ),
        ),
      ),
    )

    const controller = new AbortController()
    const result = run(tools, 'SELECT 1', controller.signal)
    controller.abort()

    await expect(result).rejects.toThrow()
    expect(interrupted).toBe(true)
  })
})

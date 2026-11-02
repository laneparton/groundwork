import { tool } from 'ai'
import { Effect } from 'effect'
import { z } from 'zod'
import { rowLimit } from '../data/query.ts'
import type { Warehouse } from '../data/warehouse.ts'

export function createTools(warehouse: Warehouse['Service']) {
  return {
    query_sql: tool({
      description: `Run a read-only GoogleSQL SELECT query against ${warehouse.dataset}. Returns up to ${rowLimit} rows and a truncation flag. Use fully qualified table names. Errors describe the SQL/data failure, not model configuration.`,
      inputSchema: z.object({
        sql: z
          .string()
          .trim()
          .min(1)
          .describe('One SELECT or WITH query, without scripting or write statements.'),
      }),
      // Query failures go back to the model as data. Aborting the request interrupts the query.
      execute: ({ sql }, { abortSignal }) =>
        Effect.runPromise(
          warehouse
            .query(sql)
            .pipe(
              Effect.catchTag('WarehouseError', ({ message }) =>
                Effect.succeed({ error: message }),
              ),
            ),
          { signal: abortSignal },
        ),
    }),
  }
}

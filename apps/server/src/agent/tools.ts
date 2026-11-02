import { tool } from 'ai'
import { z } from 'zod'
import { configuredBigQuery, querySql } from '../data/bigquery.ts'
import { configuredDataset } from '../data/source.ts'

export const tools = {
  query_sql: tool({
    description:
      'Run a read-only GoogleSQL SELECT query against ' +
      configuredDataset() +
      '. Returns up to 100 rows and a truncation flag. Use fully qualified table names. Errors describe the SQL/data failure, not model configuration.',
    inputSchema: z.object({
      sql: z
        .string()
        .trim()
        .min(1)
        .describe('One SELECT or WITH query, without scripting or write statements.'),
    }),
    execute: async ({ sql }, { abortSignal }) => {
      try {
        return await querySql(configuredBigQuery(), sql, abortSignal)
      } catch (error) {
        if (abortSignal?.aborted) throw error

        return { error: error instanceof Error ? error.message : 'SQL query failed.' }
      }
    },
  }),
}

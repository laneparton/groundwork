import { tool } from 'ai'
import { z } from 'zod'
import { configuredBigQuery, querySql } from '../data/bigquery.ts'

export const tools = {
  query_sql: tool({
    description:
      'Run a read-only GoogleSQL SELECT query against the public deps.dev BigQuery dataset. Returns up to 100 rows and a truncation flag. Use fully qualified table names.',
    inputSchema: z.object({
      sql: z
        .string()
        .trim()
        .min(1)
        .describe('One SELECT or WITH query, without scripting or write statements.'),
    }),
    execute: ({ sql }, { abortSignal }) => querySql(configuredBigQuery(), sql, abortSignal),
  }),
}

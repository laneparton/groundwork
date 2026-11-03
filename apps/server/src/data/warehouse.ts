import { type Config, Context, Effect, Layer, Option, Schema } from 'effect'
import { WarehouseConfig } from '../config.ts'
import {
  createBigQueryClient,
  publicDataset,
  runQuery,
  type QueryClient,
  type QueryResult,
} from './query.ts'

export class WarehouseError extends Schema.TaggedError<WarehouseError>()('WarehouseError', {
  message: Schema.String,
}) {}

export class Warehouse extends Context.Service<
  Warehouse,
  {
    /** The `project.dataset` that queries should target. */
    readonly dataset: string
    readonly isPublicDataset: boolean
    readonly query: (sql: string) => Effect.Effect<QueryResult, WarehouseError>
  }
>()('groundwork/Warehouse') {}

const notConfigured = new WarehouseError({
  message:
    'Set BIGQUERY_PROJECT_ID and configure Google Application Default Credentials to query the warehouse.',
})

// Takes the client so tests can supply a fake; the live layer builds a BigQuery client.
export function makeWarehouse(
  config: Config.Success<typeof WarehouseConfig>,
  client: Option.Option<QueryClient>,
): Warehouse['Service'] {
  const isPublicDataset = config.dataset === publicDataset

  const options = {
    maxBytesBilled: config.maxBytesBilled,
    restrictToDataset: isPublicDataset ? undefined : config.dataset,
  }

  return {
    dataset: config.dataset,
    isPublicDataset,
    query: (sql) =>
      Effect.gen(function* () {
        const bigQuery = yield* Effect.fromOption(client, () => notConfigured)

        // Interrupting the effect aborts the signal, which cancels the BigQuery job.
        return yield* Effect.tryPromise({
          try: (signal) => runQuery(bigQuery, sql, { ...options, signal }),
          catch: (error) =>
            new WarehouseError({
              message: error instanceof Error ? error.message : 'SQL query failed.',
            }),
        })
      }),
  }
}

export const WarehouseLive = Layer.effect(Warehouse)(
  Effect.map(WarehouseConfig, (config) =>
    makeWarehouse(config, Option.map(config.projectId, createBigQueryClient)),
  ),
)

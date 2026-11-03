import {
  BigQuery,
  type JobMetadata,
  type Query,
  type QueryResultsOptions,
} from '@google-cloud/bigquery'
import { z } from 'zod'

export const publicDataset = 'bigquery-public-data.deps_dev_v1'
export const defaultMaxBytesBilled = 20_000_000_000
export const rowLimit = 100

const location = 'US'
const jobTimeoutMs = 30_000
const rowsSchema = z.array(z.record(z.string(), z.json()))
const referencesSchema = z.array(z.object({ projectId: z.string(), datasetId: z.string() }))

export interface QueryOptions {
  readonly maxBytesBilled: number
  /** Reject queries that reference any dataset other than this `project.dataset`. */
  readonly restrictToDataset?: string | undefined
  readonly signal?: AbortSignal
}

export interface QueryResult {
  readonly rows: z.infer<typeof rowsSchema>
  readonly truncated: boolean
}

// The slice of the BigQuery client that runQuery uses, so tests can supply a fake.
export interface QueryJob {
  readonly metadata: JobMetadata
  readonly cancel: () => Promise<object>
  readonly getQueryResults: (
    options: QueryResultsOptions,
  ) => Promise<[ReadonlyArray<object>] | [ReadonlyArray<object>, Query | null, object]>
}

export interface QueryClient {
  readonly createQueryJob: (options: Query) => Promise<[QueryJob, ...object[]]>
}

export function createBigQueryClient(projectId: string): QueryClient {
  return new BigQuery({ projectId })
}

export async function runQuery(client: QueryClient, sql: string, options: QueryOptions) {
  const { signal } = options
  signal?.throwIfAborted()

  // Fetch one extra row so callers can tell when the result is truncated.
  const query = `SELECT * FROM (${sql.trim().replace(/;$/, '')}) AS query_result LIMIT ${rowLimit + 1}`

  // The dry run rejects scripts and write statements before anything is billed.
  const [preview] = await client.createQueryJob({
    query,
    useLegacySql: false,
    location,
    dryRun: true,
  })

  const statistics = preview.metadata.statistics?.query

  if (statistics?.statementType !== 'SELECT') {
    throw new Error('Only a single read-only SELECT or WITH query is supported.')
  }

  if (options.restrictToDataset) {
    const references = referencesSchema.parse([
      ...(statistics.referencedTables ?? []),
      ...(statistics.referencedLogicalViews ?? []),
    ])

    const outsideScope = references.some(
      (table) => `${table.projectId}.${table.datasetId}` !== options.restrictToDataset,
    )

    if (outsideScope) {
      throw new Error(`Queries can only reference tables in ${options.restrictToDataset}.`)
    }
  }

  signal?.throwIfAborted()

  const [job] = await client.createQueryJob({
    query,
    useLegacySql: false,
    location,
    maximumBytesBilled: String(options.maxBytesBilled),
    jobTimeoutMs,
  })

  const cancel = () => {
    void job.cancel().catch(() => {
      // Cancellation is best-effort; the server-side job timeout still applies.
    })
  }

  signal?.addEventListener('abort', cancel)

  try {
    if (signal?.aborted) {
      cancel()
      signal.throwIfAborted()
    }

    const [result, nextPage] = await job.getQueryResults({
      autoPaginate: false,
      maxResults: rowLimit + 1,
      wrapIntegers: { integerTypeCastFunction: (value: string) => value },
    })

    signal?.throwIfAborted()

    // The SDK returns class instances for dates and other values; serialize them to plain JSON.
    const rows = rowsSchema.parse(JSON.parse(JSON.stringify(result)))

    return {
      rows: rows.slice(0, rowLimit),
      truncated: rows.length > rowLimit || Boolean(nextPage?.pageToken),
    } satisfies QueryResult
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

import { BigQuery } from '@google-cloud/bigquery'
import { z } from 'zod'
import { configuredDataset, publicDataset } from './source.ts'

const rowsSchema = z.array(z.record(z.string(), z.json()))
const rowLimit = 100

export function configuredBigQuery() {
  const projectId = process.env.BIGQUERY_PROJECT_ID

  if (!projectId) {
    throw new Error(
      'Set BIGQUERY_PROJECT_ID and configure Google Application Default Credentials to query deps.dev.',
    )
  }

  return new BigQuery({ projectId })
}

export async function querySql(client: BigQuery, sql: string, abortSignal?: AbortSignal) {
  abortSignal?.throwIfAborted()

  // Wrap the result to cap rows; the dry run rejects scripts and write statements.
  // Fetch one extra row so the agent can tell when the returned data is truncated.
  const query = `SELECT * FROM (${sql.trim().replace(/;$/, '')}) AS query_result LIMIT ${rowLimit + 1}`

  const [preview] = await client.createQueryJob({
    query,
    useLegacySql: false,
    location: 'US',
    dryRun: true,
  })

  if (preview.metadata.statistics?.query?.statementType !== 'SELECT') {
    throw new Error('Only a single read-only SELECT or WITH query is supported.')
  }

  const dataset = configuredDataset()

  if (dataset !== publicDataset) {
    const references = z
      .array(z.object({ projectId: z.string(), datasetId: z.string() }))
      .parse([
        ...(preview.metadata.statistics?.query?.referencedTables ?? []),
        ...(preview.metadata.statistics?.query?.referencedLogicalViews ?? []),
      ])

    const outsideScope = references.some(
      (table) => table.projectId + '.' + table.datasetId !== dataset,
    )

    if (outsideScope) throw new Error('This pilot can only query tables in ' + dataset + '.')
  }

  abortSignal?.throwIfAborted()

  const [job] = await client.createQueryJob({
    query,
    useLegacySql: false,
    location: 'US',
    maximumBytesBilled: process.env.BIGQUERY_MAX_BYTES_BILLED ?? '20000000000',
    jobTimeoutMs: 30000,
  })

  const cancel = () => {
    void job.cancel().catch(() => {
      // Cancellation is best-effort; the server-side job timeout still applies.
    })
  }

  abortSignal?.addEventListener('abort', cancel, { once: true })

  try {
    if (abortSignal?.aborted) {
      cancel()
      abortSignal.throwIfAborted()
    }

    const [result, nextPage] = await job.getQueryResults({
      autoPaginate: false,
      maxResults: rowLimit + 1,
      wrapIntegers: { integerTypeCastFunction: (value: string) => value },
    })

    abortSignal?.throwIfAborted()

    // Parse the SDK boundary into JSON values, preserving nested records and arrays.
    const rows = rowsSchema.parse(JSON.parse(JSON.stringify(result)))

    return {
      rows: rows.slice(0, rowLimit),
      truncated: rows.length > rowLimit || Boolean(nextPage?.pageToken),
    }
  } finally {
    abortSignal?.removeEventListener('abort', cancel)
  }
}

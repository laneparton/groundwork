import type { JobMetadata, Query } from '@google-cloud/bigquery'
import { describe, expect, it } from 'vitest'
import { rowLimit, runQuery, type QueryClient, type QueryJob } from './query.ts'

type Statistics = NonNullable<NonNullable<JobMetadata['statistics']>['query']>

const options = { maxBytesBilled: 1_000, restrictToDataset: 'test-project.pilot' }
const inside = { projectId: 'test-project', datasetId: 'pilot' }

interface FakeClient {
  readonly client: QueryClient
  readonly jobs: Query[]
  readonly cancelled: () => number
}

// A BigQuery stand-in: the dry run reports `statistics`, the real job returns `results`.
function fakeClient(
  statistics: Statistics,
  results: QueryJob['getQueryResults'] = async () => [[]],
): FakeClient {
  const jobs: Query[] = []
  let cancels = 0

  const job = (metadata: JobMetadata): QueryJob => ({
    metadata,
    cancel: async () => {
      cancels++

      return {}
    },
    getQueryResults: results,
  })

  return {
    jobs,
    cancelled: () => cancels,
    client: {
      createQueryJob: async (query) => {
        jobs.push(query)

        return [job(query.dryRun ? { statistics: { query: statistics } } : {})]
      },
    },
  }
}

const select = (
  references: Pick<Statistics, 'referencedTables' | 'referencedLogicalViews'> = {},
): Statistics => ({ statementType: 'SELECT', ...references })

describe('runQuery', () => {
  it.each(['referencedTables', 'referencedLogicalViews'])(
    'rejects %s outside the restricted dataset before running',
    async (referenceType) => {
      const fake = fakeClient(
        select({ [referenceType]: [{ projectId: 'outside-project', datasetId: 'public' }] }),
      )

      await expect(runQuery(fake.client, 'SELECT 1', options)).rejects.toThrow(
        'Queries can only reference tables in test-project.pilot.',
      )
      expect(fake.jobs).toHaveLength(1)
    },
  )

  it('runs a restricted query when every reference is inside the dataset', async () => {
    const fake = fakeClient(
      select({ referencedTables: [inside], referencedLogicalViews: [inside] }),
      async () => [[{ value: 1 }]],
    )

    expect(await runQuery(fake.client, 'SELECT 1 AS value', options)).toEqual({
      rows: [{ value: 1 }],
      truncated: false,
    })

    const [dryRun, job] = fake.jobs

    expect(dryRun).toMatchObject({ dryRun: true, useLegacySql: false, location: 'US' })

    expect(job).toMatchObject({
      useLegacySql: false,
      maximumBytesBilled: '1000',
      jobTimeoutMs: 30_000,
    })

    expect(job?.dryRun).toBeUndefined()
  })

  it('reads one page with room for one extra row', async () => {
    const requests: Array<Parameters<QueryJob['getQueryResults']>[0]> = []

    const fake = fakeClient(select(), async (resultOptions) => {
      requests.push(resultOptions)

      return [[]]
    })

    await runQuery(fake.client, 'SELECT 1', options)

    // Auto-pagination would download every page of a large result.
    expect(requests).toEqual([
      expect.objectContaining({ autoPaginate: false, maxResults: rowLimit + 1 }),
    ])
  })

  it('does not report truncation at exactly the row limit', async () => {
    const rows = Array.from({ length: rowLimit }, (_, value) => ({ value }))
    const fake = fakeClient(select(), async () => [rows])

    expect(await runQuery(fake.client, 'SELECT 1', options)).toEqual({ rows, truncated: false })
  })

  it('stops listening for aborts once the query finishes', async () => {
    const controller = new AbortController()
    const fake = fakeClient(select())

    await runQuery(fake.client, 'SELECT 1', { ...options, signal: controller.signal })
    controller.abort()

    expect(fake.cancelled()).toBe(0)
  })

  it('skips the dataset check when the query is not restricted', async () => {
    const fake = fakeClient(select({ referencedTables: [{ projectId: 'a', datasetId: 'b' }] }))

    await expect(runQuery(fake.client, 'SELECT 1', { maxBytesBilled: 1 })).resolves.toEqual({
      rows: [],
      truncated: false,
    })
  })

  it('treats a restricted query without references as inside the dataset', async () => {
    const fake = fakeClient(select())

    await expect(runQuery(fake.client, 'SELECT 1', options)).resolves.toMatchObject({ rows: [] })
  })

  it.each([{ statementType: 'INSERT' }, { statementType: 'SCRIPT' }, {}])(
    'rejects anything but a single SELECT: %o',
    async (statistics) => {
      const fake = fakeClient(statistics)

      await expect(runQuery(fake.client, 'DELETE FROM t', options)).rejects.toThrow(
        'Only a single read-only SELECT or WITH query is supported.',
      )
      expect(fake.jobs).toHaveLength(1)
    },
  )

  it('rejects a dry run without statistics', async () => {
    const client: QueryClient = { createQueryJob: async () => [fakeJob({})] }

    await expect(runQuery(client, 'SELECT 1', options)).rejects.toThrow('Only a single read-only')
  })

  it('wraps the query in a row limit and drops only a trailing semicolon', async () => {
    const fake = fakeClient(select())

    await runQuery(fake.client, "  SELECT ';' AS s;  ", { maxBytesBilled: 1 })

    expect(fake.jobs[1]?.query).toBe(
      `SELECT * FROM (SELECT ';' AS s) AS query_result LIMIT ${rowLimit + 1}`,
    )
  })

  it('reports truncation when there are more rows than the limit', async () => {
    const rows = Array.from({ length: rowLimit + 1 }, (_, value) => ({ value }))
    const fake = fakeClient(select(), async () => [rows])

    const result = await runQuery(fake.client, 'SELECT 1', options)

    expect(result.rows).toHaveLength(rowLimit)
    expect(result.truncated).toBe(true)
  })

  it('reports truncation when BigQuery has another page', async () => {
    const fake = fakeClient(select(), async () => [[{ value: 1 }], { pageToken: 'next' }, {}])

    expect((await runQuery(fake.client, 'SELECT 1', options)).truncated).toBe(true)
  })

  it('does not report truncation for a final page without a token', async () => {
    const fake = fakeClient(select(), async () => [[{ value: 1 }], null, {}])

    expect((await runQuery(fake.client, 'SELECT 1', options)).truncated).toBe(false)
  })

  it('serializes SDK values such as dates to plain JSON and keeps integers as strings', async () => {
    let castInteger: string | undefined

    const fake = fakeClient(select(), async (resultOptions) => {
      const wrap = resultOptions.wrapIntegers

      if (wrap && wrap !== true)
        castInteger = String(wrap.integerTypeCastFunction('9007199254740993'))

      return [[{ day: new Date('2026-11-03T00:00:00.000Z') }]]
    })

    expect((await runQuery(fake.client, 'SELECT 1', options)).rows).toEqual([
      { day: '2026-11-03T00:00:00.000Z' },
    ])
    expect(castInteger).toBe('9007199254740993')
  })

  it('does nothing when the signal is already aborted', async () => {
    const fake = fakeClient(select())

    await expect(
      runQuery(fake.client, 'SELECT 1', { ...options, signal: AbortSignal.abort() }),
    ).rejects.toThrow()
    expect(fake.jobs).toHaveLength(0)
  })

  it('does not start the job when aborted during the dry run', async () => {
    const controller = new AbortController()
    const fake = fakeClient(select())

    const client: QueryClient = {
      createQueryJob: async (query) => {
        controller.abort()

        return fake.client.createQueryJob(query)
      },
    }

    await expect(
      runQuery(client, 'SELECT 1', { ...options, signal: controller.signal }),
    ).rejects.toThrow()
    expect(fake.jobs).toHaveLength(1)
  })

  it('cancels the job when aborted after it starts', async () => {
    const controller = new AbortController()

    const fake = fakeClient(select(), async () => {
      controller.abort()

      return [[{ value: 1 }]]
    })

    await expect(
      runQuery(fake.client, 'SELECT 1', { ...options, signal: controller.signal }),
    ).rejects.toThrow()
    expect(fake.cancelled()).toBe(1)
  })

  it('cancels the job when the abort lands between starting and reading results', async () => {
    const controller = new AbortController()
    let reads = 0

    const fake = fakeClient(select(), async () => {
      reads++

      return [[]]
    })

    const client: QueryClient = {
      createQueryJob: async (query) => {
        const created = await fake.client.createQueryJob(query)

        if (!query.dryRun) controller.abort()

        return created
      },
    }

    await expect(
      runQuery(client, 'SELECT 1', { ...options, signal: controller.signal }),
    ).rejects.toThrow()
    expect(fake.cancelled()).toBe(1)
    expect(reads).toBe(0)
  })

  it('ignores a failed cancel', async () => {
    const controller = new AbortController()

    const client: QueryClient = {
      createQueryJob: async (query) => [
        {
          ...fakeJob(query.dryRun ? { statistics: { query: select() } } : {}),
          cancel: async () => Promise.reject(new Error('already done')),
          getQueryResults: async () => {
            controller.abort()

            return [[]]
          },
        },
      ],
    }

    await expect(
      runQuery(client, 'SELECT 1', { ...options, signal: controller.signal }),
    ).rejects.toThrow()
  })
})

function fakeJob(metadata: JobMetadata): QueryJob {
  return { metadata, cancel: async () => ({}), getQueryResults: async () => [[]] }
}

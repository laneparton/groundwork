import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { configuredBigQuery } from '../src/data/bigquery.ts'

const plan = z
  .object({
    snapshot: z.iso.datetime({ offset: true }),
    destinationDataset: z.string().regex(/^groundwork_pilot_[0-9]{8}$/),
    families: z.array(z.string()),
    roots: z.array(z.tuple([z.string(), z.string()])),
    selections: z
      .array(
        z.object({
          table: z.enum([
            'Dependencies',
            'DependencyGraphEdges',
            'PackageVersions',
            'NPMRequirements',
            'Advisories',
          ]),
          sql: z.string().min(1),
        }),
      )
      .length(5),
  })
  .parse(JSON.parse(await readFile(new URL('../.data/pilot-plan.json', import.meta.url), 'utf8')))

const client = configuredBigQuery()
const project = await client.getProjectId()
const dataset = client.dataset(plan.destinationDataset)
const label = plan.snapshot.slice(0, 10).replaceAll('-', '')
const expirationMs = 7 * 24 * 60 * 60 * 1000
const estimates = []
let totalBytes = 0

// Re-estimate all source reads before any cloud writes; stop if the reviewed scope grows.
for (const selection of plan.selections) {
  const [preview] = await client.createQueryJob({
    query: selection.sql,
    dryRun: true,
    useLegacySql: false,
    location: 'US',
  })

  const bytes = Number(preview.metadata.statistics?.query?.totalBytesProcessed)

  if (!Number.isSafeInteger(bytes) || bytes <= 0)
    throw new Error('Invalid estimate for ' + selection.table)
  const cap = Math.ceil(bytes / 1048576) * 1048576
  totalBytes += cap
  estimates.push({ ...selection, maximumBytesBilled: String(cap) })
}

if (totalBytes > 80000000000) throw new Error('Extraction exceeds the reviewed 80 GB ceiling.')

const [exists] = await dataset.exists()

if (!exists) {
  await client.createDataset(plan.destinationDataset, {
    location: 'US',
    defaultTableExpirationMs: String(expirationMs),
    labels: { groundwork_pilot: label },
    description: 'Groundwork bounded deps.dev pilot. Source snapshot: ' + plan.snapshot,
  })
} else {
  const [metadata] = await dataset.getMetadata()

  if (metadata.labels?.groundwork_pilot !== label || metadata.location !== 'US') {
    throw new Error('Existing destination is not the expected Groundwork pilot.')
  }
}

const completed = []

for (const selection of estimates) {
  const table = dataset.table(selection.table)
  const [tableExists] = await table.exists()
  let billedBytes = '0'

  if (!tableExists) {
    console.log('Copying ' + selection.table + '...')

    const [job] = await client.createQueryJob({
      query: selection.sql,
      destination: table,
      writeDisposition: 'WRITE_EMPTY',
      useLegacySql: false,
      location: 'US',
      maximumBytesBilled: selection.maximumBytesBilled,
      jobTimeoutMs: 180000,
    })

    await job.getQueryResults({ autoPaginate: false, maxResults: 1 })
    const [jobMetadata] = await job.getMetadata()
    billedBytes = jobMetadata.statistics?.query?.totalBytesBilled ?? '0'
    await table.setMetadata({ description: 'Source snapshot: ' + plan.snapshot })
  }

  const [metadata] = await table.getMetadata()

  if (
    Number(metadata.numRows) <= 0 ||
    metadata.description !== 'Source snapshot: ' + plan.snapshot
  ) {
    throw new Error('Destination table is empty or has unexpected provenance: ' + selection.table)
  }

  const result = {
    table: selection.table,
    rows: metadata.numRows,
    storedBytes: metadata.numBytes,
    billedBytes,
  }

  completed.push(result)
  console.log(JSON.stringify(result))
  const alias = dataset.table(selection.table + 'Latest')
  const [aliasExists] = await alias.exists()

  if (!aliasExists) {
    const quote = String.fromCharCode(96)
    await dataset.createTable(selection.table + 'Latest', {
      view: {
        query:
          'SELECT * FROM ' +
          quote +
          project +
          '.' +
          plan.destinationDataset +
          '.' +
          selection.table +
          quote,
        useLegacySql: false,
      },
    })
  }
}

for (const selection of [
  {
    table: 'RootVersions',
    query: 'SELECT System, Name, Version, TIMESTAMP(@snapshot) AS SnapshotAt FROM UNNEST(@roots)',
    params: {
      snapshot: plan.snapshot,
      roots: plan.roots.map(([Name, Version]) => ({ System: 'NPM', Name, Version })),
    },
  },
  {
    table: 'SnapshotInfo',
    query:
      'SELECT TIMESTAMP(@snapshot) AS SnapshotAt, @families AS PackageFamilies, TRUE AS Bounded, TRUE AS CompleteAdvisorySnapshot',
    params: { snapshot: plan.snapshot, families: plan.families },
  },
]) {
  const table = dataset.table(selection.table)
  const [tableExists] = await table.exists()

  if (!tableExists) {
    const [job] = await client.createQueryJob({
      query: selection.query,
      params: selection.params,
      destination: table,
      writeDisposition: 'WRITE_EMPTY',
      location: 'US',
      useLegacySql: false,
      maximumBytesBilled: '10485760',
    })

    await job.getQueryResults({ autoPaginate: false, maxResults: 1 })
  }
}

await mkdir(new URL('../.data/', import.meta.url), { recursive: true })

await writeFile(
  new URL('../.data/pilot-created.json', import.meta.url),
  JSON.stringify(
    {
      dataset: project + '.' + plan.destinationDataset,
      snapshot: plan.snapshot,
      defaultExpirationDays: 7,
      tables: completed,
    },
    null,
    2,
  ) + '\n',
)

console.log('Pilot created: ' + project + '.' + plan.destinationDataset)

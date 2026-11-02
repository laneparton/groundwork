import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { configuredBigQuery, querySql } from '../src/data/bigquery.ts'

const created = z
  .object({
    dataset: z.string().regex(/^[a-z0-9-]+\.groundwork_pilot_[0-9]{8}$/),
    snapshot: z.iso.datetime({ offset: true }),
  })
  .parse(
    JSON.parse(await readFile(new URL('../.data/pilot-created.json', import.meta.url), 'utf8')),
  )

const client = configuredBigQuery()
const quote = String.fromCharCode(96)
const table = (name: string) => quote + created.dataset + '.' + name + quote

const sql = [
  'WITH endpoints AS (',
  'SELECT ' +
    quote +
    'From' +
    quote +
    '.System AS System, ' +
    quote +
    'From' +
    quote +
    '.Name AS Name, ' +
    quote +
    'From' +
    quote +
    '.Version AS Version FROM ' +
    table('DependencyGraphEdges'),
  'UNION DISTINCT SELECT ' +
    quote +
    'To' +
    quote +
    '.System, ' +
    quote +
    'To' +
    quote +
    '.Name, ' +
    quote +
    'To' +
    quote +
    '.Version FROM ' +
    table('DependencyGraphEdges'),
  ')',
  "SELECT 'missing_root_metadata' AS issue, COUNT(*) AS count FROM " +
    table('RootVersions') +
    ' r LEFT JOIN ' +
    table('PackageVersions') +
    ' p USING (System,Name,Version) WHERE p.Name IS NULL',
  "UNION ALL SELECT 'missing_dependency_metadata',COUNT(*) FROM " +
    table('Dependencies') +
    ' d LEFT JOIN ' +
    table('PackageVersions') +
    ' p ON d.Dependency.System=p.System AND d.Dependency.Name=p.Name AND d.Dependency.Version=p.Version WHERE p.Name IS NULL',
  "UNION ALL SELECT 'missing_endpoint_metadata',COUNT(*) FROM endpoints e LEFT JOIN " +
    table('PackageVersions') +
    ' p USING (System,Name,Version) WHERE p.Name IS NULL',
  "UNION ALL SELECT 'missing_advisory',COUNT(*) FROM " +
    table('PackageVersions') +
    ' p CROSS JOIN UNNEST(p.Advisories) ref LEFT JOIN ' +
    table('Advisories') +
    ' a ON ref.Source=a.Source AND ref.SourceID=a.SourceID WHERE a.SourceID IS NULL',
  "UNION ALL SELECT 'unexpected_dependency_root',COUNT(*) FROM " +
    table('Dependencies') +
    ' d LEFT JOIN ' +
    table('RootVersions') +
    ' r USING (System,Name,Version) WHERE r.Name IS NULL',
  "UNION ALL SELECT 'unexpected_graph_root',COUNT(*) FROM " +
    table('DependencyGraphEdges') +
    ' d LEFT JOIN ' +
    table('RootVersions') +
    ' r USING (System,Name,Version) WHERE r.Name IS NULL',
].join('\n')

const audit = await querySql(client, sql)

const checks = z
  .array(z.object({ issue: z.string(), count: z.coerce.number().int().nonnegative() }))
  .parse(audit.rows)

const failed = checks.filter((check) => check.count !== 0)

const rootStatus = await querySql(
  client,
  'SELECT r.System,r.Name,r.Version,p.DependenciesProcessed,p.DependencyError FROM ' +
    table('RootVersions') +
    ' r JOIN ' +
    table('PackageVersions') +
    ' p USING(System,Name,Version) ORDER BY r.Name,r.Version',
)

const roots = z
  .array(
    z.object({
      System: z.literal('NPM'),
      Name: z.string(),
      Version: z.string(),
      DependenciesProcessed: z.literal(true),
      DependencyError: z.literal(false),
    }),
  )
  .length(7)
  .parse(rootStatus.rows)

const snapshots = []

for (const name of [
  'Dependencies',
  'DependencyGraphEdges',
  'PackageVersions',
  'NPMRequirements',
  'Advisories',
  'RootVersions',
  'SnapshotInfo',
]) {
  const result = await querySql(
    client,
    'SELECT COUNTIF(SnapshotAt != TIMESTAMP ' +
      "'" +
      created.snapshot +
      "'" +
      ') AS mismatches FROM ' +
      table(name),
  )

  const row = z.object({ mismatches: z.coerce.number().int().nonnegative() }).parse(result.rows[0])

  if (row.mismatches !== 0) throw new Error('Wrong snapshot in ' + name)
  snapshots.push({ table: name, mismatches: row.mismatches })
}

const report = {
  dataset: created.dataset,
  snapshot: created.snapshot,
  checks,
  snapshots,
  roots,
}

await writeFile(
  new URL('../.data/pilot-validation.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
)

console.log(JSON.stringify(report, null, 2))

if (failed.length) throw new Error('Pilot validation failed.')

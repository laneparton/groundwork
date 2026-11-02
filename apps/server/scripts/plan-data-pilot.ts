import { mkdir, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { client } from './bigquery-client.ts'

const { values } = parseArgs({
  options: { snapshot: { type: 'string', default: '2026-10-26T21:00:03.696994Z' } },
})

const snapshot = z.iso.datetime({ offset: true }).parse(values.snapshot)
const quote = String.fromCharCode(96)
const source = (name: string) => quote + 'bigquery-public-data.deps_dev_v1.' + name + quote
const atSnapshot = "SnapshotAt = TIMESTAMP '" + snapshot + "'"
const families = "('react', 'react-dom', 'express', 'webpack', 'lodash')"

const roots = [
  "System = 'NPM' AND (",
  "  (Name = 'react' AND Version IN ('19.0.0', '19.2.0'))",
  "  OR (Name = 'react-dom' AND Version = '19.2.0')",
  "  OR (Name = 'express' AND Version IN ('4.18.2', '4.21.2'))",
  "  OR (Name = 'webpack' AND Version = '5.88.2')",
  "  OR (Name = 'lodash' AND Version = '4.17.20')",
  ')',
].join('\n')

const dependencies = [
  'SELECT SnapshotAt, System, Name, Version, Dependency, MinimumDepth',
  'FROM ' + source('Dependencies'),
  'WHERE ' + atSnapshot + ' AND ' + roots,
].join('\n')

// Preserve metadata for every resolved dependency, not only the seed families.
const packages = [
  'WITH selected_dependencies AS (' + dependencies + '),',
  'included AS (',
  '  SELECT DISTINCT Dependency.System AS System, Dependency.Name AS Name,',
  '                  Dependency.Version AS Version FROM selected_dependencies',
  ')',
  'SELECT p.SnapshotAt, p.System, p.Name, p.Version, p.Description, p.Licenses,',
  '       p.Advisories, p.VersionInfo, p.DependenciesProcessed, p.DependencyError',
  'FROM ' + source('PackageVersions') + ' AS p',
  'WHERE p.' + atSnapshot,
  "AND ((p.System = 'NPM' AND p.Name IN " + families + ')',
  'OR EXISTS (SELECT 1 FROM included AS d',
  '           WHERE d.System = p.System AND d.Name = p.Name AND d.Version = p.Version))',
].join('\n')

const selections = [
  { table: 'Dependencies', sql: dependencies },
  {
    table: 'DependencyGraphEdges',
    sql: [
      'SELECT SnapshotAt, System, Name, Version, Requirement,',
      '       ' + quote + 'From' + quote + ', ' + quote + 'To' + quote,
      'FROM ' + source('DependencyGraphEdges'),
      'WHERE ' + atSnapshot + ' AND ' + roots,
    ].join('\n'),
  },
  { table: 'PackageVersions', sql: packages },
  {
    table: 'NPMRequirements',
    sql: [
      'WITH selected_packages AS (' + packages + ')',
      'SELECT r.SnapshotAt, r.Name, r.Version, r.Dependencies, r.DevDependencies,',
      '       r.PeerDependencies, r.OptionalDependencies',
      'FROM ' + source('NPMRequirements') + ' AS r',
      'WHERE r.' + atSnapshot,
      'AND EXISTS (SELECT 1 FROM selected_packages AS p',
      "            WHERE p.System = 'NPM' AND p.Name = r.Name AND p.Version = r.Version)",
    ].join('\n'),
  },
  {
    // The complete advisory snapshot is small; keeping it avoids alias truncation.
    table: 'Advisories',
    sql: [
      'SELECT SnapshotAt, Source, SourceID, Title, Description, Severity,',
      '       CVSS3Score, GitHubSeverity, Aliases',
      'FROM ' + source('Advisories'),
      'WHERE ' + atSnapshot,
    ].join('\n'),
  },
]

const estimates = []

for (const selection of selections) {
  const [job] = await client.createQueryJob({
    query: selection.sql,
    dryRun: true,
    useLegacySql: false,
    location: 'US',
  })

  const bytes = Number(job.metadata.statistics?.query?.totalBytesProcessed)

  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error(
      'Missing or zero scan estimate for ' + selection.table + '. Check the snapshot.',
    )
  }

  const estimate = { ...selection, estimatedBytes: bytes }
  estimates.push(estimate)
  console.log(selection.table + ': ' + (bytes / 1e9).toFixed(3) + ' GB estimated scan')
}

let estimatedBytes = 0

for (const estimate of estimates) estimatedBytes += estimate.estimatedBytes

const plan = {
  snapshot,
  destinationDataset: 'groundwork_pilot_' + snapshot.slice(0, 10).replaceAll('-', ''),
  families: ['react', 'react-dom', 'express', 'webpack', 'lodash'],
  roots: [
    ['react', '19.0.0'],
    ['react', '19.2.0'],
    ['react-dom', '19.2.0'],
    ['express', '4.18.2'],
    ['express', '4.21.2'],
    ['webpack', '5.88.2'],
    ['lodash', '4.17.20'],
  ],
  selections: estimates,
  estimatedBytes,
  usdBeforeFreeTierAt625PerTiB: (estimatedBytes / 2 ** 40) * 6.25,
  note: 'Dry-run scan estimates, not output storage sizes. No extraction or dataset creation performed.',
}

await mkdir(new URL('../.data/', import.meta.url), { recursive: true })

await writeFile(
  new URL('../.data/pilot-plan.json', import.meta.url),
  JSON.stringify(plan, null, 2) + '\n',
)

console.log('Total estimated scan: ' + (estimatedBytes / 1e9).toFixed(3) + ' GB')

console.log('At $6.25/TiB before free allowance: $' + plan.usdBeforeFreeTierAt625PerTiB.toFixed(2))

console.log(
  'SQL and estimates saved to apps/server/.data/pilot-plan.json. No cloud tables were created.',
)

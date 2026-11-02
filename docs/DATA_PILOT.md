# Bounded warehouse pilot

Try one reproducible slice before committing to a larger data preparation pipeline.
The pilot is materialized and the local app is configured to query it. The
planning script remains dry-run only; creation and validation are separate commands.

## Scope

Source export: `2026-10-26T21:00:03.696994Z`, read from deps.dev's Snapshots table.
Destination: `ai-test-425016.groundwork_pilot_20261026`, in US.

Keep all package versions for five npm families: react, react-dom, express,
webpack, and lodash. Preserve their version ordering, descriptions, licenses,
advisory references, and dependency-processing status.

Extract complete source dependency closures and graph edges for these roots:

- react 19.0.0 and 19.2.0
- react-dom 19.2.0
- express 4.18.2 and 4.21.2
- webpack 5.88.2
- lodash 4.17.20

Also include package-version metadata and declared npm requirements for every
resolved dependency reached by those roots. Keep the complete advisory snapshot
so advisory aliases and severity metadata are retained. Do not sample graph
rows or apply a result-row limit to the extraction.

The copied tables are Dependencies, DependencyGraphEdges, PackageVersions,
NPMRequirements, and Advisories. When materializing, also publish the small root
and snapshot manifest so users and the agent can inspect graph coverage.
Metadata spans more versions than graph coverage does: an absent graph for an
unselected root must never be interpreted as an empty dependency list. Even for
selected roots, inspect DependenciesProcessed and DependencyError before
interpreting missing graph rows.

## Estimate before copying

From the repository root, with Google ADC and BIGQUERY_PROJECT_ID configured:

```sh
node --env-file-if-exists=apps/server/.env apps/server/scripts/plan-data-pilot.ts
```

Use `--snapshot <timestamp>` to plan a different export. The script uses an exact
TIMESTAMP predicate on the source tables rather than a dynamic Latest view. The
actual timestamp matters; midnight on the same date is not the export time.

SQL, scope, and estimates are saved to the ignored file
`apps/server/.data/pilot-plan.json`.

Dry runs on 2026-10-29 estimated:

| Selection | Estimated source scan |
| --- | ---: |
| Dependencies | 1.718 GB |
| DependencyGraphEdges | 2.415 GB |
| PackageVersions, including reached dependencies | 26.187 GB |
| NPMRequirements for the included versions | 42.707 GB |
| Complete advisory snapshot | 0.236 GB |
| **Total** | **73.263 GB** |

At $6.25 per TiB, that is approximately **$0.42 before free-tier allowance**.
These are scan estimates, not output sizes or a guaranteed final bill. They
include repeated source reads in the standalone extraction queries. Measured
storage and billed reads are recorded below. Re-run the planner before another extraction.

## Proof that the slice retains useful difficulty

A live, fixed-partition summary was run within the existing 20 GB cap:

| Root | Direct dependency versions | Indirect-only versions | Distinct dependency names | Resolved versions | Maximum depth |
| --- | ---: | ---: | ---: | ---: | ---: |
| express 4.18.2 | 31 | 39 | 69 | 70 | 6 |
| express 4.21.2 | 31 | 40 | 69 | 71 | 6 |
| react-dom 19.2.0 | 1 | 0 | 1 | 1 | 1 |
| webpack 5.88.2 | 24 | 57 | 76 | 81 | 4 |

This preserves questions about names versus resolved versions, direct versus
indirect dependencies, multi-level paths, version-to-version changes, declared
requirements versus resolved versions, and advisory alias deduplication.

Pinning the source partition alone already makes these selected graph summaries
affordable. Copying still provides a controlled scope and retained data for
repeatable evals; it is not the only possible fix for the original scan problem.

## Materialization and acceptance

The temporary dataset was created with seven-day default table expiration;
the copied tables expire on November 5, 2026.
Its five copied tables contain:

| Table | Rows | Logical stored bytes |
| --- | ---: | ---: |
| Dependencies | 223 | 14,445 |
| DependencyGraphEdges | 378 | 34,300 |
| PackageVersions | 7,396 | 1,089,196 |
| NPMRequirements | 7,396 | 2,006,268 |
| Advisories | 285,889 | 235,559,810 |

Total storage is approximately 239 MB. The extraction billed approximately
43.0 GB of reads, equivalent to about $0.24 at $6.25/TiB before free allowance.
RootVersions and SnapshotInfo publish coverage and provenance. Latest aliases
point at the fixed copied tables; they do not track later public exports.

Commands from the repository root:

```sh
node --env-file-if-exists=apps/server/.env apps/server/scripts/plan-data-pilot.ts
node --env-file-if-exists=apps/server/.env apps/server/scripts/create-data-pilot.ts
node --env-file-if-exists=apps/server/.env apps/server/scripts/validate-data-pilot.ts
```

Creation re-estimates all reads before writing, enforces an 80 GB total ceiling
and per-query scan caps, and does not overwrite existing tables. It can resume
this labelled pilot after a partial creation. Once tables expire, recreating
from the public source requires that this export is still retained there.

Validation passed with seven valid roots, zero missing root/dependency/endpoint
metadata, zero unresolved advisory references, zero unexpected graph roots,
and zero mismatched snapshot timestamps. All selected roots have processed
resolution and no dependency error. Validation and extraction summaries are
saved under the ignored `apps/server/.data/` directory.

Set `BIGQUERY_DATASET=ai-test-425016.groundwork_pilot_20261026` in the server
`.env` to use the pilot. Remove that setting, or set it to
`bigquery-public-data.deps_dev_v1`, to restore public data. Restart the server
when changing `.env`. The app's normal SQL cap remains 20 GB and the tool stays
read-only. In pilot mode, dry-run table and view references must belong to the configured
dataset; the agent cannot silently fall back to public tables.

Instructions distinguish metadata coverage from copied graph coverage and expose
NPMRequirementsLatest for declared ranges and peers. SQL errors are returned as
actual tool errors instead of a generic model-configuration failure.

The warehouse evals are refreshed for this exact export and their graph cases
are enabled. The CVE case uses two lodash versions to preserve deduplication,
the severity case reflects non-overlapping aliases in this snapshot, and both
positive and empty graph/advisory joins have verified expected answers. A new
coverage case checks metadata without a copied graph. Reference SQL is in
`evals/suites/warehouse/reference.sql`.

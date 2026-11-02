import assert from 'node:assert/strict'
import test from 'node:test'
import { runQuery } from './query.ts'

const options = { maxBytesBilled: 1_000, restrictToDataset: 'test-project.pilot' }

function dryRun(query) {
  return [{ metadata: { statistics: { query: { statementType: 'SELECT', ...query } } } }]
}

test('A restricted query rejects tables and logical views outside the dataset', async () => {
  for (const referenceType of ['referencedTables', 'referencedLogicalViews']) {
    let calls = 0

    const client = {
      async createQueryJob(job) {
        calls++
        assert.equal(job.dryRun, true)

        return dryRun({ [referenceType]: [{ projectId: 'outside-project', datasetId: 'public' }] })
      },
    }

    await assert.rejects(
      runQuery(client, 'SELECT 1', options),
      /only reference tables in test-project.pilot/,
    )
    assert.equal(calls, 1, 'The query never executes')
  }
})

test('A restricted query runs when every reference is inside the dataset', async () => {
  const reference = { projectId: 'test-project', datasetId: 'pilot' }
  let calls = 0

  const client = {
    async createQueryJob(job) {
      calls++

      if (job.dryRun) {
        return dryRun({ referencedTables: [reference], referencedLogicalViews: [reference] })
      }

      assert.equal(job.maximumBytesBilled, '1000')

      return [{ getQueryResults: async () => [[{ value: 1 }]] }]
    },
  }

  assert.deepEqual(await runQuery(client, 'SELECT 1 AS value', options), {
    rows: [{ value: 1 }],
    truncated: false,
  })
  assert.equal(calls, 2)
})

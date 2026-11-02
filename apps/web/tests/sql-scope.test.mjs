import assert from 'node:assert/strict'
import test from 'node:test'
import { querySql } from '../../server/src/data/bigquery.ts'

test('Pilot scope checks both tables and logical views before executing SQL', async (t) => {
  const originalDataset = process.env.BIGQUERY_DATASET
  process.env.BIGQUERY_DATASET = 'test-project.pilot'
  t.after(() => {
    if (originalDataset === undefined) delete process.env.BIGQUERY_DATASET
    else process.env.BIGQUERY_DATASET = originalDataset
  })

  for (const referenceType of ['referencedTables', 'referencedLogicalViews']) {
    let calls = 0

    const client = {
      async createQueryJob(options) {
        calls++
        assert.equal(options.dryRun, true)

        return [
          {
            metadata: {
              statistics: {
                query: {
                  statementType: 'SELECT',
                  [referenceType]: [{ projectId: 'outside-project', datasetId: 'public' }],
                },
              },
            },
          },
        ]
      },
    }

    await assert.rejects(querySql(client, 'SELECT 1'), /only query tables in test-project.pilot/)
    assert.equal(calls, 1)
  }

  let calls = 0

  const client = {
    async createQueryJob(options) {
      calls++

      if (options.dryRun) {
        const reference = { projectId: 'test-project', datasetId: 'pilot' }

        return [
          {
            metadata: {
              statistics: {
                query: {
                  statementType: 'SELECT',
                  referencedTables: [reference],
                  referencedLogicalViews: [reference],
                },
              },
            },
          },
        ]
      }

      return [
        {
          async getQueryResults() {
            return [[{ value: 1 }]]
          },
        },
      ]
    },
  }

  assert.deepEqual(await querySql(client, 'SELECT 1 AS value'), {
    rows: [{ value: 1 }],
    truncated: false,
  })
  assert.equal(calls, 2)
})

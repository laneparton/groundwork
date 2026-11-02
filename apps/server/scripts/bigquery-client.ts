import { createBigQueryClient } from '../src/data/query.ts'

const projectId = process.env.BIGQUERY_PROJECT_ID

if (!projectId) {
  throw new Error('Set BIGQUERY_PROJECT_ID and configure Google Application Default Credentials.')
}

export const client = createBigQueryClient(projectId)

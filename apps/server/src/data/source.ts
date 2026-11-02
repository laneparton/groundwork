import { z } from 'zod'

const datasetSchema = z.string().regex(/^[a-z][a-z0-9-]*\.[A-Za-z_][A-Za-z0-9_]*$/)
export const publicDataset = 'bigquery-public-data.deps_dev_v1'

export function configuredDataset() {
  return datasetSchema.parse(process.env.BIGQUERY_DATASET ?? publicDataset)
}

import { describe, expect, it } from 'vitest'
import { rowLimit } from '../data/query.ts'
import { buildInstructions } from './instructions.ts'

describe('buildInstructions', () => {
  it('points the model at the dataset and the row limit', () => {
    const instructions = buildInstructions('p.pilot', false)

    expect(instructions).toContain('fully qualified tables in p.pilot')
    expect(instructions).toContain('p.pilot.INFORMATION_SCHEMA.COLUMNS')
    expect(instructions).toContain(`at most ${rowLimit} rows`)
  })

  it('describes the public dataset', () => {
    const instructions = buildInstructions('bigquery-public-data.deps_dev_v1', true)

    expect(instructions).toContain('This is the public dataset.')
    expect(instructions).not.toContain('BOUNDED')
  })

  it('warns about a bounded copy', () => {
    const instructions = buildInstructions('p.pilot', false)

    expect(instructions).toContain('This is a BOUNDED copy')
    expect(instructions).not.toContain('This is the public dataset.')
  })
})

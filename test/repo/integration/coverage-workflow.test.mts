import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'
import { parse } from 'yaml'

interface Step {
  name: string
  run?: string
  uses?: string
  env?: Record<string, string>
  with?: Record<string, string>
}
interface Job {
  if: string
  needs?: string[]
  'runs-on': string
  strategy?: { matrix: { shard: number[] }; 'fail-fast': boolean }
  steps: Step[]
}
const workflow = parse(
  readFileSync(
    new URL('../../../.github/workflows/ci-gates.yml', import.meta.url),
    'utf8',
  ),
) as { jobs: Record<string, Job> }

function jobStep(job: Job, name: string): Step {
  const step = job.steps.find(candidate => candidate.name === name)
  if (!step) throw new Error(`Missing coverage step: ${name}`)
  return step
}

test('collects all four milestone shards and aggregates their complete receipts on macOS', () => {
  const collection = workflow.jobs['cover-shards']!
  const aggregate = workflow.jobs['coverage']!
  expect(collection.if).toBe(
    "github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/')",
  )
  expect(collection.strategy).toEqual({
    'fail-fast': false,
    matrix: { shard: [1, 2, 3, 4] },
  })
  expect(aggregate.needs).toEqual(['cover-shards'])
  expect(aggregate.if).toBe(
    "${{ !cancelled() && needs.cover-shards.result != 'skipped' }}",
  )
  for (const job of [collection, aggregate]) {
    expect(job['runs-on']).toBe('macos-26')
    expect(jobStep(job, 'Bootstrap checkout').env?.['TRIGGER_REF']).toBe(
      '${{ github.sha }}',
    )
  }
  expect(jobStep(collection, 'Collect coverage').with).toEqual({
    'setup-script': 'pnpm run build',
    'main-script': 'pnpm run cover:shard --shard="$COVERAGE_SHARD/4"',
  })
  expect(jobStep(collection, 'Upload coverage collection').with?.['path']).toBe(
    '.cache/fleet/coverage-shards/${{ matrix.shard }}',
  )
  for (const [ordinal, index] of [
    ['first', 1],
    ['second', 2],
    ['third', 3],
    ['fourth', 4],
  ] as const) {
    expect(
      jobStep(aggregate, `Download ${ordinal} coverage collection`).with,
    ).toEqual({
      name: `coverage-shard-${index}`,
      path: `.cache/fleet/coverage-shards/${index}`,
    })
  }
  expect(jobStep(aggregate, 'Apply full coverage gates').with).toEqual({
    'setup-script': 'pnpm run build',
    'main-script': 'pnpm run cover:aggregate --shards=4',
  })
})

test.each(['failure', 'cancelled', 'skipped', '', 'success'])(
  'requires successful collection before aggregation: %s',
  result => {
    const gate = jobStep(
      workflow.jobs['coverage']!,
      'Require successful coverage collection',
    )
    const execution = spawnSync(
      '/bin/bash',
      ['-euo', 'pipefail', '-c', gate.run!],
      {
        env: { COLLECTION_RESULT: result },
        encoding: 'utf8',
      },
    )
    expect(execution.status).toBe(result === 'success' ? 0 : 1)
  },
)

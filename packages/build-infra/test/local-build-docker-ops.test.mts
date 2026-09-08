import { expect, test } from 'vitest'
import { summarizeDockerBuilds } from '../lib/local-build-docker-ops.mts'
import { LINUX_TARGETS } from '../lib/local-build-setup.mts'

test('reports success when every Docker target succeeded', () => {
  const target = LINUX_TARGETS[0]!
  const results = { [target]: true }
  expect(summarizeDockerBuilds({ results, targets: [target] })).toEqual({
    ok: true,
    results,
  })
})
test('does not count a skipped target as a Docker failure', () => {
  const target = LINUX_TARGETS[0]!
  const results = { [target]: true, 'example-unsupported-target': false }
  expect(
    summarizeDockerBuilds({
      results,
      targets: [target, 'example-unsupported-target'],
    }).ok,
  ).toBe(true)
})
test('reports a failed image verification', () => {
  const target = LINUX_TARGETS[0]!
  const results = { [target]: false }
  expect(summarizeDockerBuilds({ results, targets: [target] }).ok).toBe(false)
})

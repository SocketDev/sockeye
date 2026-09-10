import process from 'node:process'

import { expect, test } from 'vitest'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { getBinaryPath, getBuildMode } from '../../../scripts/repo/paths.mts'

test('public preview works with stdin closed and an empty parent environment', () => {
  const binary = getBinaryPath(
    getBuildMode(),
    `${process.platform}-${process.arch}`,
  )
  const result = spawnSync(
    binary,
    [
      'explain',
      '--credential',
      'EXAMPLE_TOKEN',
      '--cwd',
      process.cwd(),
      '--',
      '/usr/bin/true',
    ],
    { encoding: 'utf8', env: {}, input: '', timeout: 10_000 },
  )
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('no authorization granted')
  expect(result.stdout).toMatch(/manifest: sha256:[a-f0-9]{64}\n/u)
  expect(result.stderr).toBe('')
})

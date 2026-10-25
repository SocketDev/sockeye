import process from 'node:process'

import { afterEach, expect, test } from 'vitest'

import { parseBuildArgs } from '../../../packages/node-smol-builder/scripts/common/shared/parse-build-args.mts'

const originalArguments = process.argv

afterEach(() => {
  process.argv = originalArguments
})

test('accepts an explicit Linux libc and checkpoint interval', () => {
  process.argv = [
    'node',
    'example-build.mts',
    '--platform',
    'linux',
    '--libc',
    'musl',
    '--dev',
    '--from-checkpoint',
    'binary-released',
    '--stop-at',
    'finalized',
  ]
  expect(parseBuildArgs()).toMatchObject({
    BUILD_MODE: 'dev',
    TARGET_PLATFORM: 'linux',
    TARGET_LIBC: 'musl',
    FROM_CHECKPOINT: 'binary-released',
    STOP_AT: 'finalized',
  })
})

test('rejects unsupported libc and contradictory checkpoint selectors', () => {
  for (const args of [
    ['--platform', 'darwin', '--libc', 'musl'],
    ['--platform', 'linux', '--libc', 'unsupported'],
    ['--from-checkpoint', 'unsupported'],
    ['--stop-at', 'unsupported'],
    ['--build-only', 'unsupported'],
    ['--build-only', 'finalized', '--stop-at', 'finalized'],
    ['--build-only', 'finalized', '--from-checkpoint', 'binary-released'],
  ]) {
    process.argv = ['node', 'example-build.mts', ...args]
    expect(() => parseBuildArgs()).toThrow()
  }
})

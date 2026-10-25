import { beforeEach, expect, test, vi } from 'vitest'
import { CHECKPOINTS } from 'local-build-infra/lib/constants'
import {
  getBuildResumePlan,
  reportBuildStop,
  validateBuildResume,
} from '../../scripts/common/shared/build-decisions.mts'

const io = vi.hoisted(() => ({ exists: vi.fn() }))
vi.mock(import('node:fs'), async importOriginal => {
  const original = await importOriginal()
  return {
    ...original,
    existsSync: filename =>
      String(filename).startsWith('/example/')
        ? io.exists(filename)
        : original.existsSync(filename),
  }
})
beforeEach(() => {
  vi.clearAllMocks()
  io.exists.mockReturnValue(true)
})

for (const [checkpoint, expected] of [
  [undefined, [false, false, false]],
  ['unknown', [false, false, false]],
  [CHECKPOINTS.BINARY_RELEASED, [true, false, false]],
  [CHECKPOINTS.BINARY_STRIPPED, [true, false, false]],
  [CHECKPOINTS.BINARY_COMPRESSED, [true, true, false]],
  [CHECKPOINTS.FINALIZED, [true, true, true]],
] as const) {
  test(`resumes only the required phases from ${checkpoint}`, () => {
    const plan = getBuildResumePlan(checkpoint)
    expect([
      plan.skipReleasePhase,
      plan.skipToCompressed,
      plan.skipToFinalized,
    ]).toEqual(expected)
  })
}

for (const checkpoint of [
  CHECKPOINTS.BINARY_RELEASED,
  CHECKPOINTS.BINARY_STRIPPED,
  CHECKPOINTS.BINARY_COMPRESSED,
]) {
  test(`stops exactly at requested phase ${checkpoint}`, () => {
    const config = {
      binaryLabel: 'Example',
      binaryPath: '/example/node',
      buildOnly: undefined,
      stopAt: undefined,
    }
    expect(reportBuildStop(checkpoint, config)).toBe(false)
    expect(
      reportBuildStop(checkpoint, { ...config, buildOnly: checkpoint }),
    ).toBe(true)
    expect(reportBuildStop(checkpoint, { ...config, stopAt: checkpoint })).toBe(
      true,
    )
    expect(
      reportBuildStop('other-phase', { ...config, stopAt: checkpoint }),
    ).toBe(false)
  })
}

test('requires the release binary when resuming after compilation', () => {
  const config = {
    buildDir: '/example/build',
    outputReleaseBinary: '/example/release/node',
  }
  validateBuildResume(CHECKPOINTS.BINARY_RELEASED, config)
  expect(io.exists).toHaveBeenCalledWith('/example/release/node')
  io.exists.mockReturnValue(false)
  expect(() =>
    validateBuildResume(CHECKPOINTS.BINARY_RELEASED, config),
  ).toThrow()
})

test('requires checkpoint metadata when resuming a later phase', () => {
  const config = {
    buildDir: '/example/build',
    outputReleaseBinary: '/example/release/node',
  }
  validateBuildResume(CHECKPOINTS.BINARY_STRIPPED, config)
  expect(io.exists).toHaveBeenCalledWith(
    '/example/build/checkpoints/binary-stripped.json',
  )
  io.exists.mockReturnValue(false)
  expect(() =>
    validateBuildResume(CHECKPOINTS.BINARY_STRIPPED, config),
  ).toThrow()
})

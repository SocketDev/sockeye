import { buildBinSuitePackage } from '../lib/builder.mts'
import { beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  binaryExists: false,
  checkpointExists: false,
  failure: new Error('Fixture tool invocation stopped'),
  runCommand: vi.fn(),
  shouldRun: vi.fn(),
}))

vi.mock(import('node:fs'), async importOriginal => ({
  ...(await importOriginal()),
  existsSync: () => state.binaryExists,
}))
vi.mock(
  import('local-build-infra/lib/checkpoint-manager'),
  async importOriginal => ({
    ...(await importOriginal()),
    createCheckpoint: vi.fn(),
    shouldRun: state.shouldRun,
  }),
)
vi.mock(
  import('local-build-infra/lib/script-runner'),
  async importOriginal => ({
    ...(await importOriginal()),
    runCommand: state.runCommand,
  }),
)

beforeEach(() => {
  vi.clearAllMocks()
  state.runCommand.mockRejectedValue(state.failure)
  state.shouldRun.mockImplementation(() =>
    Promise.resolve(!state.checkpointExists),
  )
})

for (const checkpointExists of [false, true]) {
  for (const binaryExists of [false, true]) {
    for (const validateCheckpointWithBinary of [false, true]) {
      test(`checkpoint=${checkpointExists}, binary=${binaryExists}, validate=${validateCheckpointWithBinary}`, async () => {
        state.binaryExists = binaryExists
        state.checkpointExists = checkpointExists
        const result = buildBinSuitePackage({
          packageName: 'example-tool',
          packageDir: '/example/package',
          validateCheckpointWithBinary,
        })
        if (
          checkpointExists &&
          (!validateCheckpointWithBinary || binaryExists)
        ) {
          await expect(result).resolves.toBeUndefined()
          expect(state.runCommand).not.toHaveBeenCalled()
        } else {
          await expect(result).rejects.toBe(state.failure)
          expect(state.runCommand).toHaveBeenCalledOnce()
        }
      })
    }
  }
}

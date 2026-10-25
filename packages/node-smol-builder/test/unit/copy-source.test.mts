import { afterEach, expect, test, vi } from 'vitest'
import {
  hasNodeSourceVersionMismatch,
  verifyNodeSourceCommit,
} from '../../scripts/source-copied/shared/copy-source.mts'

const io = vi.hoisted(() => ({ checkpoint: vi.fn(), spawn: vi.fn() }))
vi.mock(
  import('local-build-infra/lib/checkpoint-manager'),
  async importOriginal => ({
    ...(await importOriginal()),
    getCheckpointData: io.checkpoint,
  }),
)
vi.mock(
  import('@socketsecurity/lib-stable/process/spawn/child'),
  async importOriginal => ({
    ...(await importOriginal()),
    spawn: io.spawn,
  }),
)

afterEach(() => vi.clearAllMocks())

for (const [checkpoint, mismatch] of [
  [undefined, false],
  [{ nodeVersion: '26.0.0', nodeSha: 'example-sha' }, false],
  [{ nodeVersion: '25.0.0', nodeSha: 'example-sha' }, true],
  [{ nodeVersion: '26.0.0', nodeSha: 'different-sha' }, true],
  [{ nodeVersion: '26.0.0' }, true],
] as const) {
  test(`checks cached Node identity ${JSON.stringify(checkpoint)}`, async () => {
    io.checkpoint.mockResolvedValue(checkpoint)
    await expect(
      hasNodeSourceVersionMismatch({
        sharedBuildDir: '/example/cache',
        packageName: 'example-tool',
        nodeVersion: '26.0.0',
        nodeSha: 'example-sha',
      }),
    ).resolves.toBe(mismatch)
  })
}

test('does not invoke Git without a requested source SHA', async () => {
  await verifyNodeSourceCommit('/example/source')
  expect(io.spawn).not.toHaveBeenCalled()
})

test('accepts the exact source SHA and trims command output', async () => {
  io.spawn.mockResolvedValue({ code: 0, stdout: 'example-sha\n' })
  await expect(
    verifyNodeSourceCommit('/example/source', 'example-sha'),
  ).resolves.toBeUndefined()
  expect(io.spawn).toHaveBeenCalledWith(
    'git',
    ['-C', '/example/source', 'rev-parse', 'HEAD'],
    { stdio: 'pipe' },
  )
})

for (const result of [{ code: 0, stdout: 'different-sha' }]) {
  test(`rejects unverifiable source ${JSON.stringify(result)}`, async () => {
    io.spawn.mockResolvedValue(result)
    await expect(
      verifyNodeSourceCommit('/example/source', 'example-sha'),
    ).rejects.toThrow()
  })
}

test('propagates a failed source identity probe', async () => {
  const failure = Object.assign(new Error('fixture Git failure'), { code: 1 })
  io.spawn.mockRejectedValue(failure)
  await expect(
    verifyNodeSourceCommit('/example/source', 'example-sha'),
  ).rejects.toBe(failure)
})

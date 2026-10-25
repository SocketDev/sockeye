import { beforeEach, expect, test, vi } from 'vitest'
import { ensureLibdeflate } from '../lib/libdeflate-init.mts'
import { ensureZstd } from '../lib/zstd-init.mts'
const io = vi.hoisted(() => ({ ensure: vi.fn() }))
vi.mock(import('../lib/submodule-init.mts'), () => ({
  ensureSubmodule: io.ensure,
}))
beforeEach(() => vi.resetAllMocks())
test('compression upstream wrappers resolve the repository from the calling package', async () => {
  await ensureLibdeflate({ packageDir: '/example/repo/packages/binject' })
  await ensureZstd({ packageDir: '/example/repo/packages/binpress' })
  expect(io.ensure.mock.calls).toEqual([
    [
      {
        monorepoRoot: '/example/repo',
        name: 'libdeflate',
        sentinelFile: 'libdeflate.h',
        submodulePath: 'packages/binject/upstream/libdeflate',
      },
    ],
    [
      {
        monorepoRoot: '/example/repo',
        name: 'zstd',
        sentinelFile: 'lib/zstd.h',
        submodulePath: 'packages/bin-infra/upstream/zstd',
      },
    ],
  ])
})
test.each([ensureLibdeflate, ensureZstd])(
  'upstream materialization errors remain failures',
  async ensure => {
    const failure = new Error('example upstream unavailable')
    io.ensure.mockRejectedValue(failure)
    await expect(
      ensure({ packageDir: '/example/repo/packages/binject' }),
    ).rejects.toBe(failure)
  },
)

import { beforeEach, expect, test, vi } from 'vitest'
import { checkManualBuildTool } from '../lib/check-tools.mts'
import { cleanupPlatformDisk } from '../lib/host-env-checks.mts'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  which: vi.fn(),
  spawn: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
}))
vi.mock(
  import('@socketsecurity/lib-stable/exe/path/which'),
  async original => ({ ...(await original()), whichSync: io.which }),
)
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({ ...(await original()), isWin32: () => false }),
)
beforeEach(() => {
  vi.resetAllMocks()
  io.exists.mockReturnValue(false)
  // oxlint-disable-next-line socket/prefer-undefined-over-null -- whichSync returns null when no executable is found.
  io.which.mockReturnValue(null)
})

test('missing library candidates and absent pkg-config remain unavailable', async () => {
  expect(
    await checkManualBuildTool({
      name: 'example library',
      cmd: 'pkg-config',
      isLibrary: true,
      filePaths: ['/example/missing.a'],
      args: ['--exists', 'example-library'],
    }),
  ).toBe(false)
  expect(io.exists).toHaveBeenCalledWith('/example/missing.a')
  expect(io.spawn).not.toHaveBeenCalled()
})

test('unsupported cleanup platforms do not execute destructive commands', async () => {
  await cleanupPlatformDisk('freebsd')
  expect(io.spawn).not.toHaveBeenCalled()
})

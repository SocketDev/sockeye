import process from 'node:process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const io = vi.hoisted(() => ({ read: vi.fn(), win: vi.fn() }))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  readFileSync: io.read,
}))
vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({ ...(await original()), isWin32: io.win }),
)
vi.mock(import('../lib/build-env.mts'), () => ({
  getPlatform: () => 'freebsd',
}))
vi.mock(import('../lib/pinned-versions.mts'), () => ({
  getToolConfig: vi.fn(),
  getToolVersion: vi.fn(),
}))
vi.mock(import('../lib/tool-installer-config.mts'), () => ({
  KEG_ONLY_FORMULAS: new Set(),
  PACKAGE_MANAGER_CONFIGS: {},
}))
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
const archDescriptor = Object.getOwnPropertyDescriptor(process, 'arch')!
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  io.win.mockReturnValue(false)
})
afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor)
  Object.defineProperty(process, 'arch', archDescriptor)
})
test('unmapped supported runtime names are used verbatim for artifact selection', async () => {
  Object.defineProperty(process, 'platform', {
    ...platformDescriptor,
    value: 'freebsd',
  })
  Object.defineProperty(process, 'arch', {
    ...archDescriptor,
    value: 'riscv64',
  })
  io.read.mockReturnValue(
    JSON.stringify({
      artifacts: {
        'riscv64-freebsd': {
          url: 'https://example.invalid/tool.tar.xz',
          sha256: 'example-digest',
          extractDir: 'example-tool',
        },
      },
    }),
  )
  const { resolvePinnedArtifact } =
    await import('../lib/tool-installer-impl.mts')
  expect(resolvePinnedArtifact('example-tool', '1.0.0')).toEqual({
    url: 'https://example.invalid/tool.tar.xz',
    sha256: 'example-digest',
    extractDir: 'example-tool',
    binary: 'example-tool',
    archiveFormat: 'tar.xz',
  })
})
test('Windows artifact selects executable suffix and ZIP extraction format', async () => {
  Object.defineProperty(process, 'platform', {
    ...platformDescriptor,
    value: 'win32',
  })
  Object.defineProperty(process, 'arch', { ...archDescriptor, value: 'x64' })
  io.win.mockReturnValue(true)
  io.read.mockReturnValue(
    JSON.stringify({
      artifacts: {
        'x86_64-windows': {
          url: 'https://example.invalid/tool.zip',
          sha256: 'example-digest',
        },
      },
    }),
  )
  const { resolvePinnedArtifact } =
    await import('../lib/tool-installer-impl.mts')
  expect(resolvePinnedArtifact('example-tool', '1.0.0')).toMatchObject({
    binary: 'example-tool.exe',
    archiveFormat: 'zip',
  })
})

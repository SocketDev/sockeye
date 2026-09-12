import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import process from 'node:process'
import path from 'node:path'
import {
  getCheckpointChain,
  getCurrentStubPlatformArch,
  getMakefileName,
  getStubBinaryName,
  getStubOutDir,
  getStubPath,
  stubExists,
  stubExistsAt,
} from '../lib/build-stubs-properties.mts'
const state = vi.hoisted(() => ({
  windows: false,
  exists: vi.fn(),
  libc: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: state.exists,
}))
vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({
    ...(await original()),
    get WIN32() {
      return state.windows
    },
  }),
)
vi.mock(
  import('@socketsecurity/lib-stable/releases/socket-btm'),
  async original => ({ ...(await original()), detectLibc: state.libc }),
)
const originalPlatform = process.platform
const originalArch = process.arch
beforeEach(() => {
  vi.resetAllMocks()
  state.windows = false
  vi.stubEnv('TARGET_ARCH', undefined)
  vi.stubEnv('BUILD_MODE', 'prod')
})
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform })
  Object.defineProperty(process, 'arch', { value: originalArch })
  vi.unstubAllEnvs()
})

test.each([
  { platform: 'darwin', makefile: 'Makefile.macos' },
  { platform: 'win32', makefile: 'Makefile.win' },
  { platform: 'linux', makefile: 'Makefile.linux' },
])('selects the platform makefile for $platform', ({ platform, makefile }) => {
  Object.defineProperty(process, 'platform', { value: platform })
  expect(getMakefileName()).toBe(makefile)
})

test('stub target selection honors cross compilation and detected libc', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  Object.defineProperty(process, 'arch', { value: 'x64' })
  state.libc.mockReturnValue('glibc')
  expect(await getCurrentStubPlatformArch()).toBe('linux-x64')
  vi.stubEnv('TARGET_ARCH', 'arm64')
  state.libc.mockReturnValue('musl')
  expect(await getCurrentStubPlatformArch()).toBe('linux-arm64-musl')
})

test.each([false, true])(
  'stub paths and existence probes agree with Windows=%s',
  windows => {
    state.windows = windows
    const name = windows ? 'smol_stub.exe' : 'smol_stub'
    expect(getStubBinaryName()).toBe(name)
    expect(getStubPath('linux-x64')).toBe(
      path.join(getStubOutDir('linux-x64'), name),
    )
    expect(getStubOutDir('linux-x64')).toContain(
      '/build/prod/linux-x64/out/Final',
    )
    state.exists.mockReturnValue(true)
    expect(stubExists('linux-x64')).toBe(true)
    expect(state.exists).toHaveBeenLastCalledWith(getStubPath('linux-x64'))
    state.exists.mockReturnValue(false)
    expect(stubExistsAt('/example/output')).toBe(false)
    expect(state.exists).toHaveBeenLastCalledWith(
      path.join('/example/output', name),
    )
  },
)

test('stub checkpoint chain requires only the final artifact', () => {
  expect(getCheckpointChain()).toEqual(['finalized'])
})

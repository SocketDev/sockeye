import process from 'node:process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  checkTools,
  reportMissingBuildTools,
  runCheckTools,
} from '../lib/check-tools.mts'
const io = vi.hoisted(() => ({
  installed: vi.fn(),
  which: vi.fn(),
  ci: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  fail: vi.fn(),
}))
vi.mock(import('../lib/tool-installer.mts'), () => ({
  ensureAllToolsInstalled: io.installed,
}))
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  whichSync: io.which,
}))
vi.mock(import('@socketsecurity/lib-stable/env/ci'), () => ({ isCI: io.ci }))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    info: io.info,
    success: io.success,
    fail: io.fail,
    error: vi.fn(),
    warn: vi.fn(),
  }),
}))
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const originalArgv = process.argv
const originalExitCode = process.exitCode
const config = {
  autoInstallableTools: ['cmake', 'ninja'],
  manualTools: [{ cmd: 'example-compiler', name: 'Example compiler' }],
  packageName: 'example-builder',
}
beforeEach(() => {
  vi.clearAllMocks()
  io.installed.mockResolvedValue({
    allAvailable: true,
    installed: ['cmake'],
    missing: [],
  })
  io.which.mockReturnValue('/example/compiler')
  io.ci.mockReturnValue(false)
  process.argv = ['node', '/example/check.mts']
  vi.stubEnv('CONTINUOUS_INTEGRATION', undefined)
})
afterEach(() => {
  process.argv = originalArgv
  process.exitCode = originalExitCode
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.unstubAllEnvs()
})
test('distinguishes auto-installed, existing and missing manual tools', async () => {
  expect(await checkTools(config)).toBe(true)
  expect(io.success).toHaveBeenCalledWith('cmake installed automatically')
  expect(io.success).toHaveBeenCalledWith('ninja is available')
  io.which.mockReturnValue(undefined)
  expect(await checkTools(config)).toBe(false)
})
test.each(['argv', 'ci', 'continuous'])(
  'CLI accepts %s unattended consent',
  async source => {
    process.argv.push('--no-auto-install')
    if (source === 'argv') {
      process.argv.push('--yes')
    }
    if (source === 'ci') {
      io.ci.mockReturnValue(true)
    }
    if (source === 'continuous') {
      vi.stubEnv('CONTINUOUS_INTEGRATION', '1')
    }
    await runCheckTools(config)
    expect(io.installed).toHaveBeenCalledWith(config.autoInstallableTools, {
      autoInstall: false,
      autoYes: true,
    })
    expect(process.exitCode).toBe(0)
  },
)
test.each([false, true])(
  'CLI reports failure when installer throws=%s',
  async throws => {
    if (throws) {
      io.installed.mockRejectedValue(new Error('Fixture installer unavailable'))
    } else {
      io.installed.mockResolvedValue({
        allAvailable: false,
        installed: [],
        missing: ['cmake'],
      })
    }
    await runCheckTools(config)
    expect(process.exitCode).toBe(1)
    expect(io.fail).toHaveBeenCalled()
  },
)
test.each(['darwin', 'linux', 'win32'])(
  'reports platform-specific manual repair for %s',
  platform => {
    Object.defineProperty(process, 'platform', {
      ...originalPlatform,
      value: platform,
    })
    reportMissingBuildTools(['clang', 'cmake'])
    const transcript = io.info.mock.calls.flat().join('\n')
    expect(transcript.includes('xcode-select --install')).toBe(
      platform === 'darwin',
    )
    expect(transcript.includes('brew install cmake')).toBe(
      platform === 'darwin',
    )
    expect(transcript.includes('apt-get install')).toBe(platform === 'linux')
  },
)

import { beforeEach, expect, test, vi } from 'vitest'
import { getArch, getOs } from '@socketsecurity/lib-stable/constants/platform'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  checkDockerSetup,
  getBuilderImageTag,
  getBuildStrategy,
  getComposeServiceName,
  getHostInfo,
  hasBuilderImage,
  isBuildxAvailable,
  isDockerAvailable,
  isDockerRunning,
  LINUX_TARGETS,
  verifyBuilderImage,
} from '../lib/local-build-setup.mts'

vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({
    ...(await original()),
    getArch: vi.fn(),
    getOs: vi.fn(),
  }),
)
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getOs).mockReturnValue('linux')
  vi.mocked(getArch).mockReturnValue('x64')
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: '',
    stderr: '',
    pid: 0,
  })
})
test.each(['linux', 'darwin', 'win32', 'freebsd'] as const)(
  'reports host target for %s',
  platform => {
    vi.mocked(getOs).mockReturnValue(platform)
    expect(getHostInfo()).toEqual({
      platform,
      arch: 'x64',
      target:
        platform === 'linux'
          ? 'linux-x64-glibc'
          : platform === 'freebsd'
            ? undefined
            : `${platform}-x64`,
    })
  },
)
test.each([
  ['linux', 'x64', 'linux-x64-musl', 'native'],
  ['linux', 'x64', 'linux-arm64-glibc', 'docker'],
  ['darwin', 'arm64', 'darwin-arm64', 'native'],
  ['darwin', 'arm64', 'darwin-x64', 'download'],
  ['win32', 'x64', 'win32-arm64', 'native'],
  ['win32', 'arm64', 'win32-x64', 'download'],
  ['linux', 'x64', '', 'download'],
] as const)('selects %s/%s build of %s', (platform, arch, target, expected) => {
  vi.mocked(getOs).mockReturnValue(platform)
  vi.mocked(getArch).mockReturnValue(arch)
  expect(getBuildStrategy(target)).toBe(expected)
})
test.each([isDockerAvailable, isDockerRunning, isBuildxAvailable])(
  'probes Docker commands without installing',
  async probe => {
    expect(await probe()).toBe(true)
    expect(vi.mocked(spawn).mock.calls[0]?.[0]).toBe('docker')
    vi.mocked(spawn).mockRejectedValue(new Error('fixture unavailable'))
    expect(await probe()).toBe(false)
  },
)
test.each([0, 1, 2, 3])(
  'stops Docker readiness at failed probe %s',
  async failureIndex => {
    vi.mocked(spawn).mockImplementation(async () => {
      if (vi.mocked(spawn).mock.calls.length - 1 === failureIndex) {
        throw new Error('fixture unavailable')
      }
      return { code: 0, stdout: '', stderr: '', pid: 0 }
    })
    const result = await checkDockerSetup()
    expect(result.ok).toBe(failureIndex === 3)
    expect(result.errors).toHaveLength(failureIndex === 3 ? 0 : 1)
    expect(spawn).toHaveBeenCalledTimes(Math.min(failureIndex + 1, 3))
  },
)
test.each([hasBuilderImage, verifyBuilderImage])(
  'validates supported images and refuses unsupported targets',
  async probe => {
    expect(await probe('darwin-arm64')).toBe(false)
    expect(spawn).not.toHaveBeenCalled()
    for (const target of LINUX_TARGETS) {
      expect(getBuilderImageTag(target)).toBeTruthy()
      expect(getComposeServiceName(target)).toBeTruthy()
      expect(await probe(target)).toBe(true)
      expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).toContain(
        getBuilderImageTag(target),
      )
    }
    vi.mocked(spawn).mockRejectedValue(new Error('fixture image unavailable'))
    expect(await probe('linux-x64-glibc')).toBe(false)
  },
)

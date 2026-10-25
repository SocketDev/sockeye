import { beforeEach, expect, test, vi } from 'vitest'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  checkDockerSetup,
  getBuilderImageTag,
  getComposeServiceName,
  hasBuilderImage,
  verifyBuilderImage,
} from '../lib/local-build-setup.mts'
import {
  buildBuilderImage,
  ensureBuildxBuilder,
  setupDockerBuilds,
  setupQemuEmulation,
} from '../lib/local-build-docker-ops.mts'
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: vi.fn(),
}))
vi.mock(
  import('@socketsecurity/lib-stable/constants/platform'),
  async original => ({ ...(await original()), getArch: () => 'x64' }),
)
vi.mock(import('../lib/local-build-setup.mts'), async original => ({
  ...(await original()),
  checkDockerSetup: vi.fn(),
  getBuilderImageTag: vi.fn(),
  getComposeServiceName: vi.fn(),
  hasBuilderImage: vi.fn(),
  verifyBuilderImage: vi.fn(),
}))
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    stdout: '',
    stderr: '',
    pid: 0,
  })
  vi.mocked(checkDockerSetup).mockResolvedValue({ ok: true, errors: [] })
  vi.mocked(getBuilderImageTag).mockReturnValue('example/image:arm64')
  vi.mocked(getComposeServiceName).mockReturnValue('example-builder')
  vi.mocked(hasBuilderImage).mockResolvedValue(false)
  vi.mocked(verifyBuilderImage).mockResolvedValue(true)
})
test('rejects unmapped targets before probing or building', async () => {
  vi.mocked(getComposeServiceName).mockReturnValue(undefined)
  expect(await buildBuilderImage('example-unsupported')).toBe(false)
  expect(hasBuilderImage).not.toHaveBeenCalled()
  expect(spawn).not.toHaveBeenCalled()
})
test('reuses existing image unless force requests an explicit rebuild', async () => {
  vi.mocked(hasBuilderImage).mockResolvedValue(true)
  expect(await buildBuilderImage('linux-arm64-glibc')).toBe(true)
  expect(spawn).not.toHaveBeenCalled()
  expect(await buildBuilderImage('linux-arm64-glibc', { force: true })).toBe(
    true,
  )
  expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual([
    'compose',
    '-f',
    'docker-compose.yml',
    'build',
    'example-builder',
  ])
  expect(hasBuilderImage).toHaveBeenCalledTimes(1)
})
test('reports rejected image builds without claiming success', async () => {
  vi.mocked(spawn).mockRejectedValue(
    Object.assign(new Error('fixture build failed'), { code: 1 }),
  )
  expect(await buildBuilderImage('linux-arm64-glibc')).toBe(false)
})
test('selects an existing buildx builder without creating one', async () => {
  expect(await ensureBuildxBuilder()).toBe(true)
  expect(vi.mocked(spawn).mock.calls.map(call => call[1])).toEqual([
    ['buildx', 'inspect', 'socket-btm-builder'],
    ['buildx', 'use', 'socket-btm-builder'],
  ])
})
test.each([true, false])(
  'creates a missing buildx builder, success=%s',
  async success => {
    vi.mocked(spawn).mockRejectedValueOnce(new Error('fixture missing builder'))
    if (!success) {
      vi.mocked(spawn).mockRejectedValue(new Error('fixture create failure'))
    }
    expect(await ensureBuildxBuilder()).toBe(success)
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).toEqual([
      'buildx',
      'create',
      '--name',
      'socket-btm-builder',
      '--driver',
      'docker-container',
      '--use',
      '--bootstrap',
    ])
  },
)
test('attempts recreation when selecting an existing builder fails', async () => {
  vi.mocked(spawn)
    .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '', pid: 0 })
    .mockRejectedValueOnce(new Error('fixture selection failure'))
  expect(await ensureBuildxBuilder()).toBe(true)
  expect(spawn).toHaveBeenCalledTimes(3)
})
test('runs QEMU setup and handles process rejection', async () => {
  expect(await setupQemuEmulation()).toBe(true)
  expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual([
    'run',
    '--privileged',
    '--rm',
    'tonistiigi/binfmt',
    '--install',
    'all',
  ])
  vi.mocked(spawn).mockRejectedValue(new Error('fixture binfmt unavailable'))
  expect(await setupQemuEmulation()).toBe(false)
})
test('stops setup before builds when Docker readiness or buildx fails', async () => {
  vi.mocked(checkDockerSetup).mockResolvedValue({
    ok: false,
    errors: ['fixture unavailable'],
  })
  expect(await setupDockerBuilds()).toEqual({ ok: false, results: {} })
  expect(spawn).not.toHaveBeenCalled()
  vi.mocked(checkDockerSetup).mockResolvedValue({ ok: true, errors: [] })
  vi.mocked(spawn).mockRejectedValue(new Error('fixture buildx failure'))
  expect(await setupDockerBuilds()).toEqual({ ok: false, results: {} })
  expect(hasBuilderImage).not.toHaveBeenCalled()
})
test.each([true, false])(
  'builds and verifies every requested target, verification=%s',
  async verified => {
    vi.mocked(verifyBuilderImage).mockResolvedValue(verified)
    expect(
      await setupDockerBuilds({
        targets: ['linux-arm64-glibc', 'darwin-arm64'],
      }),
    ).toEqual({
      ok: verified,
      results: { 'linux-arm64-glibc': verified, 'darwin-arm64': false },
    })
    expect(verifyBuilderImage).toHaveBeenCalledExactlyOnceWith(
      'linux-arm64-glibc',
    )
    expect(
      vi
        .mocked(spawn)
        .mock.calls.some(call => call[1]?.includes('--privileged')),
    ).toBe(true)
  },
)
test.each([true, false])(
  'continues after QEMU failure and supports explicit skipping=%s',
  async skipQemu => {
    vi.mocked(spawn).mockImplementation(async (command, args) => {
      if (args?.includes('--privileged')) {
        throw new Error('fixture QEMU failure')
      }
      return { code: 0, stdout: '', stderr: '', pid: 0 }
    })
    expect(
      (await setupDockerBuilds({ targets: ['linux-arm64-glibc'], skipQemu }))
        .ok,
    ).toBe(true)
    expect(
      vi
        .mocked(spawn)
        .mock.calls.some(call => call[1]?.includes('--privileged')),
    ).toBe(!skipQemu)
  },
)
test('skips verification for failed builds and avoids QEMU for native architecture', async () => {
  vi.mocked(spawn).mockImplementation(async (command, args) => {
    if (args?.includes('compose')) {
      throw new Error('fixture compose failure')
    }
    return { code: 0, stdout: '', stderr: '', pid: 0 }
  })
  expect(await setupDockerBuilds({ targets: ['linux-x64-glibc'] })).toEqual({
    ok: false,
    results: { 'linux-x64-glibc': false },
  })
  expect(verifyBuilderImage).not.toHaveBeenCalled()
  expect(
    vi.mocked(spawn).mock.calls.some(call => call[1]?.includes('--privileged')),
  ).toBe(false)
})

import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  detect: vi.fn(),
  overrides: vi.fn(),
  spawn: vi.fn(),
  probe: vi.fn(),
  log: vi.fn(),
  fail: vi.fn(),
  warn: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
  spawnSync: io.probe,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    log: io.log,
    fail: io.fail,
    warn: io.warn,
    substep: vi.fn(),
  }),
}))
vi.mock(import('../../scripts/detect-bundle-features.mts'), () => ({
  detectBundleFeatures: io.detect,
}))
vi.mock(import('../../scripts/lib/bundle-overrides.mts'), () => ({
  readBundleOverrides: io.overrides,
}))
vi.mock(import('local-build-infra/lib/platform-mappings'), () => ({
  getCurrentPlatformArch: async () => 'linux-x64',
}))
const originalArgv = process.argv
const originalExitCode = process.exitCode
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  process.exitCode = 0
  io.exists.mockReturnValue(true)
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
  io.probe.mockReturnValue({ code: 0, stdout: '1', stderr: '' })
  io.detect.mockResolvedValue({
    bundleHash: 'example-bundle-hash',
    configureFlags: [],
    features: {},
    v8Lite: { recommended: false },
  })
  io.overrides.mockResolvedValue({})
})
afterEach(() => {
  process.argv = originalArgv
  process.exitCode = originalExitCode
})
async function runBundleCli(kind: 'compile' | 'gate', args: string[]) {
  const name =
    kind === 'compile' ? 'compile-for-bundle.mts' : 'gate-trimmed-binary.mts'
  process.argv = [
    process.execPath,
    fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url)),
    ...args,
  ]
  if (kind === 'compile') {
    await import('../../scripts/compile-for-bundle.mts')
  } else {
    await import('../../scripts/gate-trimmed-binary.mts')
  }
}

test.each([{ args: [] }, { args: ['--bundle=/example/missing.js'] }])(
  'compile rejects missing bundles before detection: %j',
  async ({ args }) => {
    io.exists.mockReturnValue(false)
    await runBundleCli('compile', args)
    expect(process.exitCode).toBe(1)
    expect(io.detect).not.toHaveBeenCalled()
    expect(io.spawn).not.toHaveBeenCalled()
  },
)

test('compile dry run forwards detection inputs and appends recommended lite mode once', async () => {
  io.detect.mockResolvedValue({
    bundleHash: 'example-bundle-hash',
    configureFlags: ['--without-smol-quic'],
    features: { quic: { drop: true }, sqlite: { drop: false } },
    v8Lite: { recommended: true },
  })
  await runBundleCli('compile', [
    '--',
    '--bundle=/example/bundle.js',
    '--vfs=/example/vfs.tar',
    '--overrides=/example/package.json',
    '--prod',
    '--v8-lite',
    '--dry-run',
  ])
  await vi.waitFor(() =>
    expect(io.log).toHaveBeenCalledWith(
      '--dry-run: detection + plan only, not building.',
    ),
  )
  expect(io.detect).toHaveBeenCalledWith({
    bundlePath: '/example/bundle.js',
    vfsPath: '/example/vfs.tar',
    overrides: {},
  })
  expect(io.overrides).toHaveBeenCalledWith('/example/package.json')
  expect(io.log).toHaveBeenCalledWith(
    'Flags:       --without-smol-quic --v8-lite-mode',
  )
  expect(io.spawn).not.toHaveBeenCalled()
})

test.each([false, true])(
  'compile forwards production decisions to the build process: %s',
  async recommended => {
    io.detect.mockResolvedValue({
      bundleHash: 'example-bundle-hash',
      configureFlags: ['--v8-lite-mode'],
      features: {},
      v8Lite: { recommended },
    })
    await runBundleCli('compile', ['--bundle=/example/bundle.js', '--v8-lite'])
    await vi.waitFor(() => expect(io.spawn).toHaveBeenCalledOnce())
    expect(io.spawn).toHaveBeenCalledWith(
      process.execPath,
      [
        expect.stringContaining('/common/shared/build.mts'),
        '--dev',
        '--without-smol=--v8-lite-mode',
      ],
      { stdio: 'inherit' },
    )
  },
)

test.each([false, true])(
  'compile prints the non-lite plan and default flag set: %s',
  async recommended => {
    io.detect.mockResolvedValue({
      bundleHash: 'example-bundle-hash',
      configureFlags: [],
      features: {},
      v8Lite: { recommended },
    })
    await runBundleCli('compile', ['--bundle=/example/bundle.js', '--dry-run'])
    await vi.waitFor(() =>
      expect(io.log).toHaveBeenCalledWith(
        '--dry-run: detection + plan only, not building.',
      ),
    )
    expect(io.log).toHaveBeenCalledWith('Dropping:    (none)')
    expect(io.log).toHaveBeenCalledWith('Flags:       (none)')
    expect(io.log).toHaveBeenCalledWith(
      `V8-lite:     no${recommended ? ' (recommended; pass --v8-lite to apply)' : ''}`,
    )
  },
)

test('compile propagates a rejected build as a failed invocation', async () => {
  io.spawn.mockRejectedValue(
    Object.assign(new Error('example build failed'), { code: 2 }),
  )
  await runBundleCli('compile', ['--bundle=/example/bundle.js'])
  await vi.waitFor(() => expect(process.exitCode).toBe(1))
  expect(io.fail).toHaveBeenCalledOnce()
})

test.each([
  { args: [] },
  { args: ['--binary=/example/node'] },
  { args: ['--binary=/example/node', '--bundle=/example/missing.js'] },
])('gate rejects incomplete or missing inputs: %j', async ({ args }) => {
  io.exists.mockImplementation(value => value !== '/example/missing.js')
  await runBundleCli('gate', args)
  expect(process.exitCode).toBe(1)
  expect(io.detect).not.toHaveBeenCalled()
})

test('gate verifies retained features and reports the missing app suite', async () => {
  await runBundleCli('gate', [
    '--binary=/example/node',
    '--bundle=/example/bundle.js',
  ])
  await vi.waitFor(() =>
    expect(io.log).toHaveBeenCalledWith(
      'GATE PASSED — trimmed binary verified.',
    ),
  )
  expect(io.probe).toHaveBeenCalled()
  expect(io.warn).toHaveBeenCalledOnce()
  expect(io.spawn).not.toHaveBeenCalled()
})

test('gate rejects a retained feature that cannot load', async () => {
  io.probe.mockReturnValue({ code: 0, stdout: '0', stderr: '' })
  await runBundleCli('gate', [
    '--binary=/example/node',
    '--bundle=/example/bundle.js',
  ])
  await vi.waitFor(() => expect(process.exitCode).toBe(1))
  expect(io.fail).toHaveBeenCalledOnce()
})

test('gate forwards the binary and suite command without swallowing execution failures', async () => {
  io.spawn.mockRejectedValue(
    Object.assign(new Error('example suite failed'), { code: 2 }),
  )
  await runBundleCli('gate', [
    '--',
    '--binary=/example/node',
    '--bundle=/example/bundle.js',
    '--suite=example-test-command',
  ])
  await vi.waitFor(() => expect(process.exitCode).toBe(1))
  expect(io.spawn).toHaveBeenCalledWith('sh', ['-c', 'example-test-command'], {
    stdio: 'inherit',
    env: expect.objectContaining({ SMOL_BINARY: '/example/node' }),
  })
})

test('gate completes a successful app suite after feature probes', async () => {
  await runBundleCli('gate', [
    '--binary=/example/node',
    '--bundle=/example/bundle.js',
    '--suite=example-test-command',
  ])
  await vi.waitFor(() =>
    expect(io.log).toHaveBeenCalledWith(
      'GATE PASSED — trimmed binary verified.',
    ),
  )
  expect(io.spawn).toHaveBeenCalledOnce()
})

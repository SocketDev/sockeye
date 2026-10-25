import path from 'node:path'
import { beforeEach, expect, test, vi } from 'vitest'
import { createPrebuiltApi } from '../lib/ensure-prebuilt.mts'

const io = vi.hoisted(() => ({
  files: new Set<string>(),
  entries: [] as string[],
  download: vi.fn(),
  extract: vi.fn(),
  verify: vi.fn(),
  discard: vi.fn(),
  remove: vi.fn(),
  mkdir: vi.fn(),
  hint: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: (filename: string) => io.files.has(filename),
  readdirSync: vi.fn(() => io.entries),
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: io.remove,
  safeMkdir: io.mkdir,
}))
vi.mock(
  import('@socketsecurity/lib-stable/releases/socket-btm'),
  async original => ({
    ...(await original()),
    downloadSocketBtmRelease: io.download,
  }),
)
vi.mock(import('../lib/prebuilt-archive-validation.mts'), () => ({
  verifyPrebuiltArchive: io.verify,
  discardPrebuiltArchive: io.discard,
}))
vi.mock(import('../lib/tarball-utils.mts'), () => ({
  extractTarball: io.extract,
}))
vi.mock(import('../lib/github-error-utils.mts'), () => ({
  logTransientErrorHelp: io.hint,
}))

const local = '/example/build/local'
function makeApi(
  onExtracted?: ((dir: string, arch: string) => Promise<boolean>) | undefined,
) {
  return createPrebuiltApi({
    name: 'example-tool',
    packageRoot: '/example/package',
    getCurrentPlatformArch: () => 'linux-x64',
    getLocalBuildDir: () => local,
    requiredFiles: ['tool.bin', ['library.so', 'library.dylib']],
    onExtracted,
  })
}
function populate(dir: string) {
  io.files.add(path.join(dir, 'tool.bin'))
  io.files.add(path.join(dir, 'library.so'))
}
function prepareDownload(api: ReturnType<typeof makeApi>) {
  const dir = api.getDownloadedDir('linux-x64')
  const archive = path.join(dir, 'example-tool-linux-x64.tar.gz')
  io.download.mockResolvedValue(archive)
  io.files.add(archive)
  io.entries = [path.basename(archive), '.version', 'stale.bin']
  io.extract.mockImplementation(async () => {
    populate(dir)
  })
  return { dir, archive }
}
beforeEach(() => {
  vi.resetAllMocks()
  io.files.clear()
  io.entries = []
})

test('checks required files including alternatives and prefers a local build', async () => {
  const api = makeApi()
  expect(api.verifyAt(local)).toEqual({
    valid: false,
    missing: ['tool.bin', '{library.so,library.dylib}'],
  })
  populate(local)
  expect(api.exists()).toBe(true)
  expect(await api.ensure()).toBe(local)
  expect(io.download).not.toHaveBeenCalled()
})

test('uses a previously downloaded complete artifact without network', async () => {
  const api = makeApi()
  const dir = api.getDownloadedDir('linux-x64')
  populate(dir)
  expect(await api.ensure()).toBe(dir)
  expect(io.download).not.toHaveBeenCalled()
})

test('force fetch verifies before deleting stale files and validates extracted files', async () => {
  const accepted = vi.fn(async () => true)
  const api = makeApi(accepted)
  populate(local)
  const { dir, archive } = prepareDownload(api)
  expect(await api.ensure({ force: true })).toBe(dir)
  expect(io.verify).toHaveBeenCalledWith(
    expect.objectContaining({
      downloadedArchive: archive,
      tool: 'example-tool',
    }),
  )
  expect(io.remove.mock.calls).toEqual([
    [path.join(dir, 'stale.bin'), { maxRetries: 3, retryDelay: 100 }],
  ])
  expect(io.verify.mock.invocationCallOrder[0]).toBeLessThan(
    io.remove.mock.invocationCallOrder[0]!,
  )
  expect(io.extract).toHaveBeenCalledWith(archive, dir, {
    createDir: false,
    stdio: 'inherit',
    validate: true,
  })
  expect(accepted).toHaveBeenCalledWith(dir, 'linux-x64')
})

test.each([
  'missing-archive',
  'integrity',
  'extraction',
  'missing-output',
  'post-check',
])('rejects %s downloads without accepting partial output', async scenario => {
  const api = makeApi(async () => scenario !== 'post-check')
  const { archive, dir } = prepareDownload(api)
  if (scenario === 'missing-archive') {
    io.files.delete(archive)
  }
  if (scenario === 'integrity') {
    io.verify.mockRejectedValue(new Error('example digest mismatch'))
  }
  if (scenario === 'extraction') {
    io.extract.mockRejectedValue(new Error('example extraction failure'))
  }
  if (scenario === 'missing-output') {
    io.extract.mockResolvedValue(undefined)
  }
  expect(await api.downloadPrebuilt()).toBeUndefined()
  if (scenario === 'extraction' || scenario === 'missing-output') {
    expect(io.discard).toHaveBeenCalledWith({
      downloadedArchive: archive,
      versionFile: path.join(dir, '.version'),
    })
  }
  if (scenario === 'integrity' || scenario === 'missing-archive') {
    expect(io.extract).not.toHaveBeenCalled()
  }
  if (scenario === 'post-check') {
    expect(io.remove).toHaveBeenCalledWith(dir)
  }
})

test('coalesces concurrent ensures and releases the lock after failure for a retry', async () => {
  const api = makeApi()
  prepareDownload(api)
  io.download.mockRejectedValueOnce(new Error('example download failure'))
  io.hint.mockRejectedValueOnce(new Error('example hint unavailable'))
  const results = await Promise.allSettled([api.ensure(), api.ensure()])
  expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
  expect(io.download).toHaveBeenCalledOnce()
  const { dir } = prepareDownload(api)
  expect(await api.ensure()).toBe(dir)
  expect(io.download).toHaveBeenCalledTimes(2)
})

import type { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  acquireLock,
  computeSha256,
  downloadAndCache,
  downloadFile,
  extractArchive,
  formatSize,
  getCacheDir,
  getCachedToolBinary,
  getToolCachePath,
  isProcessAlive,
  verifyCacheIntegrity,
} from '../lib/tool-downloader.mts'

const io = vi.hoisted(() => ({
  download: vi.fn(),
  spawn: vi.fn(),
  remove: vi.fn(),
  windows: false,
}))
vi.mock(import('@socketsecurity/lib-stable/http-request/download'), () => ({
  httpDownload: io.download,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: io.remove,
}))
vi.mock(import('@socketsecurity/lib-stable/constants/platform'), () => ({
  isWin32: () => io.windows,
}))
let actualRemove: typeof safeDelete

const bytes = 'example archive contents'
const digest = crypto.createHash('sha256').update(bytes).digest('hex')
let root: string
beforeEach(async () => {
  actualRemove = (
    await vi.importActual<{ safeDelete: typeof safeDelete }>(
      '@socketsecurity/lib-stable/fs/safe',
    )
  ).safeDelete
  vi.resetAllMocks()
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sockeye-tool-download-'))
  vi.stubEnv('EXTERNAL_TOOLS_CACHE', root)
  io.remove.mockImplementation(actualRemove)
  io.download.mockImplementation(async (url: string, destination: string) => {
    await fs.writeFile(destination, bytes)
  })
  io.spawn.mockImplementation(async (command: string, args: string[]) => {
    const destination = command === 'unzip' ? args.at(-1)! : args[3]!
    const extracted = path.join(destination, 'example-tool')
    await fs.mkdir(extracted, { recursive: true })
    await fs.writeFile(
      path.join(extracted, 'example-bin'),
      'example executable',
    )
    return { code: 0 }
  })
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  await actualRemove(root)
})
function resolver() {
  return {
    url: 'https://example.invalid/tool.tar.xz',
    sha256: digest,
    extractDir: 'example-tool',
    binary: 'example-bin',
    archiveFormat: 'tar.xz',
    size: bytes.length,
  }
}
function cachedTool() {
  return getToolCachePath('example-tool', '1.0.0', 'darwin', 'arm64')
}
async function populateCache() {
  const cache = cachedTool()
  await fs.mkdir(cache, { recursive: true })
  await fs.writeFile(path.join(cache, '.checksum'), digest)
  await fs.writeFile(path.join(cache, 'example-bin'), 'example executable')
  return cache
}

test('downloads, verifies, extracts, and reuses a matching cached tool', async () => {
  const binary = await downloadAndCache(
    'example-tool',
    resolver(),
    '1.0.0',
    'darwin',
    'arm64',
  )
  expect(binary).toBe(path.join(cachedTool(), 'example-bin'))
  expect(await fs.readFile(path.join(cachedTool(), '.checksum'), 'utf8')).toBe(
    digest,
  )
  expect(
    getCachedToolBinary(
      'example-tool',
      '1.0.0',
      'darwin',
      'arm64',
      'example-bin',
      digest,
    ),
  ).toBe(binary)
  expect(
    await downloadAndCache(
      'example-tool',
      resolver(),
      '1.0.0',
      'darwin',
      'arm64',
    ),
  ).toBe(binary)
  expect(io.download).toHaveBeenCalledTimes(1)
  expect((await fs.readdir(root)).filter(name => name.startsWith('.'))).toEqual(
    [],
  )
})

test('rechecks cache after the exclusive lock is acquired', async () => {
  const originalOpen = fs.open.bind(fs)
  vi.spyOn(fs, 'open').mockImplementationOnce(async (file, flags, mode) => {
    const handle = await originalOpen(file, flags, mode)
    await populateCache()
    return handle
  })
  expect(
    await downloadAndCache(
      'example-tool',
      resolver(),
      '1.0.0',
      'darwin',
      'arm64',
    ),
  ).toBe(path.join(cachedTool(), 'example-bin'))
  expect(io.download).not.toHaveBeenCalled()
})

test('replaces a partial cache instead of trusting a stale marker', async () => {
  await populateCache()
  await fs.writeFile(path.join(cachedTool(), '.checksum'), 'incorrect-checksum')
  expect(
    getCachedToolBinary(
      'example-tool',
      '1.0.0',
      'darwin',
      'arm64',
      'example-bin',
      digest,
    ),
  ).toBeUndefined()
  await downloadAndCache('example-tool', resolver(), '1.0.0', 'darwin', 'arm64')
  expect(io.download).toHaveBeenCalledOnce()
  expect(verifyCacheIntegrity(cachedTool(), digest)).toBe(true)
})

test.each([
  'checksum',
  'traversal',
  'absolute',
  'missing-directory',
  'missing-binary',
  'network',
])(
  'rejects %s failures and releases the lock and scratch directory',
  async scenario => {
    const config = resolver()
    if (scenario === 'checksum') {
      config.sha256 = 'wrong-checksum'
    }
    if (scenario === 'traversal') {
      config.extractDir = '../outside'
    }
    if (scenario === 'absolute') {
      config.extractDir = '/outside'
    }
    if (scenario === 'missing-directory') {
      config.extractDir = 'missing-directory'
    }
    if (scenario === 'missing-binary') {
      config.binary = 'missing-binary'
    }
    if (scenario === 'network') {
      io.download.mockRejectedValue(new Error('fixture network failure'))
    }
    await expect(
      downloadAndCache('example-tool', config, '1.0.0', 'darwin', 'arm64'),
    ).rejects.toThrow()
    expect(
      (await fs.readdir(root)).filter(
        name => name.startsWith('.tmp-') || name.startsWith('.lock-'),
      ),
    ).toEqual([])
  },
)

test('hashes bytes and propagates read failures', async () => {
  const file = path.join(root, 'example-data')
  await fs.writeFile(file, bytes)
  expect(await computeSha256(file)).toBe(digest)
  await expect(computeSha256(path.join(root, 'absent'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
  await downloadFile(
    'https://example.invalid/archive',
    path.join(root, 'nested/archive'),
  )
  expect(io.download).toHaveBeenLastCalledWith(
    'https://example.invalid/archive',
    path.join(root, 'nested/archive'),
    { followRedirects: true, retries: 3 },
  )
})

test.each(['zip', 'tar.xz'])(
  'checks extraction process outcomes for %s',
  async format => {
    const destination = path.join(root, 'extract')
    await extractArchive('example-archive', destination, format)
    expect(io.spawn.mock.calls[0]?.[0]).toBe(format === 'zip' ? 'unzip' : 'tar')
    for (const outcome of [{ signal: 'SIGTERM' }, { code: 1 }]) {
      const failure = Object.assign(
        new Error('fixture extraction failure'),
        outcome,
      )
      io.spawn.mockRejectedValue(failure)
      await expect(
        extractArchive('example-archive', destination, format),
      ).rejects.toBe(failure)
    }
  },
)

test('formats sizes and maps known and unknown target architectures', async () => {
  expect([undefined, 0, 7, 2048, 1_572_864].map(formatSize)).toEqual([
    'unknown size',
    'unknown size',
    '7 B',
    '2 KB',
    '1.5 MB',
  ])
  expect(getToolCachePath('example-tool', '1', 'win32', 'x64')).toBe(
    path.join(root, 'example-tool', '1-x86_64-windows'),
  )
  expect(getToolCachePath('example-tool', '1', 'linux', 'arm64')).toBe(
    path.join(root, 'example-tool', '1-aarch64-linux'),
  )
  expect(
    getToolCachePath('example-tool', '1', 'example-os', 'example-arch'),
  ).toBe(path.join(root, 'example-tool', '1-example-arch-example-os'))
  expect(
    getCachedToolBinary('example-tool', '1', 'linux', 'x64', 'absent', digest),
  ).toBeUndefined()
  expect(verifyCacheIntegrity(root, digest)).toBe(false)
  await fs.mkdir(path.join(root, '.checksum'))
  expect(verifyCacheIntegrity(root, digest)).toBe(false)
  vi.stubEnv('EXTERNAL_TOOLS_CACHE', '')
  expect(path.relative(process.cwd(), getCacheDir()).split(path.sep)).toEqual([
    'node_modules',
    '.cache',
    'external-tools',
  ])
})

test('acquires exclusive locks and tolerates release cleanup errors', async () => {
  const lock = path.join(root, 'example.lock')
  const release = await acquireLock(lock)
  expect(await fs.readFile(lock, 'utf8')).toBe(String(process.pid))
  await release()
  expect(existsSync(lock)).toBe(false)
  const releaseAgain = await acquireLock(lock)
  io.remove.mockRejectedValueOnce(new Error('fixture cleanup denied'))
  await expect(releaseAgain()).resolves.toBeUndefined()
})

test.each(['corrupt-pid', '99999999'])(
  'reclaims stale locks containing %s',
  async holder => {
    const lock = path.join(root, 'example.lock')
    await fs.writeFile(lock, holder)
    const release = await acquireLock(lock)
    expect(await fs.readFile(lock, 'utf8')).toBe(String(process.pid))
    await release()
  },
)

test('refuses lock creation errors and expired deadlines', async () => {
  await expect(
    acquireLock(path.join(root, 'example.lock'), 0),
  ).rejects.toThrow()
  vi.spyOn(fs, 'open').mockRejectedValueOnce(
    Object.assign(new Error('fixture access denied'), { code: 'EACCES' }),
  )
  await expect(
    acquireLock(path.join(root, 'example.lock')),
  ).rejects.toMatchObject({ code: 'EACCES' })
  expect(isProcessAlive(process.pid)).toBe(true)
  vi.spyOn(process, 'kill').mockImplementationOnce(() => {
    throw new Error('fixture missing process')
  })
  expect(isProcessAlive(99_999_999)).toBe(false)
})

test.each(['live-owner', 'unreadable-owner'])(
  'waits for %s locks before timing out',
  async scenario => {
    const lock = path.join(root, 'example.lock')
    if (scenario === 'live-owner') {
      await fs.writeFile(lock, String(process.pid))
    } else {
      await fs.mkdir(lock)
    }
    vi.useFakeTimers()
    const pending = expect(acquireLock(lock, 500)).rejects.toThrow()
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0))
    await vi.advanceTimersByTimeAsync(1000)
    await pending
  },
)

test('retries failed stale-lock deletion without losing exclusivity', async () => {
  const lock = path.join(root, 'example.lock')
  await fs.writeFile(lock, 'corrupt-pid')
  io.remove.mockRejectedValueOnce(
    new Error('fixture transient cleanup failure'),
  )
  const release = await acquireLock(lock)
  expect(await fs.readFile(lock, 'utf8')).toBe(String(process.pid))
  await release()
})

test('escapes Windows archive paths and uses PowerShell extraction', async () => {
  io.windows = true
  vi.resetModules()
  const windowsDownloader = await import('../lib/tool-downloader.mts')
  io.spawn.mockResolvedValue({ code: 0 })
  try {
    await windowsDownloader.extractArchive(
      "example'archive.zip",
      path.join(root, "example'destination"),
      'zip',
    )
    expect(io.spawn.mock.calls[0]?.[0]).toBe('powershell')
    expect(io.spawn.mock.calls[0]?.[1][1]).toContain("example''archive.zip")
    expect(io.spawn.mock.calls[0]?.[1][1]).toContain("example''destination")
    expect(io.spawn.mock.calls[0]?.[2].shell).toBe(true)
  } finally {
    io.windows = false
    vi.resetModules()
  }
})

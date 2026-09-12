import type { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  computeFileSha256,
  createVfsToolsTarball,
  downloadAllVfsTools,
  downloadFile,
  downloadVfsTool,
  extractArchive,
  verifyFileSha256,
} from '../lib/vfs-tools-downloader.mts'

type ToolKey = 'example-tool' | 'unavailable-tool'
type Asset = string | { url: string; sha256: string }
type CatalogEntry = { version: string } & Partial<
  Record<`${NodeJS.Platform}-${string}`, Asset>
>
const io = vi.hoisted(() => ({
  download: vi.fn(),
  spawn: vi.fn(),
  remove: vi.fn(),
  available: vi.fn(),
  catalog: {} as Partial<Record<ToolKey, CatalogEntry>>,
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
vi.mock(import('../lib/vfs-tool-catalog.mts'), () => ({
  VFS_TOOL_URLS: io.catalog,
  getAvailableTools: io.available,
  getPlatformKey: (platform: string, arch: string) => `${platform}-${arch}`,
}))
let actualRemove: typeof safeDelete

const bytes = 'example VFS archive'
const digest = crypto.createHash('sha256').update(bytes).digest('hex')
let root: string
beforeEach(async () => {
  actualRemove = (
    await vi.importActual<{ safeDelete: typeof safeDelete }>(
      '@socketsecurity/lib-stable/fs/safe',
    )
  ).safeDelete
  vi.resetAllMocks()
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sockeye-vfs-download-'))
  delete io.catalog['example-tool']
  delete io.catalog['unavailable-tool']
  io.catalog['example-tool'] = {
    version: '1.0.0',
    'linux-x64': { url: 'https://example.invalid/tool.tar.gz', sha256: digest },
  }
  io.available.mockReturnValue(['example-tool'])
  io.remove.mockImplementation(actualRemove)
  io.download.mockImplementation(async (url: string, destination: string) => {
    await fs.writeFile(destination, bytes)
  })
  io.spawn.mockImplementation(async (command: string, args: string[]) => {
    if (args[0] === '-czf') {
      await fs.writeFile(args[1]!, bytes)
    } else {
      await fs.writeFile(
        path.join(args[3]!, 'example-bin'),
        'example executable',
      )
    }
    return { code: 0 }
  })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await actualRemove(root)
})
function options() {
  return { destDir: root, platform: 'linux', arch: 'x64' }
}
function toolDir() {
  return path.join(root, 'example-tool', 'linux-x64')
}

test('computes and compares hashes case-insensitively and propagates missing reads', async () => {
  const file = path.join(root, 'example-data')
  await fs.writeFile(file, bytes)
  expect(await computeFileSha256(file)).toBe(digest)
  expect(await verifyFileSha256(file, digest.toUpperCase())).toBe(true)
  expect(await verifyFileSha256(file, 'wrong-digest')).toBe(false)
  await expect(
    computeFileSha256(path.join(root, 'absent')),
  ).rejects.toMatchObject({ code: 'ENOENT' })
})

test('passes default and explicit transport retry budgets without network traffic', async () => {
  await downloadFile(
    'https://example.invalid/tool',
    path.join(root, 'example-default'),
  )
  expect(io.download.mock.calls[0]?.[2]).toMatchObject({
    retries: 2,
    timeout: 300_000,
    retryDelay: 1000,
  })
  await downloadFile(
    'https://example.invalid/tool',
    path.join(root, 'example-custom'),
    { retries: 1, timeout: 200 },
  )
  expect(io.download.mock.calls[1]?.[2]).toMatchObject({
    retries: 0,
    timeout: 200,
  })
})

test('extracts real ZIP fixture bytes and validates mocked tar outcomes', async () => {
  const archive = path.join(root, 'example.zip')
  const zip = new AdmZip()
  zip.addFile('example-bin', Buffer.from('example executable'))
  zip.writeZip(archive)
  const extracted = path.join(root, 'zip-extract')
  await extractArchive(archive, extracted)
  expect(await fs.readFile(path.join(extracted, 'example-bin'), 'utf8')).toBe(
    'example executable',
  )
  for (const extension of ['tar.gz', 'tgz']) {
    await extractArchive(`example.${extension}`, path.join(root, extension))
    expect(io.spawn.mock.calls.at(-1)?.[1][0]).toBe('-xzf')
  }
  const failure = Object.assign(new Error('fixture extraction failure'), {
    code: 1,
  })
  io.spawn.mockRejectedValue(failure)
  await expect(
    extractArchive('example.tar.gz', path.join(root, 'failed')),
  ).rejects.toBe(failure)
  io.spawn.mockResolvedValue({ code: 0 })
  await expect(
    extractArchive('example.tar.gz', path.join(root, 'empty')),
  ).rejects.toThrow()
  await expect(
    extractArchive('example.unknown', path.join(root, 'unknown')),
  ).rejects.toThrow()
})

test('downloads and checksums new tools, reuses versions, and refreshes old or forced versions', async () => {
  expect(await downloadVfsTool('example-tool', options())).toEqual({
    success: true,
    version: '1.0.0',
    toolDir: toolDir(),
  })
  expect(await fs.readFile(path.join(toolDir(), '.version'), 'utf8')).toBe(
    '1.0.0',
  )
  expect(existsSync(path.dirname(io.download.mock.calls[0]?.[1]))).toBe(false)
  await downloadVfsTool('example-tool', options())
  expect(io.download).toHaveBeenCalledTimes(1)
  await fs.writeFile(path.join(toolDir(), '.version'), '0.9.0')
  await downloadVfsTool('example-tool', options())
  await downloadVfsTool('example-tool', { ...options(), force: true })
  expect(io.download).toHaveBeenCalledTimes(3)
})

test('refuses unknown and unavailable tools without downloading', async () => {
  await expect(downloadVfsTool('missing-tool', options())).rejects.toThrow()
  expect(
    await downloadVfsTool('example-tool', {
      ...options(),
      platform: 'unavailable',
    }),
  ).toEqual({ success: false, version: '1.0.0', toolDir: '' })
  expect(io.download).not.toHaveBeenCalled()
})

test.each(['missing-hash', 'wrong-hash', 'network'])(
  'rejects %s and cleans scratch files',
  async scenario => {
    if (scenario === 'missing-hash') {
      io.catalog['example-tool']!['linux-x64'] =
        'https://example.invalid/tool.tar.gz'
    }
    if (scenario === 'wrong-hash') {
      io.catalog['example-tool']!['linux-x64'] = {
        url: 'https://example.invalid/tool.tar.gz',
        sha256: 'wrong-hash',
      }
    }
    if (scenario === 'network') {
      io.download.mockRejectedValue(new Error('fixture transport failure'))
    }
    await expect(downloadVfsTool('example-tool', options())).rejects.toThrow()
    expect(existsSync(path.dirname(io.download.mock.calls[0]?.[1]))).toBe(false)
    expect(existsSync(path.join(toolDir(), '.version'))).toBe(false)
  },
)

test('honors explicit hash-verification opt-out only when requested', async () => {
  io.catalog['example-tool']!['linux-x64'] =
    'https://example.invalid/tool.tar.gz'
  expect(
    (
      await downloadVfsTool('example-tool', {
        ...options(),
        skipHashVerification: true,
      })
    ).success,
  ).toBe(true)
})

test('aggregates successful, unavailable, and failed tool outcomes', async () => {
  io.catalog['unavailable-tool'] = { version: '1.0.0' }
  const result = await downloadAllVfsTools({
    ...options(),
    tools: ['example-tool', 'unavailable-tool', 'missing-tool'],
  })
  expect(result).toEqual({
    success: false,
    downloaded: ['example-tool'],
    failed: ['unavailable-tool', 'missing-tool'],
  })
  expect(await downloadAllVfsTools(options())).toEqual({
    success: true,
    downloaded: ['example-tool'],
    failed: [],
  })
  expect(io.available).toHaveBeenCalledWith('linux', 'x64')
  io.available.mockReturnValue([])
  expect(await downloadAllVfsTools({ destDir: root })).toEqual({
    success: true,
    downloaded: [],
    failed: [],
  })
})

test('creates archives from the requested source and reports byte size', async () => {
  const outputPath = path.join(root, 'archives/example.tar.gz')
  expect(await createVfsToolsTarball({ sourceDir: root, outputPath })).toEqual({
    success: true,
    size: bytes.length,
  })
  expect(io.spawn.mock.calls[0]?.[1]).toEqual([
    '-czf',
    outputPath,
    '-C',
    root,
    '.',
  ])
  await expect(
    createVfsToolsTarball({
      sourceDir: path.join(root, 'missing'),
      outputPath,
      platform: 'linux',
      arch: 'x64',
    }),
  ).rejects.toThrow()
})

test('uses host defaults and tolerates scratch cleanup failure after successful extraction', async () => {
  io.catalog['example-tool']![`${process.platform}-${process.arch}`] = {
    url: 'https://example.invalid/tool.tar.gz',
    sha256: digest,
  }
  const scratch: string[] = []
  io.remove.mockImplementation(async (target: string) => {
    if (path.basename(target).startsWith('vfs-example-tool-')) {
      scratch.push(target)
      throw new Error('fixture cleanup denied')
    }
    await actualRemove(target)
  })
  try {
    expect(
      (await downloadVfsTool('example-tool', { destDir: root })).success,
    ).toBe(true)
  } finally {
    for (let i = 0, { length } = scratch; i < length; i += 1) {
      const directory = scratch[i]!
      await actualRemove(directory)
    }
  }
})

test('rejects archive process failure even when an old output file exists', async () => {
  const outputPath = path.join(root, 'existing.tar.gz')
  await fs.writeFile(outputPath, 'old archive')
  const failure = Object.assign(new Error('fixture tar exit'), { code: 2 })
  io.spawn.mockRejectedValueOnce(failure)
  await expect(
    createVfsToolsTarball({ sourceDir: root, outputPath }),
  ).rejects.toBe(failure)
  expect(await fs.readFile(outputPath, 'utf8')).toBe('old archive')
})

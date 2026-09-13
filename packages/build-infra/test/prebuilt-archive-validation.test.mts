import { beforeEach, expect, test, vi } from 'vitest'
import {
  discardPrebuiltArchive,
  verifyPrebuiltArchive,
} from '../lib/prebuilt-archive-validation.mts'

const archive = vi.hoisted(() => ({
  exists: vi.fn(),
  open: vi.fn(),
  read: vi.fn(),
  close: vi.fn(),
  remove: vi.fn(),
  checksum: vi.fn(),
}))
vi.mock(import('node:fs'), async importOriginal => {
  const original = await importOriginal()
  archive.exists.mockImplementation(original.existsSync)
  return {
    ...original,
    existsSync: archive.exists,
    promises: { ...original.promises, open: archive.open },
  }
})
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), async importOriginal => ({
  ...(await importOriginal()),
  safeDelete: archive.remove,
}))
vi.mock(
  import('../../../scripts/fleet/build/infra/lib/release-checksums/core.mts'),
  async importOriginal => ({
    ...(await importOriginal()),
    verifyReleaseChecksum: archive.checksum,
  }),
)

const config = {
  assetName: 'example-linux-arm64.tar.gz',
  downloadedArchive: '/example/archive.tar.gz',
  tool: 'example-tool',
  versionFile: '/example/.version',
}

beforeEach(() => {
  archive.exists.mockReset().mockReturnValue(true)
  archive.read.mockReset().mockImplementation(async (buffer: Buffer) => {
    buffer[0] = 0x1f
    buffer[1] = 0x8b
    return { __proto__: null, bytesRead: 2, buffer }
  })
  archive.close.mockReset().mockResolvedValue(undefined)
  archive.open
    .mockReset()
    .mockResolvedValue({ read: archive.read, close: archive.close })
  archive.remove.mockReset().mockResolvedValue(undefined)
  archive.checksum
    .mockReset()
    .mockResolvedValue({ valid: true, actual: 'example-checksum' })
})

test('checks the release checksum after closing the archive header', async () => {
  await verifyPrebuiltArchive(config)
  expect(archive.close).toHaveBeenCalledOnce()
  expect(archive.checksum).toHaveBeenCalledWith({
    assetName: config.assetName,
    filePath: config.downloadedArchive,
    tool: config.tool,
  })
  expect(archive.remove).not.toHaveBeenCalled()
})
test('deletes an invalid gzip archive and its version marker before checksum lookup', async () => {
  archive.read.mockResolvedValueOnce({ bytesRead: 0 })
  await expect(verifyPrebuiltArchive(config)).rejects.toThrow()
  expect(archive.remove.mock.calls).toEqual([
    [config.downloadedArchive],
    [config.versionFile],
  ])
  expect(archive.checksum).not.toHaveBeenCalled()
})
test('deletes a checksum mismatch and its version marker', async () => {
  archive.checksum.mockResolvedValueOnce({
    valid: false,
    expected: 'example-expected',
    actual: 'example-actual',
  })
  await expect(verifyPrebuiltArchive(config)).rejects.toThrow()
  expect(archive.remove.mock.calls).toEqual([
    [config.downloadedArchive],
    [config.versionFile],
  ])
})
test('closes the archive when header reading fails', async () => {
  archive.read.mockRejectedValueOnce(new Error('example read failure'))
  await expect(verifyPrebuiltArchive(config)).rejects.toThrow()
  expect(archive.close).toHaveBeenCalledOnce()
  expect(archive.checksum).not.toHaveBeenCalled()
})
test('skips an absent version marker when discarding an archive', async () => {
  archive.exists.mockReturnValue(false)
  await discardPrebuiltArchive(config)
  expect(archive.remove.mock.calls).toEqual([[config.downloadedArchive]])
})

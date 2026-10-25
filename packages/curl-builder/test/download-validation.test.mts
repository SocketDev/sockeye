import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, expect, test } from 'vitest'

import {
  validateCurlArchiveHeader,
  validateCurlChecksum,
} from '../scripts/download-validation.mts'
import { getCurlVersionFile } from '../scripts/paths.mts'

const roots: string[] = []
afterEach(async () => {
  const removed = roots.splice(0)
  for (let i = 0, { length } = removed; i < length; i += 1) {
    await safeDelete(removed[i]!)
  }
})

async function archiveFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sockeye-curl-archive-'))
  roots.push(root)
  return {
    __proto__: null,
    archivePath: path.join(root, 'example.tar.gz'),
    versionFile: getCurlVersionFile(root),
  }
}

test('preserves a gzip archive and its version marker', async () => {
  const files = await archiveFixture()
  await writeFile(files.archivePath, Buffer.from([0x1f, 0x8b, 0x08]))
  await writeFile(files.versionFile, '1.0.0')
  await validateCurlArchiveHeader(files)
  expect(existsSync(files.archivePath)).toBe(true)
  expect(existsSync(files.versionFile)).toBe(true)
})

test.each([
  { bytes: [] },
  { bytes: [0x1f] },
  { bytes: [0x00, 0x8b] },
  { bytes: [0x1f, 0x00] },
])(
  'removes invalid or truncated archive %j and its version marker',
  async ({ bytes }) => {
    const files = await archiveFixture()
    await writeFile(files.archivePath, Buffer.from(bytes))
    await writeFile(files.versionFile, '1.0.0')
    await expect(validateCurlArchiveHeader(files)).rejects.toThrow()
    expect(existsSync(files.archivePath)).toBe(false)
    expect(existsSync(files.versionFile)).toBe(false)
  },
)

test('rejects a missing archive without deleting its version marker', async () => {
  const files = await archiveFixture()
  await writeFile(files.versionFile, '1.0.0')
  await expect(validateCurlArchiveHeader(files)).rejects.toThrow()
  expect(existsSync(files.versionFile)).toBe(true)
})

test('removes an archive rejected by checksum verification without requiring a marker', async () => {
  const files = await archiveFixture()
  await writeFile(files.archivePath, Buffer.from([0x1f, 0x8b]))
  await expect(
    validateCurlChecksum({
      ...files,
      result: {
        valid: false,
        expected: 'expected-digest',
        actual: 'different-digest',
      },
    }),
  ).rejects.toThrow()
  expect(existsSync(files.archivePath)).toBe(false)
})

test.each([{ valid: true }, { valid: true, actual: 'verified-digest' }])(
  'preserves a successful checksum result %j',
  async result => {
    const files = await archiveFixture()
    await writeFile(files.archivePath, Buffer.from([0x1f, 0x8b]))
    await validateCurlChecksum({ ...files, result })
    expect(existsSync(files.archivePath)).toBe(true)
  },
)

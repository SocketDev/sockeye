import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  RELEASE_BUNDLE_DIRECTORY_ENTRIES,
  RELEASE_BUNDLE_ENTRIES,
  releaseBundleDirectoryPath,
  releaseBundlePaths,
} from '../../../scripts/repo/paths.mts'
import { readReleaseArchiveIdentity } from '../../../scripts/repo/release/notary-receipt.mts'

vi.mock('@socketsecurity/lib-stable/process/spawn/child', () => ({
  spawn: vi.fn(),
}))

vi.mock('../../../scripts/repo/release/bundle.mts', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../../../scripts/repo/release/bundle.mts')
  >()),
  readReleaseCertificateSha256: vi.fn(async () => 'B'.repeat(64)),
  readReleaseProfile: vi.fn(async () => ({
    UUID: '87654321-4321-4321-4321-cba987654321',
  })),
}))

let scratch = ''

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-identity-test-'))
  vi.mocked(spawn).mockReset()
})

afterEach(async () => {
  await fs.rm(scratch, { force: true, recursive: true })
})

function archiveMetadata(entries: readonly string[]): string {
  return entries
    .map(entry =>
      RELEASE_BUNDLE_DIRECTORY_ENTRIES.includes(
        entry as (typeof RELEASE_BUNDLE_DIRECTORY_ENTRIES)[number],
      )
        ? 'drwxr-xr-x example'
        : '-rw-r--r-- example',
    )
    .join('\n')
}

function mockArchiveExtraction(entries: readonly string[]): void {
  vi.mocked(spawn).mockImplementation((async (command, args = []) => {
    if (command === '/usr/bin/unzip' && args[0] === '-q') {
      const bundle = releaseBundleDirectoryPath(args.at(-1)!)
      const files = releaseBundlePaths(bundle)
      await fs.mkdir(path.dirname(files.binary), { recursive: true })
      await fs.writeFile(files.binary, 'signed binary')
      await fs.writeFile(files.profile, 'signed profile')
    }
    return {
      args,
      cmd: command,
      code: 0,
      signal: null,
      stderr: '',
      stdout:
        command === '/usr/bin/unzip' && args[0] === '-Z1'
          ? entries.join('\n')
          : command === '/usr/bin/zipinfo'
            ? archiveMetadata(entries)
            : '',
    }
  }) as typeof spawn)
}

test('reads identity only after validating and extracting the exact archive', async () => {
  const archive = path.join(scratch, 'release.zip')
  await fs.writeFile(archive, 'archive')
  mockArchiveExtraction(RELEASE_BUNDLE_ENTRIES)
  await expect(readReleaseArchiveIdentity(archive)).resolves.toEqual({
    binarySha256:
      '19fef6b53215305c7dd44bcbe8a08eccc897ca7742e78fdc4301facb980c114f',
    certificateSha256: 'B'.repeat(64),
    profileSha256:
      '5701d5d8a5f1e3af1dab9a177ebfc7256267eae1e0d29ef5c58213cc67f6a903',
    profileUuid: '87654321-4321-4321-4321-cba987654321',
  })
})

test('accepts the exact retained pre-staple submission layout', async () => {
  const archive = path.join(scratch, 'submission.zip')
  const entries = RELEASE_BUNDLE_ENTRIES.filter(
    entry => entry !== 'sockeye.app/Contents/CodeResources',
  )
  await fs.writeFile(archive, 'archive')
  mockArchiveExtraction(entries)
  await expect(
    readReleaseArchiveIdentity(archive, { stapled: false }),
  ).resolves.toMatchObject({
    profileUuid: '87654321-4321-4321-4321-cba987654321',
  })
})

test('rejects an archive before extraction when it has an extra member', async () => {
  const archive = path.join(scratch, 'unsafe.zip')
  const entries = [...RELEASE_BUNDLE_ENTRIES, 'sockeye.app/Contents/extra']
  await fs.writeFile(archive, 'archive')
  mockArchiveExtraction(entries)
  await expect(readReleaseArchiveIdentity(archive)).rejects.toThrow(
    'expected the exact safe Sockeye bundle layout',
  )
  expect(
    vi
      .mocked(spawn)
      .mock.calls.some(
        call => call[0] === '/usr/bin/unzip' && call[1]?.[0] === '-q',
      ),
  ).toBe(false)
})

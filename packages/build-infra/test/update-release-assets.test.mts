import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import process from 'node:process'
import { getLatestRelease } from '@socketsecurity/lib-stable/releases/github-listing'
import { main } from '../scripts/update-release-assets.mts'

const fixture = vi.hoisted(() => ({
  current: '{}',
  empty: false,
  checksums: { 'example.tar.gz': '0'.repeat(64) },
}))
vi.mock(import('node:fs'), async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn((...args: Parameters<typeof actual.readFileSync>) => {
      if (String(args[0]).endsWith('/release-assets.json')) {
        return fixture.current
      }
      return actual.readFileSync(...args)
    }),
    promises: {
      ...actual.promises,
      readFile: vi.fn(async () =>
        fixture.empty
          ? ''
          : `${fixture.checksums['example.tar.gz']}  example.tar.gz\n`,
      ),
      writeFile: vi.fn(),
    },
  }
})
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: vi.fn(async () => {}),
  safeMkdir: vi.fn(async () => {}),
}))
vi.mock(import('@socketsecurity/lib-stable/releases/github-listing'), () => ({
  getLatestRelease: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/releases/github-downloads'), () => ({
  downloadReleaseAsset: vi.fn(),
}))

const savedArgv = process.argv
const savedExitCode = process.exitCode
beforeEach(() => {
  vi.clearAllMocks()
  fixture.current = '{}'
  fixture.empty = false
  fixture.checksums = { 'example.tar.gz': '0'.repeat(64) }
  process.argv = ['node', 'update-release-assets.mts', '--tool=lief']
  process.exitCode = 0
  vi.mocked(getLatestRelease).mockResolvedValue('lief-v1.2.3')
})
afterEach(() => {
  process.argv = savedArgv
  process.exitCode = savedExitCode
})

function currentRelease(): string {
  return JSON.stringify({
    lief: {
      description: 'Example binaries',
      tag: 'lief-v1.2.3',
      checksums: fixture.checksums,
    },
  })
}

describe('release asset checksum updates', () => {
  test('writes changed releases with canonical metadata and preserved descriptions', async () => {
    fixture.current = JSON.stringify({
      $schema: 'other.schema.json',
      $comment: 'old fixture',
      lief: { description: 'Example binaries' },
    })
    await main()
    const output = JSON.parse(
      String(vi.mocked(fs.writeFile).mock.calls[0]?.[1]),
    )
    expect(output.$schema).toBe('./release-assets.schema.json')
    expect(output.lief).toEqual({
      description: 'Example binaries',
      tag: 'lief-v1.2.3',
      checksums: fixture.checksums,
    })
    expect(process.exitCode).toBe(0)
  })

  test('skips unchanged releases unless forced', async () => {
    fixture.current = currentRelease()
    await main()
    expect(vi.mocked(fs.writeFile).mock.calls).toHaveLength(0)
    process.argv.push('--force')
    await main()
    expect(vi.mocked(fs.writeFile).mock.calls).toHaveLength(1)
  })

  test('does not write changed data in a dry run', async () => {
    process.argv.push('--dry-run')
    await main()
    expect(vi.mocked(fs.writeFile).mock.calls).toHaveLength(0)
  })

  test('skips tools without a published release', async () => {
    vi.mocked(getLatestRelease).mockResolvedValue(undefined)
    await main()
    expect(vi.mocked(fs.writeFile).mock.calls).toHaveLength(0)
    expect(process.exitCode).toBe(0)
  })

  test('fails a release with no checksums without writing', async () => {
    fixture.empty = true
    await main()
    expect(vi.mocked(fs.writeFile).mock.calls).toHaveLength(0)
    expect(process.exitCode).toBe(1)
  })

  test('rejects an unknown tool before querying releases', async () => {
    process.argv = ['node', 'update-release-assets.mts', '--tool=unknown-tool']
    await main()
    expect(vi.mocked(getLatestRelease).mock.calls).toHaveLength(0)
    expect(process.exitCode).toBe(1)
  })
})

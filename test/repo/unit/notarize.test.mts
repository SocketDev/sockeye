import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'
import { beforeEach, expect, test, vi } from 'vitest'

import {
  isStapleable,
  SCRIPT_META,
  submitNotaryArchive,
} from '../../../scripts/repo/notarize.mts'

vi.mock(
  import('@socketsecurity/lib-stable/process/spawn/child'),
  async importOriginal => ({
    ...(await importOriginal()),
    spawn: vi.fn(),
  }),
)

beforeEach(() => vi.resetAllMocks())

test('accepts only an accepted JSON submission and requests its final status', async () => {
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    cmd: '/usr/bin/xcrun',
    args: [],
    signal: null,
    stdout: '{"status":"Accepted"}',
    stderr: '',
  })
  await submitNotaryArchive({
    archive: 'example.zip',
    profile: 'example-notary',
  })
  expect(vi.mocked(spawn).mock.calls[0]?.slice(0, 2)).toEqual([
    '/usr/bin/xcrun',
    [
      'notarytool',
      'submit',
      'example.zip',
      '--keychain-profile',
      'example-notary',
      '--wait',
      '--output-format',
      'json',
    ],
  ])
})

test.each([
  '{"status":"Invalid"}',
  '{"status":"In Progress"}',
  '{}',
  'null',
  '"Accepted"',
  'not JSON',
])('rejects a nonaccepted submission despite exit zero: %s', async stdout => {
  vi.mocked(spawn).mockResolvedValue({
    code: 0,
    cmd: '/usr/bin/xcrun',
    args: [],
    signal: null,
    stdout,
    stderr: '',
  })
  await expect(
    submitNotaryArchive({ archive: 'example.zip', profile: 'example-notary' }),
  ).rejects.toThrow()
})

test('rejects a failed command even with an Accepted response', async () => {
  vi.mocked(spawn).mockResolvedValue({
    code: 1,
    cmd: '/usr/bin/xcrun',
    args: [],
    signal: null,
    stdout: '{"status":"Accepted"}',
    stderr: '',
  })
  await expect(
    submitNotaryArchive({ archive: 'example.zip', profile: 'example-notary' }),
  ).rejects.toThrow()
})

test('describes the entrypoint before processing release targets', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--permission',
      '--allow-fs-read=*',
      fileURLToPath(
        new URL('../../../scripts/repo/notarize.mts', import.meta.url),
      ),
      '--describe',
      '--json',
      '--run',
      'missing-example-archive.zip',
    ],
    { encoding: 'utf8', timeout: 5000 },
  )
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout ?? '')).toMatchObject({
    description: SCRIPT_META.describe,
    name: 'notarize.mts',
  })
  expect(result.stderr).toBe('')
})

test('staples supported archive types and excludes zip tickets', () => {
  expect(isStapleable('example.DMG')).toBe(true)
  expect(isStapleable('example.pkg')).toBe(true)
  expect(isStapleable('example.zip')).toBe(false)
  expect(isStapleable('example-binary')).toBe(false)
})

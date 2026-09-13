import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'
import { beforeEach, expect, test, vi } from 'vitest'

import {
  renderEvidenceTable,
  releaseArchiveEntriesAreValid,
  releaseEntitlementsAreValid,
  verifyReleaseBinary,
  SCRIPT_META,
} from '../../../scripts/repo/verify-release.mts'
import { RELEASE_BUNDLE_ENTRIES } from '../../../scripts/repo/release/bundle.mts'

vi.mock('../../../scripts/repo/release/bundle.mts', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../../../scripts/repo/release/bundle.mts')
  >()),
  readReleaseProfile: vi.fn(async () => ({
    Entitlements: {
      'com.apple.application-identifier': 'PZRCDQ736X.dev.socket.sockeye',
      'com.apple.developer.team-identifier': 'PZRCDQ736X',
    },
    ExpirationDate: '2035-01-01T00:00:00Z',
    ProvisionsAllDevices: true,
  })),
  readReleaseInfoPlist: vi.fn(async () =>
    (
      await importOriginal<
        typeof import('../../../scripts/repo/release/bundle.mts')
      >()
    ).releaseInfoPlist('0.2.0'),
  ),
}))

const validEntitlements =
  '<plist><dict><key>com.apple.application-identifier</key><string>PZRCDQ736X.dev.socket.sockeye</string><key>com.apple.developer.team-identifier</key><string>PZRCDQ736X</string></dict></plist>'

test('describes the entrypoint before processing release targets', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--permission',
      '--allow-fs-read=*',
      fileURLToPath(
        new URL('../../../scripts/repo/verify-release.mts', import.meta.url),
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
    name: 'verify-release.mts',
  })
  expect(result.stderr).toBe('')
})

test('requires the exact release application and team identifiers', () => {
  expect(releaseEntitlementsAreValid(validEntitlements)).toBe(true)
  expect(releaseEntitlementsAreValid('<plist><dict/></plist>')).toBe(false)
})

test('renders release evidence as a padded markdown table', () => {
  expect(
    renderEvidenceTable([{ item: 'SHA-256', evidence: 'example-digest' }]),
  ).toBe(
    '| Item    | Evidence |\n| ------- | -------- |\n| SHA-256 | example-digest |',
  )
})

test('requires the exact release archive layout', () => {
  expect(releaseArchiveEntriesAreValid(RELEASE_BUNDLE_ENTRIES)).toBe(true)
  expect(
    releaseArchiveEntriesAreValid([
      ...RELEASE_BUNDLE_ENTRIES,
      'sockeye.app/Contents/unexpected',
    ]),
  ).toBe(false)
})

vi.mock(
  import('@socketsecurity/lib-stable/process/spawn/child'),
  async importOriginal => ({
    ...(await importOriginal()),
    spawn: vi.fn(),
  }),
)
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(spawn).mockReset()
  vi.mocked(spawn).mockResolvedValue({
    cmd: 'example-tool',
    args: [],
    signal: null,
    code: 0,
    stdout: validEntitlements,
    stderr: '',
  })
})

test('validates standalone CLI notarization without application-only spctl assessment', async () => {
  const rows: import('../../../scripts/repo/verify-release.mts').EvidenceRow[] =
    []
  expect(
    await verifyReleaseBinary('/example/sockeye', 'example-cli', rows),
  ).toBe(true)
  expect(vi.mocked(spawn).mock.calls.map(call => call.slice(0, 2))).toEqual([
    [
      '/usr/bin/codesign',
      ['--verify', '--deep', '--strict', '--verbose=2', '/example/sockeye'],
    ],
    [
      '/usr/bin/codesign',
      ['--display', '--entitlements', ':-', '/example/sockeye'],
    ],
    [
      '/usr/bin/codesign',
      [
        '--verify',
        '--strict',
        '--check-notarization',
        '--verbose=2',
        '/example/sockeye',
      ],
    ],
  ])
  expect(rows.map(row => row.item)).toEqual([
    'Codesign',
    'Entitlements',
    'Notarization',
  ])
})

test('retains Gatekeeper execution assessment for application bundles', async () => {
  expect(
    await verifyReleaseBinary('/example/Sockeye.app', 'example-app', []),
  ).toBe(true)
  expect(vi.mocked(spawn).mock.calls.at(-1)?.slice(0, 2)).toEqual([
    '/usr/sbin/spctl',
    ['--assess', '--type', 'execute', '--verbose', '/example/Sockeye.app'],
  ])
})

test.each([0, 2])(
  'fails verification when check %i fails',
  async failedCheck => {
    for (const check of [0, 1, 2]) {
      vi.mocked(spawn).mockResolvedValueOnce({
        cmd: '/usr/bin/codesign',
        args: [],
        signal: null,
        code: check === failedCheck ? 1 : 0,
        stdout: check === 1 ? validEntitlements : '',
        stderr: '',
      })
    }
    expect(
      await verifyReleaseBinary('/example/sockeye', 'example-cli', []),
    ).toBe(false)
  },
)

test('fails verification when release entitlements are absent', async () => {
  vi.mocked(spawn).mockResolvedValue({
    cmd: 'example-tool',
    args: [],
    signal: null,
    code: 0,
    stdout: '',
    stderr: '',
  })
  expect(await verifyReleaseBinary('/example/sockeye', 'example-cli', [])).toBe(
    false,
  )
})

test('never treats a rejected notarization process as successful', async () => {
  vi.mocked(spawn)
    .mockResolvedValueOnce({
      cmd: '/usr/bin/codesign',
      args: [],
      signal: null,
      code: 0,
      stdout: '',
      stderr: '',
    })
    .mockResolvedValueOnce({
      cmd: '/usr/bin/codesign',
      args: [],
      signal: null,
      code: 0,
      stdout: validEntitlements,
      stderr: '',
    })
    .mockRejectedValueOnce(new Error('fixture rejected notarization'))
  await expect(
    verifyReleaseBinary('/example/sockeye', 'example-cli', []),
  ).rejects.toThrow()
})

test('does not turn failed application assessment into a successful CLI check', async () => {
  vi.mocked(spawn)
    .mockResolvedValueOnce({
      cmd: '/usr/bin/codesign',
      args: [],
      signal: null,
      code: 0,
      stdout: '',
      stderr: '',
    })
    .mockResolvedValueOnce({
      cmd: '/usr/sbin/spctl',
      args: [],
      signal: null,
      code: 0,
      stdout: validEntitlements,
      stderr: '',
    })
    .mockResolvedValueOnce({
      cmd: '/usr/sbin/spctl',
      args: [],
      signal: null,
      code: 3,
      stdout: '',
      stderr: '',
    })
  expect(
    await verifyReleaseBinary('/example/Sockeye.app', 'example-app', []),
  ).toBe(false)
  expect(vi.mocked(spawn).mock.calls).toHaveLength(3)
})

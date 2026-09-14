import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { afterEach, expect, test, vi } from 'vitest'

import {
  RELEASE_BUNDLE_NAME,
  releaseBundleDirectoryPath,
  releaseBundlePaths,
} from '../../../../scripts/repo/paths.mts'
import {
  prepareReleaseBundle,
  RELEASE_APPLICATION_IDENTIFIER,
  RELEASE_TEAM_IDENTIFIER,
  releaseInfoPlist,
  releasePlistBoolean,
  releaseSignatureMetadataIsValid,
  validateReleaseInfoPlist,
  validateReleaseProfile,
} from '../../../../scripts/repo/release/bundle.mts'

vi.mock('@socketsecurity/lib-stable/process/spawn/child', () => ({
  spawn: vi.fn(),
}))

const profile = {
  DeveloperCertificates: ['A'.repeat(64)],
  Entitlements: {
    'com.apple.application-identifier': RELEASE_APPLICATION_IDENTIFIER,
    'com.apple.developer.team-identifier': RELEASE_TEAM_IDENTIFIER,
    'keychain-access-groups': [`${RELEASE_TEAM_IDENTIFIER}.*`],
  },
  ExpirationDate: '2035-01-01T00:00:00Z',
  Platform: ['OSX'],
  ProvisionsAllDevices: true,
}

afterEach(() => vi.resetAllMocks())

test('accepts the exact unexpired Developer ID identity', () => {
  expect(() =>
    validateReleaseProfile(profile, { now: Date.UTC(2030, 0, 1) }),
  ).not.toThrow()
})

test.each(['*', 'PZRCDQ736X*', 'EXAMPLE.*'])(
  'rejects unsafe keychain group %s',
  group => {
    expect(() =>
      validateReleaseProfile(
        {
          ...profile,
          Entitlements: {
            ...profile.Entitlements,
            'keychain-access-groups': [group],
          },
        },
        { now: Date.UTC(2030, 0, 1) },
      ),
    ).toThrow()
  },
)

test('rejects mixed valid and unsafe keychain groups', () => {
  expect(() =>
    validateReleaseProfile(
      {
        ...profile,
        Entitlements: {
          ...profile.Entitlements,
          'keychain-access-groups': [`${RELEASE_TEAM_IDENTIFIER}.*`, '*'],
        },
      },
      { now: Date.UTC(2030, 0, 1) },
    ),
  ).toThrow()
})

test('requires hardened runtime and a secure timestamp', () => {
  expect(
    releaseSignatureMetadataIsValid(
      'CodeDirectory v=20500 flags=0x10000(runtime)\nTimestamp=Sep 13, 2026',
    ),
  ).toBe(true)
  expect(
    releaseSignatureMetadataIsValid(
      'CodeDirectory v=20500 flags=0x0(none)\nTimestamp=Sep 13, 2026',
    ),
  ).toBe(false)
  expect(
    releaseSignatureMetadataIsValid(
      'CodeDirectory v=20500 flags=0x10000(runtime)\nTimestamp=none',
    ),
  ).toBe(false)
})

test('preserves plist boolean types', () => {
  expect(releasePlistBoolean('<plist><true/></plist>')).toBe(true)
  expect(releasePlistBoolean('<plist><string>true</string></plist>')).toBe(
    false,
  )
})

test('rejects a wildcard application identity', () => {
  expect(() =>
    validateReleaseProfile(
      {
        ...profile,
        Entitlements: {
          ...profile.Entitlements,
          'com.apple.application-identifier': 'PZRCDQ736X.dev.socket.*',
        },
      },
      { now: Date.UTC(2030, 0, 1) },
    ),
  ).toThrow()
})

test('matches a rotated signing certificate from the profile', () => {
  expect(() =>
    validateReleaseProfile(profile, {
      certificateSha256: 'A'.repeat(64),
      now: Date.UTC(2030, 0, 1),
    }),
  ).not.toThrow()
  expect(() =>
    validateReleaseProfile(profile, {
      certificateSha256: 'B'.repeat(64),
      now: Date.UTC(2030, 0, 1),
    }),
  ).toThrow()
})

test.each([
  null,
  {},
  { ...profile, ExpirationDate: 'invalid' },
  { ...profile, ExpirationDate: '2020-01-01T00:00:00Z' },
  { ...profile, ProvisionsAllDevices: false },
  {
    ...profile,
    Entitlements: { ...profile.Entitlements, 'get-task-allow': true },
  },
  {
    ...profile,
    Entitlements: {
      ...profile.Entitlements,
      'com.apple.application-identifier': 'EXAMPLE.other.application',
    },
  },
])('rejects invalid, expired, development, and unrelated profiles', value => {
  expect(() =>
    validateReleaseProfile(value, { now: Date.UTC(2030, 0, 1) }),
  ).toThrow()
})

test('renders package version without accepting XML injection', () => {
  const plist = releaseInfoPlist('0.2.0')
  expect(plist).toContain('<string>0.2.0</string>')
  expect(() => validateReleaseInfoPlist(plist)).not.toThrow()
  expect(() =>
    validateReleaseInfoPlist(plist, { expectedVersion: '0.3.0' }),
  ).toThrow()
  expect(() =>
    validateReleaseInfoPlist(plist.replace('dev.socket.sockeye', 'example')),
  ).toThrow()
  expect(() => releaseInfoPlist('0.2.0</string>')).toThrow()
})

test('places the CLI and signed profile together in a complete application', async () => {
  const scratch = await fs.mkdtemp(
    path.join(os.tmpdir(), 'sockeye-bundle-test-'),
  )
  try {
    const binary = path.join(scratch, 'sockeye')
    const provision = path.join(scratch, 'example.provisionprofile')
    await fs.writeFile(binary, 'example binary')
    await fs.writeFile(provision, 'example signed profile')
    const stale = releaseBundleDirectoryPath(scratch)
    await fs.mkdir(stale)
    await fs.writeFile(path.join(stale, 'unwanted.txt'), 'stale artifact')
    const certificate = Buffer.from('fictional certificate')
    vi.mocked(spawn).mockImplementation((async (cmd, args = []) => {
      const key = args[1]
      const rawValues: Record<string, string> = {
        'Entitlements.com\\.apple\\.application-identifier':
          RELEASE_APPLICATION_IDENTIFIER,
        'Entitlements.com\\.apple\\.developer\\.team-identifier':
          RELEASE_TEAM_IDENTIFIER,
        ExpirationDate: profile.ExpirationDate,
        ProvisionsAllDevices: '<plist><true/></plist>',
        UUID: '12345678-1234-1234-1234-123456789abc',
      }
      const xmlValues: Record<string, string> = {
        DeveloperCertificates: `<array><data>${certificate.toString('base64')}</data></array>`,
        'Entitlements.keychain-access-groups':
          '<array><string>PZRCDQ736X.*</string></array>',
        Platform: '<array><string>OSX</string></array>',
      }
      return {
        cmd,
        args,
        code: 0,
        signal: null,
        stdout:
          cmd === '/usr/bin/security'
            ? '<plist/>'
            : (rawValues[key ?? ''] ?? xmlValues[key ?? ''] ?? 'false'),
        stderr: '',
      }
    }) as typeof spawn)
    const bundle = await prepareReleaseBundle(binary, provision, '0.2.0')
    expect(path.basename(bundle)).toBe(RELEASE_BUNDLE_NAME)
    await expect(
      fs.stat(path.join(bundle, 'unwanted.txt')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    const files = releaseBundlePaths(bundle)
    expect(await fs.readFile(files.binary, 'utf8')).toBe('example binary')
    expect(await fs.readFile(files.profile, 'utf8')).toBe(
      'example signed profile',
    )
    expect(await fs.readFile(files.info, 'utf8')).toContain(
      '<string>sockeye</string>',
    )
  } finally {
    await fs.rm(scratch, { recursive: true, force: true })
  }
})

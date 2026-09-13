import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { afterEach, expect, test, vi } from 'vitest'

import {
  prepareReleaseBundle,
  RELEASE_APPLICATION_IDENTIFIER,
  RELEASE_BUNDLE_NAME,
  RELEASE_TEAM_IDENTIFIER,
  releaseBundlePaths,
  releaseInfoPlist,
  validateReleaseInfoPlist,
  validateReleaseProfile,
} from '../../../../scripts/repo/release/bundle.mts'

vi.mock('@socketsecurity/lib-stable/process/spawn/child', () => ({
  spawn: vi.fn(),
}))

const profile = {
  Entitlements: {
    'com.apple.application-identifier': RELEASE_APPLICATION_IDENTIFIER,
    'com.apple.developer.team-identifier': RELEASE_TEAM_IDENTIFIER,
  },
  ExpirationDate: '2035-01-01T00:00:00Z',
  ProvisionsAllDevices: true,
}

afterEach(() => vi.resetAllMocks())

test('accepts the exact unexpired Developer ID identity', () => {
  expect(() =>
    validateReleaseProfile(profile, { now: Date.UTC(2030, 0, 1) }),
  ).not.toThrow()
})

test('accepts the fleet wildcard Developer ID profile identity', () => {
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
  ).not.toThrow()
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
    const stale = path.join(scratch, RELEASE_BUNDLE_NAME)
    await fs.mkdir(stale)
    await fs.writeFile(path.join(stale, 'unwanted.txt'), 'stale artifact')
    vi.mocked(spawn).mockResolvedValueOnce({
      cmd: 'security',
      args: [],
      code: 0,
      signal: null,
      stdout: '<plist/>',
      stderr: '',
    })
    vi.mocked(spawn).mockResolvedValueOnce({
      cmd: 'plutil',
      args: [],
      code: 0,
      signal: null,
      stdout: JSON.stringify(profile.Entitlements),
      stderr: '',
    })
    vi.mocked(spawn).mockResolvedValueOnce({
      cmd: 'plutil',
      args: [],
      code: 0,
      signal: null,
      stdout: profile.ExpirationDate,
      stderr: '',
    })
    vi.mocked(spawn).mockResolvedValueOnce({
      cmd: 'plutil',
      args: [],
      code: 0,
      signal: null,
      stdout: 'true',
      stderr: '',
    })
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

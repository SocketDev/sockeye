import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { expect, test } from 'vitest'

import {
  codesignArgs,
  SIGNING_ENTITLEMENTS,
  SIGNING_IDENTIFIER,
  signingEntitlements,
  SCRIPT_META,
} from '../../../scripts/repo/sign.mts'

test('describes the entrypoint before processing release targets', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--permission',
      '--allow-fs-read=*',
      fileURLToPath(new URL('../../../scripts/repo/sign.mts', import.meta.url)),
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
    name: 'sign.mts',
  })
  expect(result.stderr).toBe('')
})

test('developer signing defaults to the release entitlement file', () => {
  expect(signingEntitlements({ adHoc: false, requested: undefined })).toBe(
    SIGNING_ENTITLEMENTS,
  )
  expect(SIGNING_ENTITLEMENTS).toMatch(/src\/sockeye\/sockeye\.entitlements$/u)
})

test('ad-hoc signing refuses release entitlements', () => {
  expect(signingEntitlements({ adHoc: true, requested: undefined })).toBe(
    undefined,
  )
  expect(() =>
    signingEntitlements({ adHoc: true, requested: 'example.plist' }),
  ).toThrow('Ad-hoc signing cannot claim Sockeye release entitlements')
})

test('ad-hoc signing retains hardened runtime without a timestamp', () => {
  expect(
    codesignArgs({
      identity: '-',
      target: 'example-binary',
      timestamp: false,
      entitlements: undefined,
    }),
  ).toEqual([
    '--force',
    '--options',
    'runtime',
    '--identifier',
    SIGNING_IDENTIFIER,
    '--sign',
    '-',
    'example-binary',
  ])
})

test('developer signing includes timestamp and explicit entitlements', () => {
  expect(
    codesignArgs({
      identity: 'Developer ID Application: Example',
      target: 'example-binary',
      timestamp: true,
      entitlements: 'example.plist',
    }),
  ).toContain('--timestamp')
  expect(
    codesignArgs({
      identity: '-',
      target: 'example-binary',
      timestamp: false,
      entitlements: 'example.plist',
    }),
  ).toContain('example.plist')
})

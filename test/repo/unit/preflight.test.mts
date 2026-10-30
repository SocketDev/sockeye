import { expect, test } from 'vitest'
import { combinePreflightResults } from '../../../scripts/repo/preflight.mts'

test.each([
  [0, 0, 0, 0],
  [1, 0, 0, 1],
  [0, 1, 0, 1],
  [2, 1, 0, 2],
  [0, 0, 1, 1],
  [0, 0, 0, 1],
])(
  'retains every preflight outcome (%i, %i)',
  (fleet, nativeSecurity, keychainEvidence, expected) => {
    expect(
      combinePreflightResults({
        fleetStatus: fleet,
        diagnosticsStatus: 0,
        previewStatus: 0,
        nativeSecurityStatus: nativeSecurity,
        keychainEvidenceStatus: keychainEvidence,
      }),
    ).toBe(expected)
  },
)

test('retains preview isolation failures', () => {
  expect(
    combinePreflightResults({
      fleetStatus: 0,
      nativeSecurityStatus: 0,
      keychainEvidenceStatus: 0,
      diagnosticsStatus: 0,
      previewStatus: 1,
    }),
  ).toBe(1)
})

test('retains diagnostic isolation failures', () => {
  expect(
    combinePreflightResults({
      fleetStatus: 0,
      nativeSecurityStatus: 0,
      keychainEvidenceStatus: 0,
      previewStatus: 0,
      diagnosticsStatus: 1,
    }),
  ).toBe(1)
})

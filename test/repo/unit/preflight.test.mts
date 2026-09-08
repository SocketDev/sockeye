import { expect, test } from 'vitest'
import { combinePreflightResults } from '../../../scripts/repo/preflight.mts'

test.each([
  [0, 0, 0],
  [1, 0, 1],
  [0, 1, 1],
  [2, 1, 2],
])(
  'retains both preflight outcomes (%i, %i)',
  (fleet, requirements, expected) => {
    expect(
      combinePreflightResults({
        fleetStatus: fleet,
        requirementStatus: requirements,
      }),
    ).toBe(expected)
  },
)

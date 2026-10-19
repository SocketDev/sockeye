import { expect, test } from 'vitest'
import {
  CHECKPOINTS,
  validateCheckpointChain,
} from '../lib/checkpoint-phase-constants.mts'

test.each([undefined, JSON.parse('null'), 'finalized', {}, 42])(
  'rejects non-array runtime chains: %j',
  chain => {
    expect(() =>
      Reflect.apply(validateCheckpointChain, undefined, [
        chain,
        'example-builder',
      ]),
    ).toThrow(Error)
  },
)
test.for([
  [],
  ['example-unknown'],
  [CHECKPOINTS.FINALIZED, CHECKPOINTS.FINALIZED],
])('rejects empty, unknown and duplicate checkpoints: %j', chain => {
  expect(() => validateCheckpointChain(chain, 'example-builder')).toThrow(Error)
})
test('valid ordered chains are accepted without mutation', () => {
  const chain = [
    CHECKPOINTS.FINALIZED,
    CHECKPOINTS.BINARY_RELEASED,
    CHECKPOINTS.SOURCE_COPIED,
  ]
  const original = [...chain]
  expect(validateCheckpointChain(chain, 'example-builder')).toBeUndefined()
  expect(chain).toEqual(original)
})

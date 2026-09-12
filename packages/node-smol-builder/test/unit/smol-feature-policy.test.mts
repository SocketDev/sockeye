import { expect, test } from 'vitest'
import {
  autoDroppableFeatures,
  featureBuiltinSpecifier,
  getFeature,
  SMOL_FEATURES,
} from '../../scripts/lib/smol-features.mts'

test('automatic trimming preserves always-on and explicitly retained features', () => {
  const droppable = autoDroppableFeatures()
  expect(droppable.map(value => value.name)).toEqual(
    expect.arrayContaining(['ai', 'quic', 'sqlite', 'webgpu']),
  )
  for (const name of ['power', 'temporal', 'intl']) {
    expect(droppable.map(value => value.name)).not.toContain(name)
  }
  expect(droppable).not.toBe(SMOL_FEATURES)
  expect(SMOL_FEATURES.map(value => value.name)).toEqual(
    expect.arrayContaining(['power', 'temporal', 'intl']),
  )
})
test('builtin lookup distinguishes importable modules from global-only features', () => {
  expect(featureBuiltinSpecifier('quic')).toBe('node:smol-quic')
  expect(featureBuiltinSpecifier('intl')).toBeUndefined()
  expect(featureBuiltinSpecifier('example-unknown-feature')).toBeUndefined()
  expect(getFeature('quic')?.configureFlagWhenDropped).toBe(
    '--without-smol-quic',
  )
})

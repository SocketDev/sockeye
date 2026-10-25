import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { decideFeature } from '../../scripts/detect-bundle-features-decide.mts'
import {
  detectBundleFeatures,
  scanAst,
  scanSource,
} from '../../scripts/detect-bundle-features.mts'
import { toFileUrl } from '../../scripts/compile-for-bundle.mts'
import { SMOL_FEATURES } from '../../scripts/lib/smol-features.mts'
let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'sockeye-member-decisions-'))
})
afterEach(async () => {
  await safeDelete(root)
})
function scan() {
  return {
    __proto__: null,
    stringHits: new Map<string, string>(),
    memberHits: new Map<string, string>(),
    guardedByIsBuiltin: new Set<string>(),
    hasComputedRequire: false,
    compute: {
      __proto__: null,
      typedArrayAllocs: 0,
      wasm: 0,
      bigint: 0,
      cryptoHashing: 0,
      totalBytes: 0,
    },
  }
}
test('AST member scanning retains first evidence and recognizes whole-object features', () => {
  const acc = scan()
  scanAst(
    'navigator.gpu; navigator.gpu; Temporal.Now; Intl.DateTimeFormat; Intl.NumberFormat;',
    acc,
  )
  expect([...acc.memberHits.values()]).toContain('navigator.gpu')
  expect([...acc.memberHits.values()]).toContain('Temporal')
  expect([...acc.memberHits.values()]).toContain('Intl')
  const prior = new Map(acc.memberHits)
  scanAst('navigator.gpu; Temporal.Instant;', acc)
  expect(acc.memberHits).toEqual(prior)
})
test('repeated substring scans preserve the first matched signal', () => {
  const acc = scan()
  scanSource("require('node:sqlite')", acc)
  const prior = new Map(acc.stringHits)
  expect(prior.size).toBeGreaterThan(0)
  scanSource("require('node:sqlite'); require('sqlite')", acc)
  expect(acc.stringHits).toEqual(prior)
})
test('a guarded feature can drop while an unguarded member stays hard', () => {
  const feature = SMOL_FEATURES.find(item =>
    item.memberSignals.some(signal => signal.object === 'navigator'),
  )
  if (!feature) {
    throw new Error('expected navigator feature')
  }
  const acc = scan()
  scanAst('navigator.gpu', acc)
  const sets = { keepSet: new Set<string>(), dropSet: new Set<string>() }
  expect(decideFeature(feature, acc, sets)).toMatchObject({
    use: 'hard',
    drop: false,
  })
  scanSource("isBuiltin('node:smol-webgpu')", acc)
  expect(decideFeature(feature, acc, sets)).toMatchObject({
    use: 'soft',
    drop: true,
  })
})
test('explicit drop overrides computed-require ambiguity without dropping other uncertain features', async () => {
  const file = path.join(root, 'example.js')
  await writeFile(file, 'require(moduleName)')
  const manifest = await detectBundleFeatures({
    bundlePath: file,
    overrides: { drop: ['sqlite'] },
  })
  expect(manifest.features['sqlite']?.drop).toBe(true)
  expect(Object.values(manifest.features).some(feature => !feature.drop)).toBe(
    true,
  )
})
test('an absent entry filename has no file URL', () => {
  expect(toFileUrl(undefined)).toBe('')
  expect(toFileUrl('')).toBe('')
})

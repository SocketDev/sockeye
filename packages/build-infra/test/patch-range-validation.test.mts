import { expect, test } from 'vitest'
import {
  checkPatchConflicts,
  parsePatchFileModifications,
} from '../lib/patch-analysis.mts'
import type { PatchFileData } from '../lib/patch-analysis.mts'

test('ignores sparse entries supplied in a patch list', () => {
  const patches: PatchFileData[] = []
  patches.length = 1
  expect(checkPatchConflicts(patches)).toEqual([])
})

test('retains deletion positions and ignores malformed hunk headers', () => {
  const patch = [
    '@@ -1 +1 @@',
    '--- a/example.js',
    '@@ malformed @@',
    '@@ -10,3 +10,0 @@',
  ].join('\n')
  expect([...parsePatchFileModifications(patch)]).toEqual([
    ['example.js', [{ start: 10, end: 10 }]],
  ])
})

test.each([
  ['start', '9'.repeat(400), '1'],
  ['count', '1', '9'.repeat(400)],
  ['end', String(Number.MAX_SAFE_INTEGER), '2'],
])('rejects an unrepresentable patch %s', (label, start, count) => {
  const patch = `--- a/example.js\n@@ -1,1 +${start},${count} @@\n`
  expect(parsePatchFileModifications(patch).size, label).toBe(0)
})

test('retains a representable range at the integer boundary', () => {
  const start = Number.MAX_SAFE_INTEGER - 1
  const patch = `--- a/example.js\n@@ -1,1 +${start},2 @@\n`
  expect(parsePatchFileModifications(patch).get('example.js')).toEqual([
    { start, end: Number.MAX_SAFE_INTEGER },
  ])
})

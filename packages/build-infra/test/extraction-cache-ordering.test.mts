import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { collectFiles, computeSourceHash } from '../lib/extraction-cache.mts'
let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'sockeye-hash-order-'))
})
afterEach(async () => {
  await safeDelete(root)
})
test('source ordering is stable for shuffled and repeated paths', async () => {
  const first = path.join(root, 'first.bin')
  const last = path.join(root, 'last.bin')
  await writeFile(first, 'first')
  await writeFile(last, 'last')
  expect(computeSourceHash([last, first, first])).toBe(
    computeSourceHash([first, first, last]),
  )
  expect(computeSourceHash([first, last])).not.toBe(
    computeSourceHash([first, first, last]),
  )
})
test('a file passed to directory traversal fails instead of silently losing an input', async () => {
  const file = path.join(root, 'example.txt')
  await writeFile(file, 'example')
  expect(() => collectFiles(file)).toThrow()
})

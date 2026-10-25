import { lstatSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  collectFiles,
  computeSourceHash,
  shouldExtract,
} from '../lib/extraction-cache.mts'

vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    lstatSync: vi.fn(actual.lstatSync),
    readdirSync: vi.fn(actual.readdirSync),
  }
})
let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'extraction-boundaries-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await safeDelete(root)
})

test('directory traversal propagates non-system errors unchanged', () => {
  const failure = new TypeError('example invalid directory input')
  vi.mocked(readdirSync).mockImplementationOnce(() => {
    throw failure
  })
  expect(() => collectFiles(root)).toThrow(failure)
})

test('special directory entries are not read as regular source files', () => {
  writeFileSync(path.join(root, 'example-entry'), '')
  const entries = readdirSync(root, { withFileTypes: true })
  const entry = entries[0]!
  vi.spyOn(entry, 'isFile').mockReturnValue(false)
  vi.spyOn(entry, 'isFIFO').mockReturnValue(true)
  vi.mocked(readdirSync).mockReturnValueOnce(entries)
  expect(collectFiles(root)).toEqual([])
})

test('source metadata permission failures propagate instead of producing missing-file sentinels', () => {
  const failure = Object.assign(new Error('example metadata access denied'), {
    code: 'EACCES',
  })
  vi.mocked(lstatSync).mockImplementationOnce(() => {
    throw failure
  })
  expect(() => computeSourceHash([path.join(root, 'example-source')])).toThrow(
    failure,
  )
})

test('sparse public source arrays skip absent hash inputs but invalidate cached output', async () => {
  const sources: string[] = []
  sources.length = 1
  expect(computeSourceHash(sources)).toBe(computeSourceHash([]))
  const outputPath = path.join(root, 'example-output')
  writeFileSync(outputPath, `Source hash: ${computeSourceHash([])}`)
  expect(await shouldExtract({ sourcePaths: sources, outputPath })).toBe(true)
})

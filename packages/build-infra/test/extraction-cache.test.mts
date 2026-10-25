import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  collectFiles,
  computeSourceHash,
  ensureOutputDir,
  generateHashComment,
  shouldExtract,
} from '../lib/extraction-cache.mts'
import { safeDelete, safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    readdirSync: vi.fn(actual.readdirSync),
  }
})
let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'extraction-cache-'))
})
afterEach(async () => {
  vi.mocked(readFileSync).mockClear()
  vi.mocked(readdirSync).mockClear()
  await safeDelete(root)
})

function fixturePaths() {
  const source = path.join(root, 'source.js')
  const output = path.join(root, 'output.js')
  writeFileSync(source, 'example-source')
  return { source, output }
}

test('collects nested regular files and skips symlink cycles and external links', () => {
  const nested = path.join(root, 'nested')
  mkdirSync(nested)
  const file = path.join(nested, 'example.js')
  writeFileSync(file, 'example')
  symlinkSync(root, path.join(nested, 'cycle'))
  symlinkSync(file, path.join(root, 'alias'))
  expect(collectFiles(root)).toEqual([file])
  expect(computeSourceHash([root])).toBe(computeSourceHash([file]))
  expect(computeSourceHash([path.join(root, 'alias')])).toBe(
    computeSourceHash([]),
  )
})

test.each(['EACCES', 'EPERM', 'ENOENT'])(
  'skips a directory when traversal returns %s',
  code => {
    vi.mocked(readdirSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('example filesystem failure'), { code })
    })
    expect(collectFiles(root)).toEqual([])
  },
)

test('propagates unexpected traversal and file-read failures', () => {
  const { source } = fixturePaths()
  vi.mocked(readdirSync).mockImplementationOnce(() => {
    throw Object.assign(new Error('example IO failure'), { code: 'EIO' })
  })
  expect(() => collectFiles(root)).toThrow()
  vi.mocked(readFileSync).mockImplementationOnce(() => {
    throw Object.assign(new Error('example access failure'), { code: 'EACCES' })
  })
  expect(() => computeSourceHash([source])).toThrow()
})

test('missing sources have deterministic path-specific sentinels and metadata changes invalidate', () => {
  const first = path.join(root, 'first.js')
  const second = path.join(root, 'second.js')
  expect(computeSourceHash([first])).toBe(computeSourceHash([first]))
  expect(computeSourceHash([first])).not.toBe(computeSourceHash([second]))
  expect(
    computeSourceHash([first], { platformMetadata: 'linux-x64' }),
  ).not.toBe(computeSourceHash([first], { platformMetadata: 'darwin-arm64' }))
  writeFileSync(first, '')
  expect(computeSourceHash([first])).not.toBe(computeSourceHash([second]))
})

test('creates output parents and emits equivalent single-source and array comments', () => {
  const { source } = fixturePaths()
  const output = path.join(root, 'generated', 'nested', 'output.js')
  ensureOutputDir(output)
  writeFileSync(output, 'example')
  expect(generateHashComment(source)).toBe(generateHashComment([source]))
  expect(collectFiles(path.dirname(output))).toEqual([output])
})

test('cache hits require existing sources, matching hashes, and valid output', async () => {
  const { source, output } = fixturePaths()
  const config = { sourcePaths: source, outputPath: output }
  expect(await shouldExtract(config)).toBe(true)
  writeFileSync(output, generateHashComment(source))
  expect(await shouldExtract(config)).toBe(false)
  expect(await shouldExtract({ ...config, validateOutput: () => false })).toBe(
    true,
  )
  expect(await shouldExtract({ ...config, validateOutput: () => true })).toBe(
    false,
  )
  writeFileSync(source, 'changed-source')
  expect(await shouldExtract(config)).toBe(true)
  safeDeleteSync(source)
  expect(await shouldExtract(config)).toBe(true)
})

test('malformed cache records, missing captures, and read errors regenerate', async () => {
  const { source, output } = fixturePaths()
  const config = { sourcePaths: [source], outputPath: output }
  writeFileSync(output, 'no cached hash')
  expect(await shouldExtract(config)).toBe(true)
  expect(await shouldExtract({ ...config, hashPattern: /cached/ })).toBe(true)
  vi.mocked(readFileSync).mockImplementationOnce(() => {
    throw new Error('example read failure')
  })
  expect(await shouldExtract(config)).toBe(true)
})

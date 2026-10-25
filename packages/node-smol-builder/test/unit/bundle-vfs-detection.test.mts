import { beforeEach, expect, test, vi } from 'vitest'
import {
  detectBundleFeatures,
  readVfsEntries,
  scanAst,
  tarField,
} from '../../scripts/detect-bundle-features.mts'
const io = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return { ...actual, promises: { ...actual.promises, readFile: io.read } }
})
beforeEach(() => vi.resetAllMocks())
function tarEntry(name: string, text: string) {
  const content = Buffer.from(text)
  const entry = Buffer.alloc(512 + Math.ceil(content.length / 512) * 512)
  entry.write(name, 0)
  entry.write(content.length.toString(8).padStart(11, '0'), 124)
  content.copy(entry, 512)
  return entry
}
function scanAccumulator(): Parameters<typeof scanAst>[1] {
  return {
    __proto__: null,
    stringHits: new Map(),
    memberHits: new Map(),
    guardedByIsBuiltin: new Set(),
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

test('tar fields stop at their own boundary or an earlier NUL', () => {
  expect(tarField(Buffer.from('example'), 0, 4)).toBe('exam')
  expect(tarField(Buffer.from('example\0'), 0, 4)).toBe('exam')
  expect(tarField(Buffer.from('ex\0ample'), 0, 6)).toBe('ex')
})

test('VFS scanning respects padded records, script extensions and archive terminators', async () => {
  const scripts = [
    'require("node:sqlite")',
    'export const example = 42',
    'module.exports = "example"',
  ]
  io.read.mockResolvedValue(
    Buffer.concat([
      tarEntry('example.txt', 'not JavaScript'),
      tarEntry('first.js', scripts[0]!),
      tarEntry('second.mjs', scripts[1]!),
      tarEntry('third.cjs', scripts[2]!),
      Buffer.alloc(512),
      tarEntry('ignored.js', 'ignored()'),
    ]),
  )
  expect(await readVfsEntries('/example/vfs.tar')).toEqual(scripts)
})

test('VFS scanning accepts empty archives and zero-length scripts', async () => {
  io.read.mockResolvedValue(Buffer.alloc(10))
  expect(await readVfsEntries('/example/vfs.tar')).toEqual([])
  const entry = tarEntry('empty.js', '')
  entry.fill(0, 124, 136)
  io.read.mockResolvedValue(entry)
  expect(await readVfsEntries('/example/vfs.tar')).toEqual([''])
})

test('VFS script usage contributes to feature decisions and bundle identity', async () => {
  io.read.mockImplementation(async file =>
    file === '/example/main.js'
      ? 'export const example = 42'
      : Buffer.concat([
          tarEntry('virtual.js', 'require("node:sqlite")'),
          Buffer.alloc(512),
        ]),
  )
  const main = await detectBundleFeatures({ bundlePath: '/example/main.js' })
  const withVfs = await detectBundleFeatures({
    bundlePath: '/example/main.js',
    vfsPath: '/example/vfs.tar',
  })
  expect(withVfs.features['sqlite']?.drop).toBe(false)
  expect(withVfs.bundleHash).not.toBe(main.bundleHash)
})

test('AST analysis falls back to script mode and counts atomics and bigint operations', () => {
  const acc = scanAccumulator()
  scanAst(
    'with (example) { Atomics.load(example, 0); const value = 42n; }',
    acc,
  )
  expect(acc.compute.bigint).toBe(2)
  scanAst('example().property; new example.Factory(); example["property"]', acc)
  expect(acc.compute.typedArrayAllocs).toBe(0)
})

test('malformed JavaScript leaves independent string-scan evidence intact', () => {
  const acc = scanAccumulator()
  acc.stringHits.set('sqlite', 'node:sqlite')
  scanAst('function {', acc)
  expect(acc.stringHits.get('sqlite')).toBe('node:sqlite')
  expect(acc.memberHits.size).toBe(0)
})

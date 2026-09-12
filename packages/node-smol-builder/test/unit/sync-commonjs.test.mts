import { runInNewContext } from 'node:vm'
import { expect, test, vi } from 'vitest'
import {
  convertToCommonJS,
  toInternalPath,
} from '../../scripts/vendor-fast-webstreams/sync-commonjs.mts'

function executeModule(source: string, require = vi.fn()) {
  const exports: Record<string, unknown> = {}
  runInNewContext(convertToCommonJS(source, 'example.js'), { exports, require })
  return exports
}

test('named, default and namespace imports preserve values across internal paths', () => {
  const require = vi.fn((name: string) => {
    if (name === 'internal/deps/fast-webstreams/reader') {
      return { chunk: 7 }
    }
    if (name === 'internal/deps/writer') {
      return { size: 11 }
    }
    if (name === 'buffer') {
      return { byteLength: 13 }
    }
    throw new Error('unexpected dependency')
  })
  const exports = executeModule(
    [
      "import { chunk as importedChunk } from './reader.js';",
      "import writer from '../writer.js';",
      "import * as buffer from 'node:buffer';",
      'export const value = importedChunk + writer.size + buffer.byteLength;',
    ].join('\n'),
    require,
  )
  expect(exports['value']).toBe(31)
  expect(require).toHaveBeenCalledTimes(3)
})

test('function, async function and class exports remain executable', async () => {
  const exports = executeModule(
    [
      'export function readChunk() { return 7 }',
      'export async function readLater() { return 11 }',
      'export class Stream { size() { return 13 } }',
      'export const sample = new Stream().size();',
    ].join('\n'),
  )
  expect(exports['sample']).toBe(13)
  const read = exports['readChunk']
  const later = exports['readLater']
  if (typeof read !== 'function' || typeof later !== 'function') {
    throw new Error('expected callable exports')
  }
  expect(read()).toBe(7)
  await expect(later()).resolves.toBe(11)
})

test('re-export aliases resolve the source identity once', () => {
  const source = { original: 7, unchanged: 11 }
  const require = vi.fn(() => source)
  expect(
    executeModule(
      "export { original as renamed, unchanged } from './reader.js';",
      require,
    ),
  ).toEqual({ renamed: 7, unchanged: 11 })
  expect(require).toHaveBeenCalledOnce()
})

test('local named exports preserve aliases without exposing private binding names', () => {
  const exports = executeModule(
    'const privateValue = 7; const other = 11; export { privateValue as publicValue, other };',
  )
  expect(exports).toEqual({ publicValue: 7, other: 11 })
})

test('existing strict directives and modules without exports retain execution behavior', () => {
  expect(executeModule("'use strict'; exports.example = 7")).toEqual({
    example: 7,
  })
  expect(toInternalPath('example-package')).toBe('example-package')
})

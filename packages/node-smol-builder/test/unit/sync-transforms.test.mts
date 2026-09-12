import { runInNewContext } from 'node:vm'
import { expect, test, vi } from 'vitest'
import {
  fixPatchCircularDependency,
  fixWriterWritableCycle,
  wireNativeChunkPool,
} from '../../scripts/vendor-fast-webstreams/sync.mts'

test('patch imports resolve each stream from its defining module', () => {
  const source =
    "const { FastReadableStream, FastTransformStream, FastWritableStream } = require('internal/deps/fast-webstreams/index');\n[FastReadableStream, FastTransformStream, FastWritableStream]"
  const require = vi.fn((name: string) => {
    if (name.endsWith('/readable')) {
      return { FastReadableStream: 'readable' }
    }
    if (name.endsWith('/transform')) {
      return { FastTransformStream: 'transform' }
    }
    if (name.endsWith('/writable')) {
      return { FastWritableStream: 'writable' }
    }
    throw new Error('circular index import')
  })
  const result: unknown = runInNewContext(
    fixPatchCircularDependency(source, 'patch.js'),
    { require },
  )
  expect(result).toEqual(['readable', 'transform', 'writable'])
  expect(require).toHaveBeenCalledTimes(3)
  expect(fixPatchCircularDependency(source, 'other.js')).toBe(source)
})

test('writer reads writable exports when invoked rather than while loading a cycle', () => {
  const source =
    "const { _abortInternal, _closeFromWriter, _getDesiredSize, _writeInternal } = require('internal/deps/fast-webstreams/writable');\n() => [_abortInternal(), _closeFromWriter(), _getDesiredSize(), _writeInternal()]"
  const writable: Record<string, () => number> = {}
  const result: unknown = runInNewContext(
    fixWriterWritableCycle(source, 'writer.js'),
    { require: () => writable },
  )
  writable['_abortInternal'] = () => 1
  writable['_closeFromWriter'] = () => 2
  writable['_getDesiredSize'] = () => 3
  writable['_writeInternal'] = () => 4
  expect(typeof result).toBe('function')
  if (typeof result !== 'function') {
    throw new Error('expected transformed writer callback')
  }
  expect(result()).toEqual([1, 2, 3, 4])
  expect(fixWriterWritableCycle(source, 'other.js')).toBe(source)
})

test('reader pool is initialized lazily once and preserves completion', async () => {
  const source =
    "'use strict'\nfunction unrelated() {}\nfunction _resolveReadResult(value, done) { return { value, done } }\n_resolveReadResult"
  const chunk = { value: undefined, done: false }
  const acquire = vi.fn(() => chunk)
  const setValue = vi.fn()
  const binding = vi.fn(() => ({
    acquireChunk: acquire,
    setChunkValue: setValue,
  }))
  const done = Promise.resolve({ done: true })
  const result: unknown = runInNewContext(
    wireNativeChunkPool(source, 'reader.js'),
    {
      internalBinding: binding,
      PromiseResolve: Promise.resolve.bind(Promise),
      DONE_PROMISE: done,
    },
  )
  expect(binding).not.toHaveBeenCalled()
  if (typeof result !== 'function') {
    throw new Error('expected transformed reader callback')
  }
  expect(result(undefined, true)).toBe(done)
  expect(binding).not.toHaveBeenCalled()
  await expect(result('first', false)).resolves.toBe(chunk)
  await expect(result('second', false)).resolves.toBe(chunk)
  expect(binding).toHaveBeenCalledOnce()
  expect(binding).toHaveBeenCalledWith('smol_webstreams')
  expect(acquire).toHaveBeenCalledTimes(2)
  expect(setValue.mock.calls).toEqual([
    [chunk, 'first', false],
    [chunk, 'second', false],
  ])
})

test('reader transform leaves unsupported source intact and refuses a missing insertion anchor', () => {
  for (const source of ['invalid {', "'use strict'\nfunction unrelated() {}"]) {
    expect(wireNativeChunkPool(source, 'reader.js')).toBe(source)
  }
  const target = 'function _resolveReadResult(value, done) {}'
  expect(wireNativeChunkPool(target, 'other.js')).toBe(target)
  expect(() => wireNativeChunkPool(target, 'reader.js')).toThrow()
})

test('reader injection accepts a semicolon directive without a following newline', async () => {
  const source =
    "'use strict'; function _resolveReadResult(value, done) { return { value, done } }; _resolveReadResult"
  const chunk = { value: 'example-value', done: false }
  const result: unknown = runInNewContext(
    wireNativeChunkPool(source, 'reader.js'),
    {
      internalBinding: () => ({
        acquireChunk: () => chunk,
        setChunkValue: () => {},
      }),
      PromiseResolve: Promise.resolve.bind(Promise),
    },
  )
  if (typeof result !== 'function') {
    throw new Error('expected transformed reader callback')
  }
  await expect(result('example-value', false)).resolves.toBe(chunk)
})

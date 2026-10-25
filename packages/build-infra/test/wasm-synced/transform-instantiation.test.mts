import { Parser } from 'acorn'
import { describe, expect, test } from 'vitest'

import {
  getWasmImports,
  isAsyncWasmLoader,
} from '../../wasm-synced/transform-instantiation.mts'

function parseLoader(source: string) {
  return Parser.parse(source, { ecmaVersion: 'latest' }).body[0]
}

describe('WebAssembly loader classification', () => {
  test.each([
    [
      'function load(info){return WebAssembly.instantiate(wasmBinary,info)}',
      true,
    ],
    [
      'function load(info){return WebAssembly.instantiateStreaming(fetch(url),info)}',
      true,
    ],
    ['function load(info){return WebAssembly.instantiate(buffer,info)}', false],
    [
      'function load(info){new WebAssembly.Instance(module,info); return WebAssembly.instantiate(wasmBinary,info)}',
      false,
    ],
    ['function load(){return fetch(url)}', false],
  ])('classifies %s', (source, expected) => {
    expect(isAsyncWasmLoader(parseLoader(source))).toBe(expected)
  })
})

describe('WebAssembly imports selection', () => {
  test.each([
    [
      'function load(first,second){WebAssembly.instantiate(wasmBinary,second);WebAssembly.instantiate(wasmBinary,first);WebAssembly.instantiateStreaming(fetch(url),second)}',
      'second',
      '',
    ],
    [
      'function load(info={}){return WebAssembly.instantiate(wasmBinary,info)}',
      'info',
      '',
    ],
    [
      'function load(){const info={env:{}};return WebAssembly.instantiate(wasmBinary,info)}',
      'info',
      'const info={env:{}};',
    ],
    [
      'function load(){const info=createImports();return WebAssembly.instantiate(wasmBinary,info)}',
      'info',
      'const info=createImports();',
    ],
    [
      'function load(){const info=new Imports();return WebAssembly.instantiate(wasmBinary,info)}',
      'info',
      'const info=new Imports();',
    ],
    [
      'function load(fallback){return WebAssembly.instantiate(wasmBinary,unknown)}',
      'fallback',
      '',
    ],
    [
      'function load(){return WebAssembly.instantiate(wasmBinary,unknown)}',
      'info',
      'var info={};',
    ],
  ])('selects imports for %s', (source, importsParam, importsSetup) => {
    expect(getWasmImports(parseLoader(source), source)).toEqual({
      importsParam,
      importsSetup,
    })
  })
})

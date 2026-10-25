import { Parser } from 'acorn'
import { expect, test, vi } from 'vitest'
import {
  getWasmImports,
  isAsyncWasmLoader,
} from '../../wasm-synced/transform-instantiation.mts'
import { applyCommonTransforms } from '../../wasm-synced/transform.mts'

test.each([
  [
    'function loadExample(){const {env}=externalImports; return WebAssembly.instantiate(wasmBinary)}',
    'info',
    'var info={};',
  ],
  [
    'function loadExample(fallback){const ignoredValue=1; return WebAssembly.instantiate(wasmBinary)}',
    'fallback',
    '',
  ],
  [
    'function loadExample(){const imports={env:{}}\nreturn WebAssembly.instantiate(wasmBinary,imports)}',
    'imports',
    'const imports={env:{}};',
  ],
  [
    'function loadExample(){const imports=createImports()\nreturn WebAssembly.instantiate(wasmBinary,imports)}',
    'imports',
    'const imports=createImports();',
  ],
])(
  'selects imports from actual declaration %s',
  (source, importsParam, importsSetup) => {
    const node = Parser.parse(source, { ecmaVersion: 'latest' }).body[0]
    expect(getWasmImports(node, source)).toEqual({ importsParam, importsSetup })
  },
)

test.each([
  'function loadExample(){new ExampleModule(); return WebAssembly.instantiate(wasmBinary)}',
  'function loadExample(){new OtherNamespace.Instance(); return WebAssembly.instantiate(wasmBinary)}',
  'function loadExample(){new WebAssembly.Module(wasmBinary); return WebAssembly.instantiate(wasmBinary)}',
  'function loadExample(){new WebAssembly["Instance"](); return WebAssembly.instantiate(wasmBinary)}',
])(
  'keeps unrelated constructors outside the synchronous instance guard %s',
  source => {
    expect(
      isAsyncWasmLoader(
        Parser.parse(source, { ecmaVersion: 'latest' }).body[0],
      ),
    ).toBe(true)
  },
)

test.each([
  'loadUrl().fileURLToPath(exampleUrl);',
  'urlModule.fileURLToPath(exampleUrl);',
])('preserves non-require URL providers %s', async source => {
  await expect(
    applyCommonTransforms({
      mjsContent: source,
      initFunctionName: 'createExampleModule',
      exportName: 'exampleModule',
      logger: { substep: vi.fn(), warn: vi.fn() },
    }),
  ).resolves.toBe(source)
})

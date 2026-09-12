import { expect, test, vi } from 'vitest'

import { applyCommonTransforms } from '../../wasm-synced/transform.mts'

async function transformSource(source: string) {
  const logger = { substep: vi.fn(), warn: vi.fn() }
  const output = await applyCommonTransforms({
    mjsContent: source,
    initFunctionName: 'createExampleModule',
    exportName: 'exampleModule',
    logger,
  })
  return { output: output.trim(), logger }
}

test.each([
  [
    'export default function createExampleModule() {}',
    'function createExampleModule() {}',
  ],
  [
    'const exampleModule = {}; export default exampleModule; initializeThread();',
    'const exampleModule = {};',
  ],
  ['export const exampleValue = 1;', 'const exampleValue = 1;'],
  ['const exampleValue = 1; export {exampleValue};', 'const exampleValue = 1;'],
  [
    'import exampleDependency from "example-module"; const exampleValue = 1;',
    'const exampleValue = 1;',
  ],
  [
    'function findWasmBinary() { return "example.wasm"; } const filename = findWasmBinary();',
    "const filename = '';",
  ],
  [
    'async function createExampleModule() { return await (exampleValue); }',
    'function createExampleModule() { return (exampleValue); }',
  ],
  [
    'async/* example loader */function createExampleModule() { return await(exampleValue); }',
    '/* example loader */function createExampleModule() { return (exampleValue); }',
  ],
  [
    'const createExample = async function () { return await(exampleValue); };',
    'const createExample = function () { return (exampleValue); };',
  ],
  [
    'const createExample = async()=>await(exampleValue);',
    'const createExample = ()=>(exampleValue);',
  ],
  [
    'const createExample = async () => await exampleValue;',
    'const createExample = () => exampleValue;',
  ],
  [
    'const createExample = function () { return exampleValue; };',
    'const createExample = function () { return exampleValue; };',
  ],
  [
    'const createExample = () => exampleValue;',
    'const createExample = () => exampleValue;',
  ],
  ['readyPromiseResolve?.(exampleModule);', '(moduleRtn = exampleModule);'],
  ['otherCallback?.(exampleModule);', 'otherCallback?.(exampleModule);'],
  [
    'readyPromiseResolve?.(exampleModule, otherValue);',
    'readyPromiseResolve?.(exampleModule, otherValue);',
  ],
  ['exampleModule?.ready;', 'exampleModule?.ready;'],
  ['exampleModule.ready?.();', 'exampleModule.ready?.();'],
  ['const require = createRequire(import.meta.url);', ''],
  [
    'const require = createRequire(import.meta.url), exampleValue = 1;',
    'const  exampleValue = 1;',
  ],
  [
    'const exampleValue = 1, require = createRequire(import.meta.url);',
    'const exampleValue = 1;',
  ],
  [
    'function Module() { return Module; }',
    'function Module() { return moduleRtn; }',
  ],
  [
    'function createOther() { return Module; }',
    'function createOther() { return Module; }',
  ],
  [
    'function Module() { function nestedExample() { return Module; } return Module; }',
    'function Module() { function nestedExample() { return Module; } return moduleRtn; }',
  ],
])('transforms declaration source %s', async (source, expected) => {
  const { output } = await transformSource(source)
  expect(output).toBe(expected)
})

test.each([
  ['instantiate', 'wasmBinary', 'imports'],
  ['instantiateStreaming', 'fetch("example.wasm")', 'imports'],
])(
  'replaces %s loaders with synchronous instantiation',
  async (method, binary, imports) => {
    const { output, logger } = await transformSource(
      `async function loadExample(imports) { return await WebAssembly.${method}(${binary}, ${imports}); }`,
    )
    expect(output).toContain('new WebAssembly.Module(wasmBinary)')
    expect(output).toContain('new WebAssembly.Instance(module,imports)')
    expect(output).toContain('return {instance:instance,module:module}')
    expect(output).not.toContain('fetch(')
    expect(output).not.toContain('WebAssembly.instantiate')
    expect(logger.substep).toHaveBeenCalledTimes(2)
    expect(logger.warn).not.toHaveBeenCalled()
  },
)

test.each(['Module', 'createExampleModule', 'exampleModule'])(
  'preserves the configured entry function %s',
  async functionName => {
    const { output, logger } = await transformSource(
      `function ${functionName}(imports) { return WebAssembly.instantiate(wasmBinary, imports); }`,
    )
    expect(output).toContain('WebAssembly.instantiate(wasmBinary, imports)')
    expect(logger.substep).not.toHaveBeenCalled()
  },
)

test.each([
  'function loadExample(imports) { return WebAssembly.instantiate(otherBinary, imports); }',
  'function loadExample(imports) { new WebAssembly.Instance(existingModule, imports); return WebAssembly.instantiate(wasmBinary, imports); }',
  'function loadExample() { return new ExampleModule(); }',
  'function loadExample() { return new OtherNamespace.Instance(); }',
  'function loadExample() { return new WebAssembly.Module(wasmBinary); }',
  'function loadExample() { return WebAssembly.validate(wasmBinary); }',
  'function loadExample() { return OtherNamespace.instantiate(wasmBinary); }',
  'function loadExample() { return WebAssembly["instantiate"](wasmBinary); }',
])(
  'preserves functions outside the asynchronous loader contract %s',
  async source => {
    expect((await transformSource(source)).output).toBe(source)
  },
)

test('reports a removed post-export loader without inventing generated code', async () => {
  const { output, logger } = await transformSource(
    'export default {}; function loadExample(imports) { return WebAssembly.instantiate(wasmBinary, imports); }',
  )
  expect(output).toBe('')
  expect(logger.warn).toHaveBeenCalledTimes(1)
  expect(logger.substep).not.toHaveBeenCalled()
})

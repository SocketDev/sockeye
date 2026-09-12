import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
const originalArgv = process.argv
beforeEach(() => vi.resetModules())
afterEach(() => {
  process.argv = originalArgv
  vi.restoreAllMocks()
})
const modelChain = [
  'finalized',
  'optimized',
  'quantized',
  'converted',
  'downloaded',
]
const scripts = [
  {
    name: 'codet5-models-builder',
    chain: modelChain,
    load: () =>
      import('../../../packages/codet5-models-builder/scripts/get-checkpoint-chain.mts'),
  },
  {
    name: 'minilm-builder',
    chain: modelChain,
    load: () =>
      import('../../../packages/minilm-builder/scripts/get-checkpoint-chain.mts'),
  },
  {
    name: 'lief-builder',
    chain: ['lief-built'],
    load: () =>
      import('../../../packages/lief-builder/scripts/get-checkpoint-chain.mts'),
  },
  {
    name: 'node-smol-builder',
    chain: [
      'finalized',
      'binary-compressed',
      'binary-stripped',
      'binary-released',
      'source-patched',
      'source-copied',
    ],
    load: () =>
      import('../../../packages/node-smol-builder/scripts/get-checkpoint-chain.mts'),
  },
]

test.each(scripts)(
  '$name CLI prints a single machine-readable checkpoint chain',
  async ({ name, chain, load }) => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    process.argv = [
      process.execPath,
      fileURLToPath(
        new URL(
          `../../../packages/${name}/scripts/get-checkpoint-chain.mts`,
          import.meta.url,
        ),
      ),
    ]
    await load()
    expect(write).toHaveBeenCalledExactlyOnceWith(`${chain.join(',')}\n`)
  },
)

test.each([
  {
    name: 'onnxruntime-builder',
    configured: false,
    load: () =>
      import('../../../packages/onnxruntime-builder/scripts/get-checkpoint-chain.mts'),
  },
  {
    name: 'yoga-layout-builder',
    configured: true,
    load: () =>
      import('../../../packages/yoga-layout-builder/scripts/get-checkpoint-chain.mts'),
  },
])(
  '$name CLI includes optimization only for production builds',
  async ({ name, configured, load }) => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const script = fileURLToPath(
      new URL(
        `../../../packages/${name}/scripts/get-checkpoint-chain.mts`,
        import.meta.url,
      ),
    )
    process.argv = [process.execPath, script, '--prod']
    await load()
    const tail = configured
      ? ['source-configured', 'source-cloned']
      : ['source-cloned']
    const prefix = ['finalized', 'wasm-synced']
    expect(write).toHaveBeenLastCalledWith(
      `${[...prefix, 'wasm-optimized', 'wasm-released', 'wasm-compiled', ...tail].join(',')}\n`,
    )
    vi.resetModules()
    write.mockClear()
    process.argv = [process.execPath, script, '--dev']
    await load()
    expect(write).toHaveBeenCalledExactlyOnceWith(
      `${[...prefix, 'wasm-released', 'wasm-compiled', ...tail].join(',')}\n`,
    )
  },
)

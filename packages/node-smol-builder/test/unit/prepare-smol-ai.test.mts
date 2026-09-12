import path from 'node:path'
import { beforeEach, expect, test, vi } from 'vitest'
import { copySmolAiArtifacts } from '../../scripts/binary-released/shared/prepare-smol-ai.mts'

const io = vi.hoisted(() => ({
  platform: 'linux',
  exists: vi.fn<(file: string) => boolean>(),
  mkdir: vi.fn(),
  copy: vi.fn<(source: string, destination: string) => Promise<void>>(),
  remove: vi.fn(),
  build:
    vi.fn<
      (tool: string, options: { cwd: string; args: string[] }) => Promise<void>
    >(),
}))
vi.mock(import('node:fs'), () => ({
  existsSync: io.exists,
  promises: { mkdir: io.mkdir, copyFile: io.copy },
}))
vi.mock(import('node:process'), () => ({
  default: {
    get platform() {
      return io.platform
    },
  },
}))
vi.mock(import('local-build-infra/lib/build-operations'), () => ({
  execBuildStep: io.build,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: io.remove,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({ step: vi.fn(), substep: vi.fn() }),
}))
vi.mock(import('../../scripts/binary-released/shared/paths.mts'), () => ({
  ADDITIONS_SOURCE_PATCHED_DIR: '/example/additions',
}))
vi.mock(import('../../scripts/paths.mts'), () => ({
  LANGUAGE_MODEL_INFRA_DIR: '/example/language-model',
}))
beforeEach(() => {
  vi.clearAllMocks()
  io.platform = 'linux'
  io.exists.mockReturnValue(true)
  io.build.mockResolvedValue(undefined)
})

test.each(['linux', 'win32'])(
  'stages the five %s libraries after the configured build completes',
  async platform => {
    io.platform = platform
    await copySmolAiArtifacts('prod', `${platform}-x64`)
    expect(io.build).toHaveBeenCalledTimes(2)
    expect(io.build.mock.calls[0]?.[1].args).toContain(
      '-DCMAKE_BUILD_TYPE=Release',
    )
    expect(io.build.mock.calls[0]?.[1].args).toContain(
      '-DSMOL_AI_BUILD_NAPI=OFF',
    )
    expect(io.build.mock.calls[1]?.[1].args).toContain('smol_ai_core')
    expect(io.copy).toHaveBeenCalledTimes(5)
    expect(io.copy.mock.calls.map(([source]) => path.basename(source))).toEqual(
      platform === 'win32'
        ? [
            'smol_ai_core.lib',
            'llama.lib',
            'ggml.lib',
            'ggml-cpu.lib',
            'ggml-base.lib',
          ]
        : [
            'libsmol_ai_core.a',
            'libllama.a',
            'libggml.a',
            'libggml-cpu.a',
            'libggml-base.a',
          ],
    )
    expect(io.remove).toHaveBeenCalledExactlyOnceWith(
      '/example/additions/deps/smol-ai/lib',
    )
    expect(io.build.mock.invocationCallOrder[1]).toBeLessThan(
      io.remove.mock.invocationCallOrder[0]!,
    )
    expect(
      io.copy.mock.calls.every(
        ([source, destination]) =>
          path.basename(source) === path.basename(destination),
      ),
    ).toBe(true)
  },
)
test('missing libraries fail after a debug build', async () => {
  io.exists.mockReturnValue(false)
  await expect(copySmolAiArtifacts('dev', 'linux-x64')).rejects.toThrow(Error)
  expect(io.build.mock.calls[0]?.[1].args).toContain('-DCMAKE_BUILD_TYPE=Debug')
  expect(io.copy).not.toHaveBeenCalled()
})
test('failed configuration preserves staged libraries', async () => {
  io.build.mockRejectedValueOnce(new Error('example configure failure'))
  await expect(copySmolAiArtifacts('prod', 'linux-x64')).rejects.toThrow(Error)
  expect(io.build).toHaveBeenCalledTimes(1)
  expect(io.remove).not.toHaveBeenCalled()
  expect(io.copy).not.toHaveBeenCalled()
})

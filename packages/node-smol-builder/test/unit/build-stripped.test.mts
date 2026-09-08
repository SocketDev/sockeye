import { beforeEach, expect, test, vi } from 'vitest'
import { stripPlatformBinary } from '../../scripts/binary-stripped/shared/build-stripped.mts'

const io = vi.hoisted(() => ({ exec: vi.fn(), tool: vi.fn(), which: vi.fn() }))
vi.mock(
  import('local-build-infra/lib/build-operations'),
  async importOriginal => ({
    ...(await importOriginal()),
    exec: io.exec,
  }),
)
vi.mock(
  import('local-build-infra/lib/tool-installer'),
  async importOriginal => ({
    ...(await importOriginal()),
    ensureToolInstalled: io.tool,
  }),
)
vi.mock(
  import('@socketsecurity/lib-stable/exe/path/which'),
  async importOriginal => ({
    ...(await importOriginal()),
    whichSync: io.which,
  }),
)

beforeEach(() => {
  vi.clearAllMocks()
  io.exec.mockResolvedValue(undefined)
  io.tool.mockResolvedValue({ available: false })
  io.which.mockReturnValue(undefined)
})

test('skips stripping Windows binaries', async () => {
  await stripPlatformBinary('/example/node.exe', {
    arch: 'x64',
    platform: 'win32',
  })
  expect(io.exec).not.toHaveBeenCalled()
  expect(io.tool).not.toHaveBeenCalled()
})

test('preserves Linux x64 symbol metadata even when optional tools exist', async () => {
  io.which.mockReturnValue('/example/tool')
  await stripPlatformBinary('/example/node', { arch: 'x64', platform: 'linux' })
  expect(io.exec.mock.calls).toEqual([
    ['strip', ['--strip-debug', '/example/node']],
    ['sstrip', ['/example/node']],
  ])
})

test('removes optional ARM64 sections and continues if a section is absent', async () => {
  io.which.mockReturnValue('/example/tool')
  io.exec.mockImplementation(async command => {
    if (command === 'objcopy') {
      throw new Error('Fixture absent section')
    }
  })
  await stripPlatformBinary('/example/node', {
    arch: 'arm64',
    platform: 'linux',
  })
  expect(
    io.exec.mock.calls.filter(([command]) => command === 'objcopy'),
  ).toHaveLength(4)
  expect(io.exec).toHaveBeenLastCalledWith('sstrip', ['/example/node'])
})

for (const available of [false, true]) {
  test(`preserves macOS Node-API symbols with llvm-strip available=${available}`, async () => {
    io.tool.mockResolvedValue({ available })
    await stripPlatformBinary('/example/node', {
      arch: 'arm64',
      platform: 'darwin',
    })
    expect(io.exec).toHaveBeenNthCalledWith(1, 'strip', ['-x', '/example/node'])
    expect(io.exec).toHaveBeenCalledTimes(available ? 2 : 1)
    if (available) {
      expect(io.exec).toHaveBeenLastCalledWith('llvm-strip', [
        '--strip-debug',
        '/example/node',
      ])
    }
  })
}

test('refuses unknown target platforms before invoking a tool', async () => {
  await expect(
    stripPlatformBinary('/example/node', { arch: 'x64', platform: 'unknown' }),
  ).rejects.toThrow()
  expect(io.exec).not.toHaveBeenCalled()
})

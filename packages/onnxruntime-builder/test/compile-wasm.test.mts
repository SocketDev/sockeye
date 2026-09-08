import process from 'node:process'
import { afterEach, expect, test, vi } from 'vitest'
import { addRootBuildArgument } from '../scripts/wasm-compiled/shared/compile-wasm.mts'

const io = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock(
  import('@socketsecurity/lib-stable/process/spawn/child'),
  async importOriginal => ({
    ...(await importOriginal()),
    spawn: io.spawn,
  }),
)

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

test('does not probe root support for a non-root build', async () => {
  vi.spyOn(process, 'getuid').mockReturnValue(1000)
  const args = ['--build_wasm']
  await addRootBuildArgument(args, '/example/source')
  expect(io.spawn).not.toHaveBeenCalled()
  expect(args).toEqual(['--build_wasm'])
})

for (const channel of ['stdout', 'stderr']) {
  test(`includes root permission only when ${channel} advertises support`, async () => {
    vi.spyOn(process, 'getuid').mockReturnValue(0)
    io.spawn.mockResolvedValue({ [channel]: '--allow_running_as_root' })
    const args = ['--build_wasm']
    await addRootBuildArgument(args, '/example/source')
    expect(args).toEqual(['--build_wasm', '--allow_running_as_root'])
    expect(io.spawn).toHaveBeenCalledWith(
      'python3',
      [expect.stringMatching(/build\.py$/u), '--help'],
      { cwd: '/example/source', stdio: 'pipe' },
    )
  })
}

test('retains arguments when upstream does not support the root flag', async () => {
  vi.spyOn(process, 'getuid').mockReturnValue(0)
  io.spawn.mockResolvedValue({ stdout: '--build_wasm', stderr: '' })
  const args = ['--build_wasm']
  await addRootBuildArgument(args, '/example/source')
  expect(args).toEqual(['--build_wasm'])
})

test('retains arguments when the root support probe fails', async () => {
  vi.spyOn(process, 'getuid').mockReturnValue(0)
  io.spawn.mockRejectedValue(new Error('Fixture Python probe failure'))
  const args = ['--build_wasm']
  await addRootBuildArgument(args, '/example/source')
  expect(args).toEqual(['--build_wasm'])
})

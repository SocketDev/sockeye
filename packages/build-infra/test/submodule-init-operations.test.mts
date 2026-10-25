import process from 'node:process'
import { beforeEach, expect, test, vi } from 'vitest'
import { ensureSubmodule } from '../lib/submodule-init.mts'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  spawn: vi.fn(),
  success: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    info: vi.fn(),
    log: vi.fn(),
    success: io.success,
  }),
}))
const config = {
  monorepoRoot: '/example/repo',
  name: 'example-library',
  sentinelFile: 'include/example.h',
  submodulePath: 'upstream/example-library',
}
beforeEach(() => {
  vi.clearAllMocks()
  io.exists.mockReturnValue(false)
  io.spawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })
})
test('existing sentinel skips all materialization', async () => {
  io.exists.mockReturnValue(true)
  await ensureSubmodule(config)
  expect(io.spawn).not.toHaveBeenCalled()
})
test('missing Git metadata refuses materialization', async () => {
  await expect(ensureSubmodule(config)).rejects.toThrow()
  expect(io.spawn).not.toHaveBeenCalled()
})
test('materializes through the fleet clone entry and verifies its sentinel', async () => {
  io.exists
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true)
    .mockReturnValueOnce(true)
  await ensureSubmodule(config)
  expect(io.spawn).toHaveBeenCalledExactlyOnceWith(
    process.execPath,
    [
      '/example/repo/scripts/fleet/git-partial-submodule.mts',
      'clone',
      'upstream/example-library',
    ],
    { cwd: config.monorepoRoot, stdio: 'inherit' },
  )
  expect(io.success).toHaveBeenCalledOnce()
})
test('successful clone without sentinel is not success', async () => {
  io.exists
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true)
    .mockReturnValueOnce(false)
  await expect(ensureSubmodule(config)).rejects.toThrow()
  expect(io.success).not.toHaveBeenCalled()
})
test('rejected clone retains its process error as cause', async () => {
  const failure = Object.assign(new Error('Fixture clone failure'), {
    code: 1,
    stdout: '',
    stderr: '',
  })
  io.exists.mockReturnValueOnce(false).mockReturnValueOnce(true)
  io.spawn.mockRejectedValue(failure)
  await expect(ensureSubmodule(config)).rejects.toMatchObject({
    cause: failure,
  })
  expect(io.success).not.toHaveBeenCalled()
})

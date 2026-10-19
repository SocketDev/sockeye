import { beforeEach, expect, test, vi } from 'vitest'
import { execBuildStep } from '../lib/build-operations.mts'
const io = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
beforeEach(() => vi.resetAllMocks())

test('shell argument strings remain explicit caller-controlled command syntax', async () => {
  const result = { code: 0, stdout: 'example output', stderr: '' }
  io.spawn.mockResolvedValueOnce(result)
  expect(
    await execBuildStep('example-command', {
      args: '--version',
      // oxlint-disable-next-line socket/prefer-shell-win32 -- mocked API.
      shell: true,
      encoding: 'utf8',
    }),
  ).toBe(result)
  expect(io.spawn).toHaveBeenCalledExactlyOnceWith(
    'example-command --version',
    [],
    // oxlint-disable-next-line socket/prefer-shell-win32 -- mocked API.
    { shell: true, encoding: 'utf8' },
  )
})

test('explicit non-throwing spawn results still fail a build step on nonzero exit', async () => {
  io.spawn.mockResolvedValueOnce({
    code: 2,
    stdout: '',
    stderr: 'example build failed',
  })
  await expect(
    execBuildStep('example-command', { args: ['--build'], throws: false }),
  ).rejects.toThrow()
  expect(io.spawn).toHaveBeenCalledExactlyOnceWith(
    'example-command',
    ['--build'],
    { throws: false, stdio: 'inherit' },
  )
})

import { beforeEach, expect, test, vi } from 'vitest'
import { runParallel, runSequence } from '../lib/script-runner.mts'
const io = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
beforeEach(() => vi.resetAllMocks())
test('parallel command rejection retains its originating command error while other commands complete', async () => {
  const failure = new Error('example command failed')
  io.spawn
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce({ code: 0, stdout: 'complete', stderr: '' })
  const results = await runParallel([
    { command: 'example-failed', args: ['--check'] },
    { command: 'example-complete' },
  ])
  expect(results[0]).toMatchObject({
    code: 1,
    error: failure,
    stderr: 'example command failed',
  })
  expect(results[1]).toMatchObject({ code: 0, stdout: 'complete' })
  expect(io.spawn).toHaveBeenCalledTimes(2)
})
test('sequential command launch failure stops all later commands', async () => {
  const failure = new Error('example executable missing')
  io.spawn.mockRejectedValue(failure)
  await expect(
    runSequence([
      { command: 'example-missing' },
      { command: 'example-never-run' },
    ]),
  ).rejects.toBe(failure)
  expect(io.spawn).toHaveBeenCalledOnce()
})

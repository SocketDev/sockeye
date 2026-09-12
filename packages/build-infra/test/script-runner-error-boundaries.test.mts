import { runInNewContext } from 'node:vm'
import { beforeEach, expect, test, vi } from 'vitest'
import { runCommand, runParallel } from '../lib/script-runner.mts'
import type { CommandSpec } from '../lib/script-runner.mts'
const io = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
beforeEach(() => vi.resetAllMocks())

test('runCommand preserves the original rejected process failure', async () => {
  const failure = Object.assign(new Error('example command failed'), {
    code: 2,
    stdout: '',
    stderr: 'example failure',
  })
  io.spawn.mockRejectedValueOnce(failure)
  await expect(runCommand('example-command')).rejects.toBe(failure)
  expect(io.spawn).toHaveBeenCalledExactlyOnceWith(
    'example-command',
    [],
    expect.objectContaining({ stdio: 'inherit' }),
  )
})

test('parallel failures without arguments preserve cross-realm error diagnostics', async () => {
  const failure: unknown = runInNewContext("new Error('example realm failure')")
  expect(failure).not.toBeInstanceOf(Error)
  io.spawn.mockRejectedValueOnce(failure)
  const results = await runParallel([{ command: 'example-command' }])
  expect(results).toHaveLength(1)
  expect(results[0]).toMatchObject({ code: 1, stderr: String(failure) })
  expect(results[0]?.error).toBeInstanceOf(Error)
})

test('parallel result reporting survives caller removal of the originating command', async () => {
  const commands: CommandSpec[] = [{ command: 'example-command' }]
  const { promise, reject } = Promise.withResolvers<never>()
  io.spawn.mockReturnValueOnce(promise)
  const pending = runParallel(commands)
  commands.length = 0
  const failure = new Error('example delayed process failure')
  reject(failure)
  expect(await pending).toEqual([
    { code: 1, error: failure, stderr: failure.message },
  ])
})

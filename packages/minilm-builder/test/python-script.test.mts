import { beforeEach, expect, test, vi } from 'vitest'
import { runPythonScript } from '../scripts/python-script.mts'

const io = vi.hoisted(() => ({ python: vi.fn(), spawn: vi.fn() }))
vi.mock(
  import('local-build-infra/lib/python-installer'),
  async importOriginal => ({
    ...(await importOriginal()),
    getPythonCommand: io.python,
  }),
)
vi.mock(
  import('@socketsecurity/lib-stable/process/spawn/child'),
  async importOriginal => ({
    ...(await importOriginal()),
    spawn: io.spawn,
  }),
)

beforeEach(() => {
  vi.clearAllMocks()
  io.python.mockResolvedValue('/example/bin/python3')
  io.spawn.mockResolvedValue({
    code: 0,
    stdout: '{"code":"complete","files":2}\n',
    stderr: '',
  })
})

test('returns the final JSON record and forwards script arguments and options', async () => {
  io.spawn.mockResolvedValue({
    code: 0,
    stdout: '{"code":"model_loaded"}\r\n\n{"code":"complete","files":2}\n',
    stderr: '',
  })
  await expect(
    runPythonScript('convert.py', ['example-model'], { cwd: '/example/cache' }),
  ).resolves.toEqual({ code: 'complete', files: 2 })
  expect(io.spawn).toHaveBeenCalledWith(
    '/example/bin/python3',
    [expect.stringMatching(/convert\.py$/u), 'example-model'],
    { cwd: '/example/cache' },
  )
})

test('refuses a missing Python executable without spawning', async () => {
  io.python.mockResolvedValue(undefined)
  await expect(runPythonScript('convert.py', [])).rejects.toThrow()
  expect(io.spawn).not.toHaveBeenCalled()
})

for (const result of [
  { code: 1, stdout: '', stderr: 'fixture conversion failure' },
  { code: 0, stdout: ' ', stderr: '' },
  { code: 0, stdout: '{"error":"fixture model failure"}', stderr: '' },
  { code: 0, stdout: 'invalid JSON', stderr: '' },
]) {
  test(`rejects invalid Python result ${JSON.stringify(result)}`, async () => {
    io.spawn.mockResolvedValue(result)
    await expect(runPythonScript('convert.py', [])).rejects.toThrow()
  })
}

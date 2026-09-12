import { beforeEach, expect, test, vi } from 'vitest'
import { runPythonPipRetries } from '../lib/python-pip-retry.mts'
const io = vi.hoisted(() => ({ spawn: vi.fn(), managed: false }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('../lib/python-installer.mts'), () => ({
  isPEP668Managed: () => io.managed,
  setCachedPEP668: (value: boolean) => {
    io.managed = value
  },
  venvAvailable: false,
}))
beforeEach(() => {
  vi.resetAllMocks()
  io.managed = false
})
function config() {
  return {
    pip: 'example-pip',
    args: ['install', '--only-binary=:all:', 'example-package==1.2.3'],
    spawnOptions: { stdio: 'pipe' },
    packageName: 'example-package',
    quiet: false,
  }
}

test('expected pip failures request exit results and retain managed flags across bounded retries', async () => {
  const outputs = [
    { code: 1, stdout: '', stderr: 'externally-managed-environment' },
    { code: 1, stdout: '', stderr: 'example missing wheel' },
    { code: 0, stdout: '', stderr: '' },
  ]
  io.spawn.mockImplementation(
    async (
      pip: string,
      args: string[],
      options: { throws?: boolean | undefined },
    ) => {
      const result = outputs.shift()
      if (!result) {
        throw new Error('unexpected extra retry')
      }
      if (result.code !== 0 && options.throws !== false) {
        throw Object.assign(new Error('example pip exited'), {
          cmd: pip,
          args,
          ...result,
        })
      }
      return result
    },
  )
  expect(await runPythonPipRetries(config())).toBe(0)
  expect(io.spawn).toHaveBeenCalledTimes(3)
  expect(io.spawn.mock.calls[2]?.[1]).toEqual([
    'install',
    '--break-system-packages',
    'example-package==1.2.3',
  ])
})

test('launch failures reject without retrying', async () => {
  const failure = Object.assign(new Error('example missing executable'), {
    code: 'ENOENT',
  })
  io.spawn.mockRejectedValue(failure)
  await expect(runPythonPipRetries(config())).rejects.toBe(failure)
  expect(io.spawn).toHaveBeenCalledOnce()
})

test('signal termination cannot report a successful installation or retry', async () => {
  io.spawn.mockImplementation(
    async (
      pip: string,
      args: string[],
      options: { throws?: boolean | undefined },
    ) => {
      const result = {
        cmd: pip,
        args,
        // oxlint-disable-next-line socket/prefer-undefined-over-null -- Node reports null exit status when a signal terminates a child.
        code: null,
        signal: 'SIGTERM',
        stdout: '',
        stderr: '',
      }
      if (options.throws !== false) {
        throw Object.assign(new Error('example terminated pip'), result)
      }
      return result
    },
  )
  await expect(runPythonPipRetries(config())).rejects.toThrow()
  expect(io.spawn).toHaveBeenCalledOnce()
})

test('source installation failure returns its exit status after exactly one fallback', async () => {
  io.spawn.mockImplementation(
    async (
      pip: string,
      args: string[],
      options: { throws?: boolean | undefined },
    ) => {
      const result = {
        cmd: pip,
        args,
        code: 2,
        stdout: '',
        stderr: 'example rejected distribution',
      }
      if (options.throws !== false) {
        throw Object.assign(new Error('example pip failed'), result)
      }
      return result
    },
  )
  expect(await runPythonPipRetries(config())).toBe(2)
  expect(io.spawn).toHaveBeenCalledTimes(2)
})

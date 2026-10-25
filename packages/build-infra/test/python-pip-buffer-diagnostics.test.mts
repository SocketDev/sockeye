import { beforeEach, expect, test, vi } from 'vitest'
import {
  runPythonPipRetries,
  shouldRetryManagedPython,
} from '../lib/python-pip-retry.mts'
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

test('buffered pip diagnostics trigger one managed-environment retry', async () => {
  io.spawn
    .mockResolvedValueOnce({
      code: 1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from('externally-managed-environment'),
    })
    .mockResolvedValueOnce({
      code: 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    })
  const args = ['install', 'example-package==1.2.3']
  expect(
    await runPythonPipRetries({
      pip: 'example-pip',
      args,
      spawnOptions: { stdio: 'pipe', stdioString: false },
      packageName: 'example-package',
      quiet: true,
    }),
  ).toBe(0)
  expect(io.spawn).toHaveBeenNthCalledWith(
    2,
    'example-pip',
    ['install', '--break-system-packages', 'example-package==1.2.3'],
    { stdio: 'pipe', stdioString: false, throws: false },
  )
  expect(args).toEqual(['install', 'example-package==1.2.3'])
})

test('missing diagnostics on a caller-supplied result do not request a managed retry', () => {
  expect(
    shouldRetryManagedPython({
      result: { code: 1 },
      exitCode: 1,
      args: ['install', 'example-package'],
    }),
  ).toBe(false)
})

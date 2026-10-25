import { beforeEach, expect, test, vi } from 'vitest'
import { validateTarballPaths } from '../lib/tarball-utils.mts'
const io = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
vi.mock(import('../lib/which-required.mts'), () => ({
  whichRequired: async () => '/example/tar',
}))
beforeEach(() => vi.resetAllMocks())
test.each([
  'example\0hidden',
  '../escape',
  'example/../../escape',
  '/etc/example',
  '\\example\\absolute',
])('unsafe archive member %s is rejected before extraction', async member => {
  io.spawn.mockResolvedValue({ code: 0, stdout: `${member}\n`, stderr: '' })
  await expect(
    validateTarballPaths('/example/archive.tar.gz'),
  ).rejects.toThrow()
  expect(io.spawn).toHaveBeenCalledOnce()
})
test('tar listing process failure propagates instead of accepting an empty archive', async () => {
  const failure = new Error('example corrupt gzip')
  io.spawn.mockRejectedValue(failure)
  await expect(validateTarballPaths('/example/archive.tar.gz')).rejects.toBe(
    failure,
  )
})

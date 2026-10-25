import { beforeEach, expect, test, vi } from 'vitest'
import {
  applyPatch,
  revertPatch,
  testPatchApplication,
  validatePatch,
} from '../lib/patch-validator.mts'

const io = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/exe/path/which'), () => ({
  which: async () => '/example/patch',
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))

beforeEach(() => {
  io.spawn.mockRejectedValue(
    Object.assign(new Error('Fixture patch process terminated'), {
      // oxlint-disable-next-line socket/prefer-undefined-over-null -- Node API.
      code: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: '',
    }),
  )
})

test.each([
  { name: 'apply', operation: applyPatch },
  { name: 'revert', operation: revertPatch },
])('a terminated patch $name rejects', async ({ operation }) => {
  await expect(
    operation('/example/change.patch', '/example/source'),
  ).rejects.toThrow()
})

test.each([
  { name: 'reverse', operation: testPatchApplication },
  { name: 'validate', operation: validatePatch },
])('a terminated patch $name probe fails', async ({ operation }) => {
  await expect(
    operation('/example/change.patch', '/example/source'),
  ).resolves.toBe(false)
})

import process from 'node:process'
import { afterEach, expect, test, vi } from 'vitest'
const io = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: io.spawn,
}))
const argv = process.argv
afterEach(() => {
  process.argv = argv
})
test('importing without a script argument does not start a stub build', async () => {
  process.argv = [process.execPath]
  const api = await import('../lib/build-stubs.mts')
  expect(api.ensureStubs).toBeTypeOf('function')
  expect(io.spawn).not.toHaveBeenCalled()
})

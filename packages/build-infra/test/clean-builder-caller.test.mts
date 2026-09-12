import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanBuilder } from '../lib/clean-builder.mts'
const io = vi.hoisted(() => ({
  exists: vi.fn(),
  remove: vi.fn(),
  checkpoint: vi.fn(),
  info: vi.fn(),
}))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: io.remove,
}))
vi.mock(import('../lib/checkpoint-manager.mts'), () => ({
  cleanCheckpoint: io.checkpoint,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({ info: io.info, success: vi.fn() }),
}))
const stackDescriptor = Object.getOwnPropertyDescriptor(
  Error,
  'prepareStackTrace',
)
beforeEach(() => {
  vi.clearAllMocks()
  io.exists.mockReturnValue(false)
})
afterEach(() => {
  if (stackDescriptor) {
    Object.defineProperty(Error, 'prepareStackTrace', stackDescriptor)
  } else {
    Reflect.deleteProperty(Error, 'prepareStackTrace')
  }
})
test('derives the package from a standard file-URL caller frame', async () => {
  Object.defineProperty(Error, 'prepareStackTrace', {
    configurable: true,
    writable: true,
    value: () =>
      'Error\n    at cleanBuilder (file:///example/helper.mts:1:1)\n    at caller (file:///example/package/scripts/clean.mts:10:2)',
  })
  await cleanBuilder('example-builder')
  expect(io.exists).toHaveBeenCalledWith('/example/package/build')
  expect(io.remove).not.toHaveBeenCalled()
})
test.each([undefined, 'Error'])(
  'requires an explicit directory when the stack cannot identify a caller: %s',
  async stack => {
    Object.defineProperty(Error, 'prepareStackTrace', {
      configurable: true,
      writable: true,
      value: () => stack,
    })
    await expect(cleanBuilder('example-builder')).rejects.toThrow()
    expect(io.remove).not.toHaveBeenCalled()
    expect(io.checkpoint).not.toHaveBeenCalled()
  },
)
test('uses the supplied logger independently of stack availability', async () => {
  const logger = { info: vi.fn(), success: vi.fn() }
  await cleanBuilder('example-builder', {
    packageDir: '/example/package',
    checkpointModes: [],
    logger,
  })
  expect(logger.info).toHaveBeenCalledWith('Nothing to clean')
  expect(io.info).not.toHaveBeenCalled()
})

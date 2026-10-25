import { beforeEach, expect, test, vi } from 'vitest'
import { withLock, withTryLock } from '../lib/checkpoint-lock.mts'
const io = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return { ...actual, promises: { ...actual.promises, open: io.open } }
})
beforeEach(() => vi.resetAllMocks())
function lockHandle() {
  return {
    lock: vi.fn().mockResolvedValue(undefined),
    tryLock: vi.fn().mockResolvedValue(true),
    unlock: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

test.each(['sh', 'ex'] as const)(
  'blocking %s locks wrap work and release the descriptor',
  async mode => {
    const handle = lockHandle()
    io.open.mockResolvedValue(handle)
    const work = vi.fn().mockResolvedValue('example result')
    expect(await withLock('/example/checkpoint.lock', mode, work)).toBe(
      'example result',
    )
    expect(io.open).toHaveBeenCalledWith('/example/checkpoint.lock', 'a')
    expect(handle.lock).toHaveBeenCalledWith(mode)
    expect(handle.lock).toHaveBeenCalledBefore(work)
    expect(work).toHaveBeenCalledBefore(handle.unlock)
    expect(handle.unlock).toHaveBeenCalledBefore(handle.close)
  },
)

test('blocking work failures propagate after cleanup', async () => {
  const handle = lockHandle()
  const failure = new Error('fixture work failed')
  io.open.mockResolvedValue(handle)
  await expect(
    withLock('/example/checkpoint.lock', 'ex', async () => {
      throw failure
    }),
  ).rejects.toBe(failure)
  expect(handle.close).toHaveBeenCalledOnce()
})

test('open failures never invoke work', async () => {
  const failure = Object.assign(new Error('fixture denied lock'), {
    code: 'EACCES',
  })
  io.open.mockRejectedValue(failure)
  const work = vi.fn()
  await expect(withLock('/example/checkpoint.lock', 'ex', work)).rejects.toBe(
    failure,
  )
  expect(await withTryLock('/example/checkpoint.lock', work)).toBeUndefined()
  expect(work).not.toHaveBeenCalled()
})

test.each([true, false])(
  'nonblocking locks report acquisition=%s and release only acquired locks',
  async acquired => {
    const handle = lockHandle()
    handle.tryLock.mockResolvedValue(acquired)
    io.open.mockResolvedValue(handle)
    const work = vi.fn().mockResolvedValue('example result')
    expect(await withTryLock('/example/checkpoint.lock', work)).toBe(
      'example result',
    )
    expect(work).toHaveBeenCalledWith(acquired)
    expect(handle.tryLock).toHaveBeenCalledWith('ex')
    expect(handle.unlock).toHaveBeenCalledTimes(acquired ? 1 : 0)
    expect(handle.close).toHaveBeenCalledOnce()
  },
)

test('platforms without lock primitives still close opened handles', async () => {
  const close = vi.fn().mockResolvedValue(undefined)
  io.open.mockResolvedValue({ close })
  expect(await withLock('/example/checkpoint.lock', 'ex', async () => 42)).toBe(
    42,
  )
  const work = vi.fn().mockResolvedValue(24)
  expect(await withTryLock('/example/checkpoint.lock', work)).toBe(24)
  expect(work).toHaveBeenCalledWith(true)
  expect(close).toHaveBeenCalledTimes(2)
})

test('lock acquisition failures close handles and do not invoke work', async () => {
  const handle = lockHandle()
  const failure = Object.assign(new Error('fixture lock failed'), {
    code: 'EIO',
  })
  handle.lock.mockRejectedValue(failure)
  handle.tryLock.mockRejectedValue(failure)
  io.open.mockResolvedValue(handle)
  const work = vi.fn()
  await expect(withLock('/example/checkpoint.lock', 'ex', work)).rejects.toBe(
    failure,
  )
  expect(await withTryLock('/example/checkpoint.lock', work)).toBeUndefined()
  expect(work).not.toHaveBeenCalled()
  expect(handle.close).toHaveBeenCalledTimes(2)
})

test('nonblocking callback errors remain swallowed after cleanup', async () => {
  const handle = lockHandle()
  io.open.mockResolvedValue(handle)
  expect(
    await withTryLock('/example/checkpoint.lock', async () => {
      throw new Error('fixture callback failed')
    }),
  ).toBeUndefined()
  expect(handle.unlock).toHaveBeenCalledOnce()
  expect(handle.close).toHaveBeenCalledOnce()
})

test.each(['blocking', 'nonblocking'])(
  '%s unlock failure still closes the descriptor',
  async mode => {
    const handle = lockHandle()
    handle.unlock.mockRejectedValue(
      Object.assign(new Error('fixture unlock failed'), { code: 'EIO' }),
    )
    io.open.mockResolvedValue(handle)
    const result =
      mode === 'blocking'
        ? await withLock('/example/checkpoint.lock', 'ex', async () => 42)
        : await withTryLock('/example/checkpoint.lock', async () => 42)
    expect(result).toBe(42)
    expect(handle.close).toHaveBeenCalledOnce()
  },
)

test.each(['blocking', 'nonblocking'])(
  '%s close failure does not replace successful work',
  async mode => {
    const handle = lockHandle()
    handle.close.mockRejectedValue(
      Object.assign(new Error('fixture close failed'), { code: 'EIO' }),
    )
    io.open.mockResolvedValue(handle)
    const result =
      mode === 'blocking'
        ? await withLock('/example/checkpoint.lock', 'ex', async () => 42)
        : await withTryLock('/example/checkpoint.lock', async () => 42)
    expect(result).toBe(42)
  },
)

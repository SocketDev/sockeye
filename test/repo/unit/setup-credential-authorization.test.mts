import process from 'node:process'
import type { OnePasswordPrompts } from '../../../scripts/repo/one-password-metadata.mts'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  choose: vi.fn(),
  input: vi.fn(),
  confirm: vi.fn(),
  which: vi.fn(),
  realpath: vi.fn(),
  metadata: vi.fn(),
}))
vi.mock('@socketsecurity/lib-stable/secrets/one-password', () => ({
  authorizeOnePasswordTerminal: mocks.authorize,
}))
vi.mock('@socketsecurity/lib-stable/exe/path/which', () => ({
  whichSync: mocks.which,
}))
vi.mock('@socketsecurity/lib-stable/stdio/prompts', () => ({
  select: mocks.choose,
  input: mocks.input,
  confirm: mocks.confirm,
}))
vi.mock('node:fs', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  realpathSync: mocks.realpath,
}))
vi.mock('../../../scripts/fleet/process/is-main-module.mts', () => ({
  isMainModule: () => false,
}))
vi.mock(
  '../../../scripts/repo/one-password-metadata.mts',
  async importOriginal => ({
    ...(await importOriginal<
      typeof import('../../../scripts/repo/one-password-metadata.mts')
    >()),
    selectOnePasswordReference: mocks.metadata,
  }),
)

import {
  authorizeOnePasswordAccount,
  chooseOnePasswordReference,
} from '../../../scripts/repo/setup-credential.mts'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.which.mockReturnValue('/example/op')
  mocks.realpath.mockReturnValue('/example/canonical/op')
  mocks.authorize.mockResolvedValue({ status: 'authorized' })
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

test('authorizes an explicit account through a canonical CLI alias', async () => {
  await authorizeOnePasswordAccount('/example/supported/op', 'exampleaccount')
  expect(mocks.authorize).toHaveBeenCalledWith({ account: 'exampleaccount' })
  expect(mocks.realpath.mock.calls).toEqual([
    ['/example/op'],
    ['/example/supported/op'],
  ])
  expect(process.stderr.write).toHaveBeenCalledWith(
    expect.stringContaining('Integrate with 1Password CLI'),
  )
})

test.each([
  'not-interactive',
  'cli-unavailable',
  'authorization-failed',
  'timed-out',
])('stops setup after %s', async status => {
  mocks.authorize.mockResolvedValue({ status })
  await expect(
    authorizeOnePasswordAccount('/example/op', 'exampleaccount'),
  ).rejects.toThrow()
})

test('does not expose unexpected backend diagnostics', async () => {
  mocks.authorize.mockRejectedValue(new Error('backend private diagnostic'))
  await expect(
    authorizeOnePasswordAccount('/example/op', 'exampleaccount'),
  ).rejects.toMatchObject({
    message: expect.not.stringContaining('backend private diagnostic'),
  })
  expect(process.stderr.write).toHaveBeenCalledTimes(1)
})

test('rejects another CLI before authorizing', async () => {
  mocks.realpath
    .mockReturnValueOnce('/example/other/op')
    .mockReturnValueOnce('/example/supported/op')
  await expect(
    authorizeOnePasswordAccount('/example/supported/op', 'exampleaccount'),
  ).rejects.toThrow()
  expect(mocks.authorize).not.toHaveBeenCalled()
})

test('manual reference selection authorizes before returning an import candidate', async () => {
  mocks.choose.mockResolvedValue('reference')
  mocks.input
    .mockResolvedValueOnce('exampleaccount')
    .mockResolvedValueOnce('op://examplevault/exampleitem/password')
  expect(await chooseOnePasswordReference('/example/op')).toEqual({
    account: 'exampleaccount',
    reference: 'op://examplevault/exampleitem/password',
  })
  expect(mocks.authorize).toHaveBeenCalledTimes(1)
  expect(mocks.metadata).not.toHaveBeenCalled()
  expect(mocks.choose).toHaveBeenCalledWith(expect.any(Object), {
    output: process.stderr,
  })
  expect(mocks.input).toHaveBeenNthCalledWith(1, expect.any(Object), {
    output: process.stderr,
  })
  expect(mocks.input).toHaveBeenNthCalledWith(2, expect.any(Object), {
    output: process.stderr,
  })
})

test('guided authorization failures never offer a manual fallback', async () => {
  mocks.choose.mockResolvedValue('guided')
  mocks.authorize.mockResolvedValue({ status: 'authorization-failed' })
  mocks.metadata.mockImplementation(
    async (executable: string, prompts: OnePasswordPrompts) => {
      expect(executable).toBe('/example/op')
      await prompts.authorize('exampleaccount')
      throw new Error('unreachable')
    },
  )
  await expect(chooseOnePasswordReference('/example/op')).rejects.toThrow()
  expect(mocks.choose).toHaveBeenCalledTimes(1)
  expect(mocks.confirm).not.toHaveBeenCalled()
  expect(mocks.input).not.toHaveBeenCalled()
})

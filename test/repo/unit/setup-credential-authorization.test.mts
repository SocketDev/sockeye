import process from 'node:process'
import type { OnePasswordPrompts } from '../../../scripts/repo/one-password-metadata.mts'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  spawn: vi.fn(),
  authorize: vi.fn(),
  choose: vi.fn(),
  input: vi.fn(),
  confirm: vi.fn(),
  which: vi.fn(),
  realpath: vi.fn(),
  metadata: vi.fn(),
  readSaved: vi.fn(),
  writeSaved: vi.fn(),
}))
vi.mock(
  '../../../scripts/repo/setup-credential/references.mts',
  async original => ({
    ...(await original<
      typeof import('../../../scripts/repo/setup-credential/references.mts')
    >()),
    readSavedReference: mocks.readSaved,
    writeSavedReference: mocks.writeSaved,
  }),
)
vi.mock('node:fs/promises', async original => ({
  ...(await original<typeof import('node:fs/promises')>()),
  access: mocks.access,
}))
vi.mock('@socketsecurity/lib-stable/process/spawn/child', () => ({
  spawn: mocks.spawn,
}))
vi.mock('../../../scripts/repo/paths.mts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../scripts/repo/paths.mts')>()),
  getInstalledSockeyeBinaryPath: () => '/example/installed/sockeye',
}))
vi.mock('@socketsecurity/lib-stable/secrets/one-password', () => ({
  authorizeOnePasswordTerminal: mocks.authorize,
}))
vi.mock('../../../scripts/fleet/auth/one-password/request.mts', () => ({
  withOnePasswordRead: async (
    ...args: [string, readonly string[], () => unknown]
  ) => await args[2](),
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
  existsSync: () => true,
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
  setupCredential,
} from '../../../scripts/repo/setup-credential.mts'

const binding = 'a'.repeat(64)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readSaved.mockResolvedValue(undefined)
  mocks.writeSaved.mockResolvedValue(undefined)
  mocks.which.mockReturnValue('/example/op')
  mocks.realpath.mockReturnValue('/example/canonical/op')
  mocks.authorize.mockResolvedValue({ status: 'authorized' })
  mocks.spawn.mockImplementation(async (_binary, args) =>
    args[0] === 'capabilities'
      ? {
          code: 0,
          stdout:
            'sockeye-capabilities-v1\ncredential-bindings: sha256-64-lowercase-hex\ncredential-verify: attended-protected-readback-v1\ncredential-storage: keychain-biometry-current-set-device-only\n',
        }
      : { code: 0 },
  )
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

test('guided selection receives the requested credential name for ranking', async () => {
  mocks.choose.mockResolvedValue('guided')
  mocks.metadata.mockResolvedValue(undefined)
  await chooseOnePasswordReference('/example/op', {
    bindingId: binding,
    credentialName: 'EXAMPLE_API_TOKEN',
  })
  expect(mocks.metadata).toHaveBeenCalledWith(
    '/example/op',
    expect.any(Object),
    { credentialName: 'EXAMPLE_API_TOKEN' },
  )
})

async function withTerminal(run: () => Promise<void>): Promise<void> {
  const streams = [process.stdin, process.stdout]
  const descriptors = streams.map(stream =>
    Object.getOwnPropertyDescriptor(stream, 'isTTY'),
  )
  try {
    for (const stream of streams)
      Object.defineProperty(stream, 'isTTY', {
        configurable: true,
        value: true,
      })
    await run()
  } finally {
    for (const [index, stream] of streams.entries()) {
      const descriptor = descriptors[index]
      if (descriptor) Object.defineProperty(stream, 'isTTY', descriptor)
      else Reflect.deleteProperty(stream, 'isTTY')
    }
  }
}

test('required 1Password source refuses missing CLI without direct-entry fallback', async () => {
  mocks.access.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'ENOENT' }),
  )
  await withTerminal(async () => {
    await expect(
      setupCredential([
        'EXAMPLE_API_TOKEN',
        '--binding',
        binding,
        '--source',
        'one-password',
      ]),
    ).rejects.toThrow()
  })
  expect(mocks.choose).not.toHaveBeenCalled()
  expect(mocks.spawn).not.toHaveBeenCalled()
})

test.each([false, true])(
  'required 1Password source imports only after approval=%s',
  async approved => {
    mocks.access.mockResolvedValue(undefined)
    mocks.choose.mockResolvedValue('guided')
    mocks.metadata.mockResolvedValue({
      account: 'exampleaccount',
      reference: 'op://examplevault/exampleitem/password',
    })
    mocks.confirm.mockResolvedValue(approved)
    await withTerminal(async () => {
      expect(
        await setupCredential([
          'EXAMPLE_API_TOKEN',
          '--binding',
          binding,
          '--source',
          'one-password',
        ]),
      ).toBe(approved ? 0 : 130)
    })
    expect(mocks.choose).toHaveBeenCalledTimes(1)
    if (approved) {
      expect(mocks.spawn).toHaveBeenCalledWith(
        '/example/installed/sockeye',
        ['capabilities'],
        { stdio: 'pipe' },
      )
      expect(mocks.spawn).toHaveBeenCalledWith(
        '/example/installed/sockeye',
        [
          'import-1password',
          'EXAMPLE_API_TOKEN',
          'op://examplevault/exampleitem/password',
          '--binding',
          binding,
        ],
        expect.objectContaining({
          stdio: 'inherit',
          env: expect.objectContaining({ OP_ACCOUNT: 'exampleaccount' }),
        }),
      )
      expect(mocks.writeSaved).toHaveBeenCalledExactlyOnceWith(binding, {
        account: 'exampleaccount',
        reference: 'op://examplevault/exampleitem/password',
      })
    } else {
      expect(mocks.spawn).not.toHaveBeenCalled()
      expect(mocks.writeSaved).not.toHaveBeenCalled()
    }
  },
)

test('required 1Password source preserves canceled reference selection', async () => {
  mocks.access.mockResolvedValue(undefined)
  mocks.choose.mockResolvedValue('guided')
  mocks.metadata.mockResolvedValue(undefined)
  await withTerminal(async () => {
    expect(
      await setupCredential([
        'EXAMPLE_API_TOKEN',
        '--binding',
        binding,
        '--source',
        'one-password',
      ]),
    ).toBe(130)
  })
  expect(mocks.confirm).not.toHaveBeenCalled()
  expect(mocks.spawn).not.toHaveBeenCalled()
})

test('stops before import when the installed binary lacks binding support', async () => {
  mocks.access.mockResolvedValue(undefined)
  mocks.choose.mockResolvedValue('guided')
  mocks.metadata.mockResolvedValue({
    account: 'exampleaccount',
    reference: 'op://examplevault/exampleitem/password',
  })
  mocks.confirm.mockResolvedValue(true)
  mocks.spawn.mockResolvedValue({
    code: 0,
    stdout: 'sockeye-capabilities-v1\n',
  })
  await withTerminal(async () => {
    await expect(
      setupCredential([
        'EXAMPLE_API_TOKEN',
        '--binding',
        binding,
        '--source',
        'one-password',
      ]),
    ).rejects.toThrow('does not support protected credential bindings')
  })
  expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith(
    '/example/installed/sockeye',
    ['capabilities'],
    { stdio: 'pipe' },
  )
  expect(mocks.writeSaved).not.toHaveBeenCalled()
})

test('saved references still require explicit selection and account authorization', async () => {
  const selection = {
    account: 'exampleaccount',
    reference: 'op://examplevault/exampleitem/password',
  }
  mocks.readSaved.mockResolvedValue(selection)
  mocks.choose.mockResolvedValue('saved')
  expect(
    await chooseOnePasswordReference('/example/op', {
      bindingId: binding,
    }),
  ).toEqual(selection)
  expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith({
    account: 'exampleaccount',
  })
  expect(mocks.metadata).not.toHaveBeenCalled()
})

test('canceling saved reference selection does not authorize', async () => {
  mocks.readSaved.mockResolvedValue({
    account: 'exampleaccount',
    reference: 'op://examplevault/exampleitem/password',
  })
  mocks.choose.mockResolvedValue(undefined)
  expect(
    await chooseOnePasswordReference('/example/op', {
      bindingId: binding,
    }),
  ).toBeUndefined()
  expect(mocks.authorize).not.toHaveBeenCalled()
})

test('failed native import never saves reference metadata', async () => {
  mocks.access.mockResolvedValue(undefined)
  mocks.choose.mockResolvedValue('guided')
  mocks.metadata.mockResolvedValue({
    account: 'exampleaccount',
    reference: 'op://examplevault/exampleitem/password',
  })
  mocks.confirm.mockResolvedValue(true)
  mocks.spawn
    .mockResolvedValueOnce({
      code: 0,
      stdout:
        'sockeye-capabilities-v1\ncredential-bindings: sha256-64-lowercase-hex\ncredential-verify: attended-protected-readback-v1\ncredential-storage: keychain-biometry-current-set-device-only\n',
    })
    .mockResolvedValueOnce({ code: 1 })
  await withTerminal(async () => {
    await expect(
      setupCredential([
        'EXAMPLE_API_TOKEN',
        '--binding',
        binding,
        '--source',
        'one-password',
      ]),
    ).rejects.toThrow()
  })
  expect(mocks.writeSaved).not.toHaveBeenCalled()
})

test('declining a saved reference import authorizes its account but never mutates Keychain', async () => {
  mocks.access.mockResolvedValue(undefined)
  mocks.readSaved.mockResolvedValue({
    account: 'exampleaccount',
    reference: 'op://examplevault/exampleitem/password',
  })
  mocks.choose.mockResolvedValue('saved')
  mocks.confirm.mockResolvedValue(false)
  await withTerminal(async () => {
    expect(
      await setupCredential([
        'EXAMPLE_API_TOKEN',
        '--binding',
        binding,
        '--source',
        'one-password',
      ]),
    ).toBe(130)
  })
  expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith({
    account: 'exampleaccount',
  })
  expect(mocks.confirm).toHaveBeenCalledWith(
    expect.objectContaining({ default: false }),
    { output: process.stderr },
  )
  expect(mocks.spawn).not.toHaveBeenCalled()
  expect(mocks.writeSaved).not.toHaveBeenCalled()
})

test('rejects malformed selected metadata before confirmation or native import', async () => {
  mocks.access.mockResolvedValue(undefined)
  mocks.choose.mockResolvedValue('guided')
  mocks.metadata.mockResolvedValue({
    account: 'exampleaccount',
    reference: 'op://missing-field',
  })
  await withTerminal(async () => {
    await expect(
      setupCredential([
        'EXAMPLE_API_TOKEN',
        '--binding',
        binding,
        '--source',
        'one-password',
      ]),
    ).rejects.toThrow()
  })
  expect(mocks.confirm).not.toHaveBeenCalled()
  expect(mocks.spawn).not.toHaveBeenCalled()
  expect(mocks.writeSaved).not.toHaveBeenCalled()
})

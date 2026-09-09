import childProcess from 'node:child_process'
import { afterEach, expect, test, vi } from 'vitest'

import {
  onePasswordChoices,
  onePasswordEnvironment,
  onePasswordFieldReference,
  readOnePasswordMetadata,
  selectOnePasswordReference,
} from '../../../scripts/repo/one-password-metadata.mts'

const ACCOUNT = 'exampleaccount'
const VAULT = 'examplevault'
const ITEM = 'exampleitem'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

test('guides explicit account, vault, and item selection without reading secret fields', async () => {
  const read = vi.fn(async (executable: string, args: string[]) => {
    expect(executable).toBe('/example/op')
    if (args[0] === 'account')
      return [{ user_uuid: ACCOUNT, url: 'example.1password.com' }]
    if (args[0] === 'vault') return [{ id: VAULT, name: 'Example engineering' }]
    return [{ id: ITEM, title: 'Example release app' }]
  })
  const choose = vi.fn(
    async (message: string, choices: { value: string }[]) => {
      expect(message).toContain('1Password')
      return choices[0]!.value
    },
  )
  const selected = await selectOnePasswordReference(
    '/example/op',
    {
      authorize: async () => {},
      choose,
      field: async () => 'credentials/private key',
    },
    { read },
  )
  expect(selected).toEqual({
    account: ACCOUNT,
    reference: `op://${VAULT}/${ITEM}/credentials/private%20key`,
  })
  expect(read.mock.calls.map(call => call[1])).toEqual([
    ['account', 'list', '--format', 'json'],
    ['vault', 'list', '--account', ACCOUNT, '--format', 'json'],
    [
      'item',
      'list',
      '--account',
      ACCOUNT,
      '--vault',
      VAULT,
      '--format',
      'json',
    ],
  ])
  expect(choose).toHaveBeenCalledTimes(3)
})

test('cancellation and forged selections cannot expand scope', async () => {
  const read = vi.fn(async () => [
    { user_uuid: ACCOUNT, url: 'example.1password.com' },
  ])
  const field = vi.fn(async () => 'password')
  expect(
    await selectOnePasswordReference(
      '/example/op',
      {
        authorize: async () => {},
        choose: async () => 'unlisted-account',
        field,
      },
      { read },
    ),
  ).toBeUndefined()
  expect(read).toHaveBeenCalledTimes(1)
  expect(field).not.toHaveBeenCalled()
})

test('metadata parsing rejects terminal controls, malformed entries, and oversized lists', () => {
  for (const value of [
    null,
    {},
    [null],
    [{ id: ITEM, title: 'Example\nforged' }],
    [{ id: '../bad', title: 'Example' }],
    Array.from({ length: 10_001 }, () => ({})),
  ]) {
    expect(() => onePasswordChoices(value, 'item')).toThrow()
  }
  expect(
    onePasswordChoices(
      [
        {
          id: ITEM,
          title: 'Example',
          fields: [{ value: 'SANCTIONED_PLACEHOLDER' }],
        },
      ],
      'item',
    ),
  ).toEqual([{ name: `Example (${ITEM})`, value: ITEM }])
})

test('field references accept only one field and optional section', () => {
  expect(onePasswordFieldReference(VAULT, ITEM, 'password')).toBe(
    `op://${VAULT}/${ITEM}/password`,
  )
  for (const field of [
    '',
    '/password',
    'section/',
    'one/two/three',
    'value\n',
    'password?attribute=value',
    'password#fragment',
  ]) {
    expect(onePasswordFieldReference(VAULT, ITEM, field)).toBeUndefined()
  }
})

test('pins the chosen account without inherited service, connect, or session credentials', () => {
  vi.stubEnv('OP_ACCOUNT', 'different-account')
  vi.stubEnv('OP_SERVICE_ACCOUNT_TOKEN', 'SANCTIONED_PLACEHOLDER')
  vi.stubEnv('OP_CONNECT_TOKEN', 'SANCTIONED_PLACEHOLDER')
  vi.stubEnv('OP_CONNECT_HOST', 'https://example.invalid')
  vi.stubEnv('OP_SESSION_example', 'SANCTIONED_PLACEHOLDER')
  const env = onePasswordEnvironment({ account: ACCOUNT })
  expect(env['OP_ACCOUNT']).toBe(ACCOUNT)
  expect(env['OP_BIOMETRIC_UNLOCK_ENABLED']).toBe('true')
  expect(env['OP_SERVICE_ACCOUNT_TOKEN']).toBeUndefined()
  expect(env['OP_CONNECT_TOKEN']).toBeUndefined()
  expect(env['OP_CONNECT_HOST']).toBeUndefined()
  expect(env['OP_SESSION_example']).toBeUndefined()
  expect(onePasswordEnvironment()['OP_ACCOUNT']).toBeUndefined()
})

test('empty accounts fail and invalid fields cancel before native import', async () => {
  const prompts = {
    authorize: async () => {},
    choose: async (message: string, choices: { value: string }[]) => {
      expect(message).toContain('1Password')
      return choices[0]!.value
    },
    field: async () => 'invalid/extra/field',
  }
  await expect(
    selectOnePasswordReference('/example/op', prompts, {
      read: async () => [],
    }),
  ).rejects.toThrow()
  const metadata = async (executable: string, args: string[]) => {
    expect(executable).toBe('/example/op')
    return args[0] === 'account'
      ? [{ user_uuid: ACCOUNT, url: 'example.1password.com' }]
      : [{ id: ITEM, name: 'Example vault', title: 'Example item' }]
  }
  expect(
    await selectOnePasswordReference('/example/op', prompts, {
      read: metadata,
    }),
  ).toBeUndefined()
  expect(
    onePasswordFieldReference('../vault', ITEM, 'password'),
  ).toBeUndefined()
})

test('metadata transport refuses secret commands and arbitrary flags', async () => {
  const execute = vi.spyOn(childProcess, 'execFile')
  for (const args of [
    ['item', 'get', ITEM, '--format', 'json'],
    ['read', 'op://vault/item/password'],
    ['item', 'list', '--reveal', 'yes', '--format', 'json'],
    ['vault', 'list', '--account', '../account', '--format', 'json'],
  ]) {
    await expect(readOnePasswordMetadata('/example/op', args)).rejects.toThrow()
  }
  expect(execute).not.toHaveBeenCalled()
})

test.each([2, 3])(
  'cancels at guided step %i without asking for fields',
  async cancelledStep => {
    let step = 0
    const field = vi.fn(async () => 'password')
    const read = async () => [
      {
        user_uuid: ACCOUNT,
        url: 'example.1password.com',
        id: ITEM,
        name: 'Example vault',
        title: 'Example item',
      },
    ]
    const choose = async (message: string, choices: { value: string }[]) => {
      expect(message).toContain('1Password')
      step += 1
      return step === cancelledStep ? undefined : choices[0]!.value
    }
    expect(
      await selectOnePasswordReference(
        '/example/op',
        { authorize: async () => {}, choose, field },
        { read },
      ),
    ).toBeUndefined()
    expect(field).not.toHaveBeenCalled()
  },
)

test('metadata transport bounds output and discards subprocess diagnostics', async () => {
  let output = JSON.stringify([{ id: ITEM, title: 'Example item' }])
  let failure: Error | null = null
  const execute = vi.spyOn(childProcess, 'execFile').mockImplementation(((
    ...args: unknown[]
  ) => {
    const options = args[2] as {
      maxBuffer: number
      timeout: number
      env: NodeJS.ProcessEnv
    }
    expect(options.maxBuffer).toBe(1_048_576)
    expect(options.timeout).toBe(30_000)
    expect(options.env['OP_ACCOUNT']).toBeUndefined()
    const callback = args[3] as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void
    callback(failure, output, 'private diagnostic placeholder')
    return {} as ReturnType<typeof childProcess.execFile>
  }) as typeof childProcess.execFile)
  expect(
    await readOnePasswordMetadata('/example/op', [
      'item',
      'list',
      '--account',
      ACCOUNT,
      '--format',
      'json',
    ]),
  ).toEqual([{ id: ITEM, title: 'Example item' }])
  output = '{invalid json'
  await expect(
    readOnePasswordMetadata('/example/op', [
      'account',
      'list',
      '--format',
      'json',
    ]),
  ).rejects.toThrow()
  failure = new Error('Private subprocess details')
  await expect(
    readOnePasswordMetadata('/example/op', [
      'account',
      'list',
      '--format',
      'json',
    ]),
  ).rejects.toThrow()
  expect(execute).toHaveBeenCalledTimes(3)
})

test('authorizes the chosen account before reading vault metadata', async () => {
  const events: string[] = []
  await selectOnePasswordReference(
    '/example/op',
    {
      authorize: async account => {
        events.push(`authorize:${account}`)
      },
      choose: async (message, choices) => {
        expect(message).toContain('1Password')
        return choices[0]!.value
      },
      field: async () => 'password',
    },
    {
      read: async (executable, args) => {
        expect(executable).toBe('/example/op')
        events.push(args[0]!)
        return [
          {
            user_uuid: ACCOUNT,
            url: 'example.1password.com',
            id: ITEM,
            name: 'Example vault',
            title: 'Example item',
          },
        ]
      },
    },
  )
  expect(events).toEqual(['account', `authorize:${ACCOUNT}`, 'vault', 'item'])
})

test('authorization denial stops before vault, item, and field access', async () => {
  const denied = new Error('Authorization denied')
  const read = vi.fn(async () => [
    { user_uuid: ACCOUNT, url: 'example.1password.com' },
  ])
  const field = vi.fn(async () => 'password')
  await expect(
    selectOnePasswordReference(
      '/example/op',
      {
        authorize: async () => {
          throw denied
        },
        choose: async (message, choices) => {
          expect(message).toContain('1Password')
          return choices[0]!.value
        },
        field,
      },
      { read },
    ),
  ).rejects.toBe(denied)
  expect(read).toHaveBeenCalledTimes(1)
  expect(field).not.toHaveBeenCalled()
})

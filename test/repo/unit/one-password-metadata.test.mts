import childProcess from 'node:child_process'
import { afterEach, expect, test, vi } from 'vitest'

import {
  onePasswordChoices,
  onePasswordEnvironment,
  onePasswordFieldReference,
  readOnePasswordMetadata,
  searchOnePasswordChoices,
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
    reference: `op://${VAULT}/${ITEM}/credentials/private key`,
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
  expect(onePasswordFieldReference(VAULT, ITEM, 'Client ID')).toBe(
    `op://${VAULT}/${ITEM}/Client ID`,
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

test('ranks item labels by normalized exact, contained, and shared credential tokens', () => {
  const entries = [
    { id: 'unrelated', title: 'Deployment signing certificate' },
    { id: 'partial', title: 'Socket API legacy' },
    { id: 'contained', title: 'GitHub SOCKET_API_TOKEN_FOR_CLI_AND_SFW' },
    { id: 'exact', title: 'socket-api token for cli and sfw' },
    { id: 'reordered', title: 'SFW AND CLI FOR TOKEN API SOCKET' },
    { id: 'same-score', title: 'API Socket notes' },
    { id: 'unrelated-second', title: 'Release signing certificate' },
  ]
  const original = structuredClone(entries)
  const choices = onePasswordChoices(entries, 'item', {
    credentialName: 'SOCKET_API_TOKEN_FOR_CLI_AND_SFW',
  })
  expect(choices.map(choice => choice.value)).toEqual([
    'exact',
    'contained',
    'reordered',
    'partial',
    'same-score',
    'unrelated',
    'unrelated-second',
  ])
  expect(entries).toEqual(original)
  expect(choices.find(choice => choice.value === 'contained')?.name).toBe(
    'GitHub SOCKET_API_TOKEN_FOR_CLI_AND_SFW (contained)',
  )
})

test('ranking ignores IDs and preserves order without label matches or a usable target', () => {
  const entries = [
    { id: 'unrelated', title: 'Deployment' },
    { id: 'SOCKET_API_TOKEN', title: 'Release' },
  ]
  for (const credentialName of [undefined, '', '___', 'SOCKET_API_TOKEN']) {
    expect(
      onePasswordChoices(entries, 'item', { credentialName }).map(
        choice => choice.value,
      ),
    ).toEqual(['unrelated', 'SOCKET_API_TOKEN'])
  }
  const vaults = entries.map(entry => ({ id: entry.id, name: entry.title }))
  expect(
    onePasswordChoices(vaults, 'vault', { credentialName: 'Release' }).map(
      choice => choice.value,
    ),
  ).toEqual(['unrelated', 'SOCKET_API_TOKEN'])
})

test('guided selection ranks only item choices and retains explicit selection', async () => {
  const choose = vi.fn(
    async (message: string, choices: { value: string }[]) => {
      expect(message).toContain('1Password')
      return choices[0]!.value
    },
  )
  const read = vi.fn(async (executable: string, args: string[]) => {
    expect(executable).toBe('/example/op')
    if (args[0] === 'account')
      return [{ user_uuid: ACCOUNT, url: 'example.1password.com' }]
    if (args[0] === 'vault') return [{ id: VAULT, name: 'Example engineering' }]
    return [
      { id: 'unrelated-item', title: 'Deployment' },
      { id: ITEM, title: 'GitHub SOCKET_PR_APP_PRIVATE_KEY' },
    ]
  })
  const selected = await selectOnePasswordReference(
    '/example/op',
    {
      authorize: async () => {},
      choose,
      field: async () => 'credential',
    },
    { credentialName: 'SOCKET_PR_APP_PRIVATE_KEY', read },
  )
  expect(selected?.reference).toBe(`op://${VAULT}/${ITEM}/credential`)
  expect(choose.mock.calls[2]![1].map(choice => choice.value)).toEqual([
    ITEM,
    'unrelated-item',
  ])
  expect(choose).toHaveBeenCalledTimes(3)
})

test('filters item metadata by all query tokens and bounds results', () => {
  const choices = [
    { name: 'Example PR client', value: 'prclient' },
    { name: 'Example release client', value: 'releaseclient' },
  ]
  expect(searchOnePasswordChoices(choices, 'release_client')).toEqual([
    choices[1],
  ])
  expect(searchOnePasswordChoices(choices, 'unmatched')).toEqual([])
  expect(() => searchOnePasswordChoices(choices, 'bad\nquery')).toThrow()
  expect(() => searchOnePasswordChoices(choices, 'x'.repeat(513))).toThrow()
  expect(() =>
    searchOnePasswordChoices(
      Array.from({ length: 101 }, () => choices[0]!),
      '',
    ),
  ).toThrow()
})

test('searches only after selected account authorization and vault narrowing', async () => {
  const read = vi.fn(async (executable: string, args: string[]) => {
    expect(executable).toBe('/example/op')
    if (args[0] === 'account')
      return [{ user_uuid: ACCOUNT, url: 'example.1password.com' }]
    if (args[0] === 'vault') return [{ id: VAULT, name: 'Example vault' }]
    expect(args).toContain(ACCOUNT)
    expect(args).toContain(VAULT)
    return [
      { id: 'releaseitem', title: 'Release client' },
      { id: 'pritem', title: 'PR client' },
    ]
  })
  const search = vi.fn(async () => 'release')
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
      search,
      field: async () => 'client_id',
    },
    { read },
  )
  expect(selected).toEqual({
    account: ACCOUNT,
    reference: `op://${VAULT}/releaseitem/client_id`,
  })
  expect(choose.mock.calls[2]![1]).toHaveLength(1)
  expect(search).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledTimes(3)
})

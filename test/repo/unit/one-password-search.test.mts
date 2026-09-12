import { expect, test, vi } from 'vitest'
import {
  searchOnePasswordChoices,
  selectOnePasswordReference,
} from '../../../scripts/repo/one-password-metadata.mts'

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
      return [{ user_uuid: 'exampleaccount', url: 'example.1password.com' }]
    if (args[0] === 'vault')
      return [{ id: 'examplevault', name: 'Example vault' }]
    expect(args).toContain('exampleaccount')
    expect(args).toContain('examplevault')
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
    account: 'exampleaccount',
    reference: 'op://examplevault/releaseitem/client_id',
  })
  expect(choose.mock.calls[2]![1]).toHaveLength(1)
  expect(search).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledTimes(3)
})

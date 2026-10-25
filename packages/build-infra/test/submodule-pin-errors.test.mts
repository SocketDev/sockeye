import { beforeEach, expect, test, vi } from 'vitest'
import {
  getSubmoduleVersion,
  readSubmoduleEntry,
} from '../lib/submodule-version.mts'

const io = vi.hoisted(() => ({
  content: '',
  error: undefined as Error | undefined,
}))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    readFileSync: vi.fn((...args: Parameters<typeof actual.readFileSync>) => {
      if (String(args[0]).endsWith('.gitmodules')) {
        if (io.error) {
          throw io.error
        }
        return io.content
      }
      return actual.readFileSync(...args)
    }),
  }
})

beforeEach(() => {
  io.content =
    '[submodule "example"]\n  path = upstream/example\n  url = https://example.invalid/example.git\n'
  io.error = undefined
})

test('rejects a missing submodule block and a block without a release pin', () => {
  expect(() => readSubmoduleEntry('upstream/missing')).toThrow()
  expect(() => getSubmoduleVersion('upstream/example', 'example')).toThrow()
})

test('rejects a non-version branch pin', () => {
  io.content += '  branch = release-branch\n'
  expect(() => getSubmoduleVersion('upstream/example', 'example')).toThrow()
})

test.each(['ENOENT', 'EACCES'])(
  'retains the filesystem failure for %s',
  code => {
    const error = Object.assign(new Error('Fixture gitmodules failure'), {
      code,
    })
    io.error = error
    if (code === 'ENOENT') {
      expect(() => readSubmoduleEntry('upstream/example')).toThrow(
        expect.objectContaining({ cause: error }),
      )
    } else {
      expect(() => readSubmoduleEntry('upstream/example')).toThrow(error)
    }
  },
)

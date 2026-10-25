import { expect, test } from 'vitest'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { getEmsdkScriptPath, getPythonPrefixCandidates } from '../lib/paths.mts'
import { getEmsdkSearchPaths } from '../lib/constants.mts'
import { parseIsoDate } from '../lib/soak-policy.mts'

test('Windows SDK commands use the batch entrypoint', () => {
  expect(normalizePath(getEmsdkScriptPath('/example/sdk', 'win32'))).toBe(
    '/example/sdk/emsdk.bat',
  )
})

test('nonstandard pip directories do not invent sibling Python executables', () => {
  expect(
    getPythonPrefixCandidates('/example/scripts/python3/site-packages/pip'),
  ).toEqual([])
})

test('unsupported SDK search platforms use the Linux search locations', () => {
  expect(getEmsdkSearchPaths('freebsd')).toEqual(getEmsdkSearchPaths('linux'))
})

test('impossible ISO months cannot produce a soak deadline', () => {
  expect(parseIsoDate('2026-13-01')).toBeUndefined()
})

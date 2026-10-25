import { expect, test } from 'vitest'
import { getAvailableTools, getPlatformKey } from '../lib/vfs-tool-catalog.mts'
test('platform keys include both platform and architecture with host defaults', () => {
  expect(getPlatformKey()).toBe(`${process.platform}-${process.arch}`)
  expect(getPlatformKey('win32', 'arm64')).toBe('win32-arm64')
})
test('Windows offers embedded Python and unknown targets offer no downloads', () => {
  expect(getAvailableTools('win32', 'x64')).toContain('python')
  expect(getAvailableTools('linux', 'x64')).not.toContain('python')
  expect(getAvailableTools('freebsd', 'ppc64')).toEqual([])
  expect(getAvailableTools()).toEqual(
    getAvailableTools(process.platform, process.arch),
  )
})

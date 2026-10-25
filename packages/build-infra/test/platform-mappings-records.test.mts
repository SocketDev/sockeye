import { expect, test } from 'vitest'
import {
  parsePlatformArch,
  RELEASE_ARCH_MAP,
  RELEASE_PLATFORM_MAP,
} from '../lib/platform-mappings.mts'
test('release maps remain frozen null-prototype records', () => {
  for (const mapping of [RELEASE_ARCH_MAP, RELEASE_PLATFORM_MAP]) {
    expect(Object.getPrototypeOf(mapping)).toBeNull()
    expect(Object.isFrozen(mapping)).toBe(true)
    expect(mapping['toString']).toBeUndefined()
    expect(mapping['constructor']).toBeUndefined()
  }
  expect(RELEASE_ARCH_MAP['ia32']).toBe('x86')
  expect(RELEASE_PLATFORM_MAP['win32']).toBe('win32')
})
test('reverse asset maps resolve supported targets without inheriting object keys', () => {
  expect(parsePlatformArch('win32-x86')).toMatchObject({
    platform: 'win32',
    arch: 'ia32',
  })
  expect(() => parsePlatformArch('constructor-x64')).toThrow()
})

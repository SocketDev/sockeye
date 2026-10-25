import process from 'node:process'
import { afterEach, expect, test, vi } from 'vitest'
import { isCrossCompiling } from '../lib/builder.mts'
const descriptor = Object.getOwnPropertyDescriptor(process, 'arch')!
afterEach(() => {
  Object.defineProperty(process, 'arch', descriptor)
  vi.unstubAllEnvs()
})
test('x64 hosts distinguish native and ARM target architectures', () => {
  Object.defineProperty(process, 'arch', { configurable: true, value: 'x64' })
  vi.stubEnv('TARGET_ARCH', 'x64')
  expect(isCrossCompiling()).toBe(false)
  vi.stubEnv('TARGET_ARCH', 'aarch64')
  expect(isCrossCompiling()).toBe(true)
})

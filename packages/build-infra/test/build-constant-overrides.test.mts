import { afterEach, expect, test, vi } from 'vitest'
import { getBuildMode, getGccPath, getGxxPath } from '../lib/constants.mts'

afterEach(() => vi.unstubAllEnvs())

test('explicit array and set flags take precedence over build environment', () => {
  vi.stubEnv('BUILD_MODE', 'fixture-mode')
  expect(getBuildMode(['--prod', '--dev'])).toBe('prod')
  expect(getBuildMode(new Set(['--dev', '--prod']))).toBe('prod')
  expect(getBuildMode(['--dev'])).toBe('dev')
  expect(getBuildMode(new Set(['--dev']))).toBe('dev')
  expect(getBuildMode([])).toBe('fixture-mode')
  expect(getBuildMode(new Set())).toBe('fixture-mode')
})

test('versioned C and C++ compiler paths select the requested toolchain', () => {
  expect(getGccPath(13)).toBe('/usr/bin/gcc-13')
  expect(getGxxPath(14)).toBe('/usr/bin/g++-14')
})

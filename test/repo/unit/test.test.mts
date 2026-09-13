import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import {
  SCRIPT_META,
  ordinaryTestEnvironment,
} from '../../../scripts/repo/test.mts'

const entry = fileURLToPath(
  new URL('../../../scripts/repo/test.mts', import.meta.url),
)

test('requires host admission before preparing native tests', () => {
  expect(SCRIPT_META.heavyJob).toBe('test')
})

test('ordinary test children cannot inherit attended selection', () => {
  const environment = { SOCKEYE_INTERACTIVE_TESTS: '1', BUILD_MODE: 'asan' }
  expect(ordinaryTestEnvironment(environment)).toEqual({ BUILD_MODE: 'asan' })
  expect(environment.SOCKEYE_INTERACTIVE_TESTS).toBe('1')
})

for (const flag of ['--help', '--describe']) {
  test(`answers ${flag} without filesystem writes or child processes`, () => {
    const result = spawnSync(
      process.execPath,
      ['--permission', '--allow-fs-read=*', entry, flag],
      { encoding: 'utf8', timeout: 5000 },
    )
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(
      flag === '--help'
        ? `${SCRIPT_META.describe}\n\n${SCRIPT_META.help}`
        : SCRIPT_META.describe,
    )
  })
}

import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { SCRIPT_META } from '../../../scripts/repo/build.mts'
import { SCRIPT_META as ADDON_SCRIPT_META } from '../../../packages/keychain-addon-builder/scripts/build.mts'

const entries = [
  {
    name: 'sockeye',
    relative: '../../../scripts/repo/build.mts',
    meta: SCRIPT_META,
  },
  {
    name: 'addon',
    relative: '../../../packages/keychain-addon-builder/scripts/build.mts',
    meta: ADDON_SCRIPT_META,
  },
]

for (const { name, relative, meta } of entries) {
  const entry = fileURLToPath(new URL(relative, import.meta.url))
  for (const flag of ['--help', '--describe']) {
    test(`${name} answers ${flag} without filesystem writes or child processes`, () => {
      const result = spawnSync(
        process.execPath,
        ['--permission', '--allow-fs-read=*', entry, flag],
        { encoding: 'utf8', timeout: 5000 },
      )
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status).toBe(0)
      expect(result.stdout.trim()).toBe(
        flag === '--help' ? `${meta.describe}\n\n${meta.help}` : meta.describe,
      )
    })
  }
}

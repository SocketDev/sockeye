import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { expect, test } from 'vitest'

import { isStapleable, SCRIPT_META } from '../../../scripts/repo/notarize.mts'

test('describes the entrypoint before processing release targets', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--permission',
      '--allow-fs-read=*',
      fileURLToPath(
        new URL('../../../scripts/repo/notarize.mts', import.meta.url),
      ),
      '--describe',
      '--json',
      '--run',
      'missing-example-archive.zip',
    ],
    { encoding: 'utf8', timeout: 5000 },
  )
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout ?? '')).toMatchObject({
    description: SCRIPT_META.describe,
    name: 'notarize.mts',
  })
  expect(result.stderr).toBe('')
})

test('staples supported archive types and excludes zip tickets', () => {
  expect(isStapleable('example.DMG')).toBe(true)
  expect(isStapleable('example.pkg')).toBe(true)
  expect(isStapleable('example.zip')).toBe(false)
  expect(isStapleable('example-binary')).toBe(false)
})

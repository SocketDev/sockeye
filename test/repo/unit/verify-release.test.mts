import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { expect, test } from 'vitest'

import {
  renderEvidenceTable,
  SCRIPT_META,
} from '../../../scripts/repo/verify-release.mts'

test('describes the entrypoint before processing release targets', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--permission',
      '--allow-fs-read=*',
      fileURLToPath(
        new URL('../../../scripts/repo/verify-release.mts', import.meta.url),
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
    name: 'verify-release.mts',
  })
  expect(result.stderr).toBe('')
})

test('renders release evidence as a padded markdown table', () => {
  expect(
    renderEvidenceTable([{ item: 'SHA-256', evidence: 'example-digest' }]),
  ).toBe(
    '| Item    | Evidence |\n| ------- | -------- |\n| SHA-256 | example-digest |',
  )
})

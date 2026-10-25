import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { expect, test } from 'vitest'

import { getBuildRequirementsPath } from '../lib/build-requirements/paths.mts'

const VERSION_READER_PATH = fileURLToPath(
  new URL('../scripts/get-tool-version.mts', import.meta.url),
)

test('reads a builder version before installation from the canonical requirements path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sockeye-version-reader-'))
  try {
    await writeFile(
      getBuildRequirementsPath(root),
      JSON.stringify({ tools: { cmake: { version: '3.30.0' } } }),
    )
    const result = spawnSync(
      process.execPath,
      [VERSION_READER_PATH, 'cmake', '--package-root', root],
      { encoding: 'utf8', timeout: 5000 },
    )
    expect(result.status).toBe(0)
    expect(result.stdout?.trim()).toBe('3.30.0')
    expect(result.stderr).toBe('')
  } finally {
    await safeDelete(root)
  }
})

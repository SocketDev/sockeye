import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))

vi.mock(
  '@socketsecurity/lib-stable/process/spawn/child',
  async importOriginal => ({
    ...(await importOriginal<
      typeof import('@socketsecurity/lib-stable/process/spawn/child')
    >()),
    spawn: mocks.spawn,
  }),
)

import {
  SCRIPT_META,
  runGh,
  selectSigningWorkflowRun,
} from '../../../scripts/repo/signing-workflow.mts'

test('selects only the run for the exact source revision', () => {
  const sha = 'a'.repeat(40)
  expect(
    selectSigningWorkflowRun(
      [
        {
          databaseId: 1,
          headSha: 'b'.repeat(40),
          status: 'queued',
          url: 'https://example.invalid/1',
        },
        {
          databaseId: 2,
          headSha: sha,
          status: 'queued',
          url: 'https://example.invalid/2',
        },
      ],
      sha,
      { minimumRunId: 1 },
    ),
  ).toEqual({
    databaseId: 2,
    headSha: sha,
    status: 'queued',
    url: 'https://example.invalid/2',
  })
  expect(selectSigningWorkflowRun([], sha)).toBeUndefined()
  expect(
    selectSigningWorkflowRun(
      [
        {
          databaseId: 2,
          headSha: sha,
          status: 'completed',
          url: 'https://example.invalid/old',
        },
      ],
      sha,
      { minimumRunId: 2 },
    ),
  ).toBeUndefined()
})

test('routes GitHub workflow access through pnpm gh', async () => {
  mocks.spawn.mockResolvedValue({ code: 0, stdout: '{}', stderr: '' })
  await expect(runGh(['repo', 'view'])).resolves.toBe('{}')
  expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith(
    'pnpm',
    ['gh', 'repo', 'view'],
    expect.objectContaining({ stdio: 'pipe' }),
  )
})

test('describes the entrypoint before GitHub access', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--permission',
      '--allow-fs-read=*',
      fileURLToPath(
        new URL('../../../scripts/repo/signing-workflow.mts', import.meta.url),
      ),
      '--describe',
      '--json',
      '--run',
    ],
    { encoding: 'utf8', timeout: 5000 },
  )
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout ?? '')).toMatchObject({
    description: SCRIPT_META.describe,
    name: 'signing-workflow.mts',
  })
  expect(result.stderr).toBe('')
})

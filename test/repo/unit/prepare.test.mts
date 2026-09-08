import { expect, test } from 'vitest'

import {
  ensureWorkspacePackages,
  isAppliedRefCurrentOrNewer,
} from '../../../scripts/repo/bootstrap/prepare.mts'

test('inserts missing workspace packages without changing existing settings', () => {
  const source = "packages:\n  - 'packages/*'\n\ncatalog:\n  example: 1.0.0\n"
  const required = ['packages/*', '.claude/hooks/fleet/*']
  const result = ensureWorkspacePackages(source, required)
  expect(result).toBe(
    "packages:\n  - 'packages/*'\n  - '.claude/hooks/fleet/*'\n\ncatalog:\n  example: 1.0.0\n",
  )
  expect(ensureWorkspacePackages(result, required)).toBe(result)
})

test('creates the workspace block when it is absent', () => {
  expect(ensureWorkspacePackages('catalog: {}\n', ['packages/*'])).toBe(
    "packages:\n  - 'packages/*'\n\ncatalog: {}\n",
  )
})

test('recognizes the applied pin and rejects absent or malformed refs', () => {
  expect(isAppliedRefCurrentOrNewer('example-ref', 'example-ref')).toBe(true)
  expect(isAppliedRefCurrentOrNewer(undefined, 'example-ref')).toBe(false)
  expect(isAppliedRefCurrentOrNewer('example-ref', undefined)).toBe(false)
  expect(isAppliedRefCurrentOrNewer('example-ref', 'different-ref')).toBe(false)
})

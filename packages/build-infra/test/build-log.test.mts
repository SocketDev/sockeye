import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  clearBuildLog,
  getBuildLogPath,
  getLastLogLines,
  readCheckpoint,
  saveBuildLog,
} from '../lib/build-log.mts'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'sockeye-build-log-'))
})
afterEach(async () => {
  await safeDelete(root)
})

test('build log appends independent entries and truncates on a fresh build', async () => {
  await saveBuildLog(root, 'first stage')
  await saveBuildLog(root, 'second stage')
  expect(await readFile(getBuildLogPath(root), 'utf8')).toBe(
    'first stage\nsecond stage\n',
  )
  await clearBuildLog(root)
  expect(await readFile(getBuildLogPath(root), 'utf8')).toBe('')
})
test('tail normalizes Windows newlines and respects the requested line count', async () => {
  await writeFile(getBuildLogPath(root), 'first\r\nsecond\r\nthird')
  expect(await getLastLogLines(root, 2)).toBe('second\nthird')
  expect(await getLastLogLines(root)).toBe('first\nsecond\nthird')
})
test('missing log directories do not turn logging into a build failure', async () => {
  const missing = path.join(root, 'absent')
  await expect(saveBuildLog(missing, 'entry')).resolves.toBeUndefined()
  await expect(clearBuildLog(missing)).resolves.toBeUndefined()
  expect(await getLastLogLines(missing)).toBeUndefined()
})
test('checkpoint reads distinguish valid JSON, missing files and corrupt bytes', async () => {
  expect(await readCheckpoint(root)).toBeUndefined()
  const file = path.join(root, 'build-checkpoint')
  await writeFile(file, '{')
  expect(await readCheckpoint(root)).toBeUndefined()
  await writeFile(file, JSON.stringify({ stage: 'compiled', size: 42 }))
  expect(await readCheckpoint(root)).toEqual({ stage: 'compiled', size: 42 })
})

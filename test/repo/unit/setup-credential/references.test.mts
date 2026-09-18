import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

import {
  readSavedReference,
  validateSavedReference,
  writeSavedReference,
} from '../../../../scripts/repo/setup-credential/references.mts'

const directories: string[] = []
const selection = {
  account: 'exampleaccount',
  reference: 'op://examplevault/exampleitem/password',
}
const binding = 'a'.repeat(64)

async function fixture(): Promise<string> {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'sockeye-references-')),
  )
  directories.push(directory)
  return directory
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    directories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true })),
  )
})

test('stores only validated account and reference with private permissions', async () => {
  const directory = await fixture()
  const options = { directory }
  expect(await readSavedReference(binding, options)).toBeUndefined()
  await writeSavedReference(binding, selection, options)
  expect(await readSavedReference(binding, options)).toEqual(selection)
  const file = path.join(directory, `${binding}.json`)
  expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(selection)
  await writeSavedReference(
    binding,
    { ...selection, reference: 'op://examplevault/otheritem/field' },
    options,
  )
  expect((await readSavedReference(binding, options))?.reference).toBe(
    'op://examplevault/otheritem/field',
  )
  expect(await fs.readdir(directory)).toEqual([`${binding}.json`])
})

test('rejects unknown fields and invalid identifiers before writing', async () => {
  const directory = await fixture()
  expect(() =>
    validateSavedReference({ ...selection, value: 'FAKE_SECRET_VALUE' }),
  ).toThrow()
  expect(() =>
    validateSavedReference({ ...selection, account: 'bad\naccount' }),
  ).toThrow()
  expect(() =>
    validateSavedReference({ ...selection, reference: 'op://missing-field' }),
  ).toThrow()
  await expect(
    writeSavedReference('../ESCAPE', selection, { directory }),
  ).rejects.toThrow()
  expect(await fs.readdir(directory)).toEqual([])
})

test('rejects symlink files and directories without touching their targets', async () => {
  const directory = await fixture()
  const target = path.join(directory, 'target.json')
  await fs.writeFile(target, JSON.stringify(selection), { mode: 0o600 })
  await fs.symlink(target, path.join(directory, `${binding}.json`))
  await expect(readSavedReference(binding, { directory })).rejects.toThrow()
  await expect(
    writeSavedReference(binding, selection, { directory }),
  ).rejects.toThrow()
  const alias = path.join(directory, 'alias')
  await fs.symlink(directory, alias)
  await expect(
    readSavedReference(binding, { directory: alias }),
  ).rejects.toThrow()
  expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual(selection)
})

test('rejects oversized, public, and malformed saved metadata', async () => {
  const directory = await fixture()
  const file = path.join(directory, `${binding}.json`)
  await fs.writeFile(file, ' '.repeat(4097), { mode: 0o600 })
  await expect(readSavedReference(binding, { directory })).rejects.toThrow()
  await fs.writeFile(file, '{}')
  await expect(readSavedReference(binding, { directory })).rejects.toThrow()
  await fs.writeFile(file, JSON.stringify(selection))
  await fs.chmod(file, 0o644)
  await expect(readSavedReference(binding, { directory })).rejects.toThrow()
  await fs.chmod(directory, 0o755)
  await expect(
    writeSavedReference(binding, selection, { directory }),
  ).rejects.toThrow()
})

test('rejects hardlinked metadata and preserves both links', async () => {
  const directory = await fixture()
  const target = path.join(directory, 'target.json')
  const file = path.join(directory, `${binding}.json`)
  await fs.writeFile(target, JSON.stringify(selection), { mode: 0o600 })
  await fs.link(target, file)
  await expect(readSavedReference(binding, { directory })).rejects.toThrow()
  await expect(
    writeSavedReference(binding, selection, { directory }),
  ).rejects.toThrow()
  expect((await fs.stat(target)).nlink).toBe(2)
})

test('a failed replacement preserves saved metadata and removes its temporary file', async () => {
  const directory = await fixture()
  await writeSavedReference(binding, selection, { directory })
  vi.spyOn(fs, 'rename').mockRejectedValueOnce(
    Object.assign(new Error('rename failed'), { code: 'EACCES' }),
  )
  await expect(
    writeSavedReference(
      binding,
      { ...selection, account: 'otheraccount' },
      { directory },
    ),
  ).rejects.toThrow()
  expect(await readSavedReference(binding, { directory })).toEqual(selection)
  expect(await fs.readdir(directory)).toEqual([`${binding}.json`])
})

test('an exclusive temporary-file collision preserves the existing file', async () => {
  const directory = await fixture()
  const identifier = '00000000-0000-4000-8000-000000000000'
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(identifier)
  const file = path.join(directory, `.${binding}.${identifier}.tmp`)
  await fs.writeFile(file, 'unrelated fixture', { mode: 0o600 })
  await expect(
    writeSavedReference(binding, selection, { directory }),
  ).rejects.toThrow()
  expect(await fs.readFile(file, 'utf8')).toBe('unrelated fixture')
})

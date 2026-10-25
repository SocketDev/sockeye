import crypto from 'node:crypto'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { getSocketAppStateDir } from '@socketsecurity/lib-stable/paths/socket'

import {
  isCredentialBindingId,
  isOnePasswordReference,
} from '../setup-credential-contract.mts'
import type { OnePasswordSelection } from '../one-password-metadata.mts'

const MAX_REFERENCE_BYTES = 4096

function referenceFile(bindingId: string, directory: string): string {
  if (!isCredentialBindingId(bindingId)) {
    throw new Error('Saved reference requires an opaque credential binding ID.')
  }
  return path.join(directory, `${bindingId}.json`)
}

export function validateSavedReference(value: unknown): OnePasswordSelection {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Saved 1Password reference has an invalid schema.')
  }
  const account = Reflect.get(value, 'account')
  const reference = Reflect.get(value, 'reference')
  if (
    Object.keys(value).length !== 2 ||
    typeof account !== 'string' ||
    !/^[a-zA-Z0-9.-]{1,512}$/u.test(account) ||
    typeof reference !== 'string' ||
    !isOnePasswordReference(reference) ||
    !/^op:\/\/[^/]+\/[^/]+\/[^/]+(?:\/[^/]+)?$/u.test(reference)
  ) {
    throw new Error(
      'Saved 1Password reference has invalid account or field metadata.',
    )
  }
  return { account, reference }
}

function referenceDirectory(directory?: string | undefined): string {
  return directory ?? path.join(getSocketAppStateDir('sockeye'), 'one-password')
}

async function assertReferenceDirectory(directory: string): Promise<void> {
  // oxlint-disable-next-line socket/prefer-exists-sync -- Metadata.
  const stat = await fs.lstat(directory)
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  ) {
    throw new Error(
      'Saved reference directory must be private and owned by the current user.',
    )
  }
  if ((await fs.realpath(directory)) !== path.resolve(directory)) {
    throw new Error(
      'Saved reference directory must not pass through symbolic links.',
    )
  }
}

export async function readSavedReference(
  bindingId: string,
  options: { directory?: string | undefined } = {},
): Promise<OnePasswordSelection | undefined> {
  const directory = referenceDirectory(options.directory)
  const file = referenceFile(bindingId, directory)
  try {
    await assertReferenceDirectory(directory)
    const handle = await fs.open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      // oxlint-disable-next-line socket/prefer-exists-sync -- Metadata.
      const stat = await handle.stat()
      if (
        !stat.isFile() ||
        stat.size > MAX_REFERENCE_BYTES ||
        stat.nlink !== 1 ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())
      ) {
        throw new Error(
          'Saved reference must be a private regular file of at most 4096 bytes.',
        )
      }
      const buffer = Buffer.alloc(MAX_REFERENCE_BYTES + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      if (bytesRead > MAX_REFERENCE_BYTES) {
        throw new Error('Saved reference exceeds its size limit.')
      }
      return validateSavedReference(
        JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')),
      )
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      Reflect.get(error, 'code') === 'ENOENT'
    ) {
      return undefined
    }
    throw new Error(
      'Saved 1Password reference cannot be read safely. Repair its private metadata file before retrying.',
    )
  }
}

export async function writeSavedReference(
  bindingId: string,
  selection: OnePasswordSelection,
  options: { directory?: string | undefined } = {},
): Promise<void> {
  const directory = referenceDirectory(options.directory)
  const file = referenceFile(bindingId, directory)
  const contents = JSON.stringify(validateSavedReference(selection))
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  await assertReferenceDirectory(directory)
  await readSavedReference(bindingId, { directory })
  const temporary = path.join(
    directory,
    `.${bindingId}.${crypto.randomUUID()}.tmp`,
  )
  let created = false
  try {
    const handle = await fs.open(temporary, 'wx', 0o600)
    created = true
    try {
      await handle.writeFile(contents)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(temporary, file)
  } finally {
    if (created) {
      await removeReferenceTemporary(temporary)
    }
  }
}

async function removeReferenceTemporary(temporary: string): Promise<void> {
  try {
    // oxlint-disable-next-line socket/prefer-safe-delete -- Owned file.
    await fs.unlink(temporary)
  } catch (error) {
    if (
      error === null ||
      typeof error !== 'object' ||
      Reflect.get(error, 'code') !== 'ENOENT'
    ) {
      throw error
    }
  }
}

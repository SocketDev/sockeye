import crypto from 'node:crypto'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

export async function decodeReleaseProfileCms(
  profile: string,
  keychain: string,
): Promise<string> {
  const password = crypto.randomBytes(32).toString('hex')
  const created = await spawn('/usr/bin/security', [
    'create-keychain',
    '-p',
    password,
    keychain,
  ])
  if (created.code !== 0) {
    throw new Error(
      `Provisioning profile inspection failed for ${path.basename(profile)}; security could not create its temporary keychain. Check the macOS keychain service and retry.`,
    )
  }

  let decodedText: string | undefined
  let operationFailed = false
  try {
    const unlocked = await spawn('/usr/bin/security', [
      'unlock-keychain',
      '-p',
      password,
      keychain,
    ])
    const decoded =
      unlocked.code === 0
        ? await spawn('/usr/bin/security', [
            'cms',
            '-D',
            '-k',
            keychain,
            '-i',
            profile,
          ])
        : undefined
    decodedText = decoded?.code === 0 ? decoded.stdout : undefined
    operationFailed = !decodedText
  } catch {
    operationFailed = true
  }

  let cleanupFailed = false
  try {
    const deleted = await spawn('/usr/bin/security', [
      'delete-keychain',
      keychain,
    ])
    cleanupFailed = deleted.code !== 0
  } catch {
    cleanupFailed = true
  }
  if (cleanupFailed) {
    throw new Error(
      `Provisioning profile cleanup failed at ${path.basename(keychain)}; security retained the temporary keychain. Delete it before retrying.`,
    )
  }
  if (operationFailed || decodedText === undefined) {
    throw new Error(
      `Provisioning profile decoding failed for ${path.basename(profile)}; security rejected the CMS data. Supply an Apple-issued Developer ID provisioning profile.`,
    )
  }
  return decodedText
}

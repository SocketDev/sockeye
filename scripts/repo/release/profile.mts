import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

export async function decodeReleaseProfileCms(
  profile: string,
): Promise<string> {
  let decoded: Awaited<ReturnType<typeof spawn>> | undefined
  try {
    decoded = await spawn('/usr/bin/openssl', [
      'smime',
      '-verify',
      '-inform',
      'der',
      '-in',
      path.resolve(profile),
      '-noverify',
    ])
  } catch {
    decoded = undefined
  }
  const decodedText =
    typeof decoded?.stdout === 'string'
      ? decoded.stdout
      : decoded?.stdout.toString('utf8')
  if (decoded?.code !== 0 || !decodedText) {
    throw new Error(
      `Provisioning profile decoding failed for ${path.basename(profile)}; CMS verification rejected the signed payload. Supply an Apple-issued Developer ID provisioning profile.`,
    )
  }
  return decodedText
}

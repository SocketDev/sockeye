import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

export const RELEASE_BUNDLE_NAME = 'sockeye.app'
export const RELEASE_IDENTIFIER = 'dev.socket.sockeye'
export const RELEASE_TEAM_IDENTIFIER = 'PZRCDQ736X'
export const RELEASE_APPLICATION_IDENTIFIER = `${RELEASE_TEAM_IDENTIFIER}.${RELEASE_IDENTIFIER}`

export function releaseBundlePath(binary: string): string {
  return path.join(path.dirname(binary), RELEASE_BUNDLE_NAME)
}

export function releaseBundlePaths(bundle: string) {
  const contents = path.join(bundle, 'Contents')
  return {
    __proto__: null,
    binary: path.join(contents, 'MacOS', 'sockeye'),
    contents,
    info: path.join(contents, 'Info.plist'),
    profile: path.join(contents, 'embedded.provisionprofile'),
  }
}

export function validateReleaseProfile(
  profile: unknown,
  options: { now?: number | undefined } = {},
): void {
  const now = options.now ?? Date.now()
  if (!isPlainObject(profile) || !isPlainObject(profile['Entitlements'])) {
    throw new Error(
      'Invalid provisioning profile; expected decoded profile entitlements. Supply a Developer ID profile.',
    )
  }
  const entitlements = profile['Entitlements']
  if (
    entitlements['com.apple.application-identifier'] !==
      RELEASE_APPLICATION_IDENTIFIER ||
    entitlements['com.apple.developer.team-identifier'] !==
      RELEASE_TEAM_IDENTIFIER ||
    entitlements['get-task-allow'] === true ||
    profile['ProvisionsAllDevices'] !== true ||
    typeof profile['ExpirationDate'] !== 'string' ||
    !(Date.parse(profile['ExpirationDate']) > now)
  ) {
    throw new Error(
      'Provisioning profile rejected; expected an unexpired Developer ID profile for Sockeye with debugging disabled. Regenerate the matching profile.',
    )
  }
}

export async function readReleaseProfile(profile: string): Promise<unknown> {
  const decoded = await spawn('/usr/bin/security', ['cms', '-D', '-i', profile])
  if (decoded.code !== 0 || !decoded.stdout) {
    throw new Error(
      'Provisioning profile decoding failed; supply an Apple-issued Developer ID provisioning profile.',
    )
  }
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'sockeye-profile-'))
  try {
    const plist = path.join(scratch, 'profile.plist')
    await fs.writeFile(plist, decoded.stdout, { mode: 0o600 })
    async function field(key: string, format: string): Promise<string> {
      const converted = await spawn('/usr/bin/plutil', [
        '-extract',
        key,
        format,
        '-o',
        '-',
        plist,
      ])
      if (converted.code !== 0 || !converted.stdout) {
        throw new Error(
          `Provisioning profile field ${key} is missing or invalid. Supply a Developer ID profile.`,
        )
      }
      return converted.stdout.trim()
    }
    const entitlements: unknown = JSON.parse(
      await field('Entitlements', 'json'),
    )
    return {
      Entitlements: entitlements,
      ExpirationDate: await field('ExpirationDate', 'raw'),
      ProvisionsAllDevices:
        (await field('ProvisionsAllDevices', 'raw')) === 'true',
    }
  } finally {
    await safeDelete(scratch)
  }
}

export function releaseInfoPlist(version: string): string {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(
      'Invalid bundle version; expected the package release version.',
    )
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>CFBundleIdentifier</key><string>${RELEASE_IDENTIFIER}</string>\n<key>CFBundleExecutable</key><string>sockeye</string>\n<key>CFBundlePackageType</key><string>APPL</string>\n<key>CFBundleVersion</key><string>${version}</string>\n<key>CFBundleShortVersionString</key><string>${version}</string>\n<key>LSUIElement</key><true/>\n</dict></plist>\n`
}

export async function prepareReleaseBundle(
  binary: string,
  profile: string,
  version: string,
): Promise<string> {
  validateReleaseProfile(await readReleaseProfile(profile))
  const bundle = releaseBundlePath(binary)
  const scratch = await fs.mkdtemp(
    path.join(path.dirname(binary), '.sockeye-bundle-'),
  )
  try {
    const staged = path.join(scratch, RELEASE_BUNDLE_NAME)
    const files = releaseBundlePaths(staged)
    await fs.mkdir(path.dirname(files.binary), { recursive: true })
    await fs.copyFile(binary, files.binary)
    await fs.chmod(files.binary, 0o755)
    await fs.copyFile(profile, files.profile)
    await fs.writeFile(files.info, releaseInfoPlist(version))
    await safeDelete(bundle)
    await fs.rename(staged, bundle)
    return bundle
  } finally {
    await safeDelete(scratch)
  }
}

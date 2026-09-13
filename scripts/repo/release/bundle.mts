import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

export const RELEASE_DISPLAY_NAME = 'Sockeye'
export const RELEASE_EXECUTABLE_NAME = 'sockeye'
export const RELEASE_BUNDLE_NAME = `${RELEASE_EXECUTABLE_NAME}.app`
export const RELEASE_IDENTIFIER = 'dev.socket.sockeye'
export const RELEASE_TEAM_IDENTIFIER = 'PZRCDQ736X'
export const RELEASE_SIGNING_IDENTITY = `Developer ID Application: Socket Inc. (${RELEASE_TEAM_IDENTIFIER})`
export const RELEASE_DESIGNATED_REQUIREMENT = `=anchor apple generic and identifier "${RELEASE_IDENTIFIER}" and certificate leaf[subject.OU] = "${RELEASE_TEAM_IDENTIFIER}" and certificate leaf[subject.CN] = "${RELEASE_SIGNING_IDENTITY}"`
export const RELEASE_APPLICATION_IDENTIFIER = `${RELEASE_TEAM_IDENTIFIER}.${RELEASE_IDENTIFIER}`
export const RELEASE_PROFILE_APPLICATION_IDENTIFIERS = [
  RELEASE_APPLICATION_IDENTIFIER,
  `${RELEASE_TEAM_IDENTIFIER}.dev.socket.*`,
] as const
export const RELEASE_BUNDLE_ENTRIES = [
  RELEASE_BUNDLE_NAME,
  `${RELEASE_BUNDLE_NAME}/Contents`,
  `${RELEASE_BUNDLE_NAME}/Contents/Info.plist`,
  `${RELEASE_BUNDLE_NAME}/Contents/MacOS`,
  `${RELEASE_BUNDLE_NAME}/Contents/MacOS/${RELEASE_EXECUTABLE_NAME}`,
  `${RELEASE_BUNDLE_NAME}/Contents/embedded.provisionprofile`,
] as const

export function releaseBundlePath(binary: string): string {
  return path.join(path.dirname(binary), RELEASE_BUNDLE_NAME)
}

export function releaseBundlePaths(bundle: string) {
  const contents = path.join(bundle, 'Contents')
  return {
    __proto__: null,
    binary: path.join(contents, 'MacOS', RELEASE_EXECUTABLE_NAME),
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
    !RELEASE_PROFILE_APPLICATION_IDENTIFIERS.some(
      identifier =>
        identifier === entitlements['com.apple.application-identifier'],
    ) ||
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
  let decoded: Awaited<ReturnType<typeof spawn>>
  try {
    decoded = await spawn('/usr/bin/security', ['cms', '-D', '-i', profile])
  } catch {
    throw new Error(
      'Provisioning profile decoding failed; supply an Apple-issued Developer ID provisioning profile.',
    )
  }
  if (!decoded.stdout) {
    throw new Error(
      'Provisioning profile decoding failed; supply an Apple-issued Developer ID provisioning profile.',
    )
  }
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'sockeye-profile-'))
  try {
    const plist = path.join(scratch, 'profile.plist')
    await fs.writeFile(plist, decoded.stdout, { mode: 0o600 })
    async function field(
      key: string,
      options: { required?: boolean | undefined } = {},
    ): Promise<string | undefined> {
      let converted: Awaited<ReturnType<typeof spawn>>
      try {
        converted = await spawn('/usr/bin/plutil', [
          '-extract',
          key,
          'raw',
          '-o',
          '-',
          plist,
        ])
      } catch {
        if (options.required === false) {
          return undefined
        }
        throw new Error(
          `Provisioning profile field ${key} is missing or invalid. Supply a Developer ID profile.`,
        )
      }
      if (!converted.stdout) {
        if (options.required === false) {
          return undefined
        }
        throw new Error(
          `Provisioning profile field ${key} is missing or invalid. Supply a Developer ID profile.`,
        )
      }
      return converted.stdout.toString().trim()
    }
    const applicationIdentifier = await field(
      'Entitlements.com\\.apple\\.application-identifier',
    )
    const teamIdentifier = await field(
      'Entitlements.com\\.apple\\.developer\\.team-identifier',
    )
    const getTaskAllow = await field('Entitlements.get-task-allow', {
      required: false,
    })
    return {
      Entitlements: {
        'com.apple.application-identifier': applicationIdentifier,
        'com.apple.developer.team-identifier': teamIdentifier,
        'get-task-allow': getTaskAllow === 'true',
      },
      ExpirationDate: await field('ExpirationDate'),
      ProvisionsAllDevices: (await field('ProvisionsAllDevices')) === 'true',
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
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>CFBundleIdentifier</key><string>${RELEASE_IDENTIFIER}</string>\n<key>CFBundleExecutable</key><string>${RELEASE_EXECUTABLE_NAME}</string>\n<key>CFBundleName</key><string>${RELEASE_DISPLAY_NAME}</string>\n<key>CFBundlePackageType</key><string>APPL</string>\n<key>CFBundleVersion</key><string>${version}</string>\n<key>CFBundleShortVersionString</key><string>${version}</string>\n<key>LSUIElement</key><true/>\n</dict></plist>\n`
}

function releaseInfoValue(plist: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(
    `<key>\\s*${escaped}\\s*</key>\\s*<string>\\s*([^<]+?)\\s*</string>`,
    'u',
  ).exec(plist)?.[1]
}

export function validateReleaseInfoPlist(
  plist: string,
  options: { expectedVersion?: string | undefined } = {},
): void {
  const expectedVersion = options.expectedVersion
  const version = releaseInfoValue(plist, 'CFBundleVersion')
  const shortVersion = releaseInfoValue(plist, 'CFBundleShortVersionString')
  if (
    releaseInfoValue(plist, 'CFBundleIdentifier') !== RELEASE_IDENTIFIER ||
    releaseInfoValue(plist, 'CFBundleExecutable') !== RELEASE_EXECUTABLE_NAME ||
    releaseInfoValue(plist, 'CFBundleName') !== RELEASE_DISPLAY_NAME ||
    version !== shortVersion ||
    version === undefined ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version) ||
    (expectedVersion !== undefined && version !== expectedVersion)
  ) {
    throw new Error(
      `Invalid release Info.plist; expected the canonical Sockeye identity and ${expectedVersion ?? 'one matching semantic version'}. Rebuild the application bundle.`,
    )
  }
}

export async function readReleaseInfoPlist(filename: string): Promise<string> {
  return fs.readFile(filename, 'utf8')
}

export function releaseAssetName(architecture: string): string {
  return `${RELEASE_EXECUTABLE_NAME}-darwin-${architecture}.zip`
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

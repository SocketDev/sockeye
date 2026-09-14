import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  BINARY_NAME,
  RELEASE_BUNDLE_DIRECTORY_ENTRIES,
  RELEASE_BUNDLE_ENTRIES,
  RELEASE_BUNDLE_NAME,
  releaseBundlePath,
  releaseBundlePaths,
  releaseProfileInspectionPaths,
} from '../paths.mts'
import { decodeReleaseProfileCms } from './profile.mts'

export const RELEASE_DISPLAY_NAME = 'Sockeye'
export const RELEASE_EXECUTABLE_NAME = BINARY_NAME
export const RELEASE_IDENTIFIER = 'dev.socket.sockeye'
export const RELEASE_TEAM_IDENTIFIER = 'PZRCDQ736X'
export const RELEASE_SIGNING_IDENTITY = `Developer ID Application: Socket Inc. (${RELEASE_TEAM_IDENTIFIER})`
export const RELEASE_DESIGNATED_REQUIREMENT = `=anchor apple generic and identifier "${RELEASE_IDENTIFIER}" and certificate leaf[subject.OU] = "${RELEASE_TEAM_IDENTIFIER}" and certificate leaf[subject.CN] = "${RELEASE_SIGNING_IDENTITY}"`
export const RELEASE_APPLICATION_IDENTIFIER = `${RELEASE_TEAM_IDENTIFIER}.${RELEASE_IDENTIFIER}`
export function releaseArchiveEntriesAreValid(
  entries: readonly string[],
  options: { stapled?: boolean | undefined } = {},
): boolean {
  const expected =
    options.stapled === false
      ? RELEASE_BUNDLE_ENTRIES.filter(
          entry => entry !== `${RELEASE_BUNDLE_NAME}/Contents/CodeResources`,
        )
      : RELEASE_BUNDLE_ENTRIES
  const normalized = entries.map(entry => entry.replace(/\/$/u, ''))
  return (
    new Set(normalized).size === expected.length &&
    normalized.length === expected.length &&
    expected.every(entry => normalized.includes(entry))
  )
}

export function releaseArchiveMemberTypesAreValid(
  entries: readonly string[],
  metadata: string,
): boolean {
  const rows = metadata
    .split(/\r?\n/u)
    .filter(line => /^[bcdlps-][rwx-]{9}\s/u.test(line))
  return (
    rows.length === entries.length &&
    entries.every((entry, index) =>
      RELEASE_BUNDLE_DIRECTORY_ENTRIES.includes(
        normalizePath(entry).replace(
          /\/$/u,
          '',
        ) as (typeof RELEASE_BUNDLE_DIRECTORY_ENTRIES)[number],
      )
        ? rows[index]?.startsWith('d')
        : rows[index]?.startsWith('-'),
    )
  )
}

export function releaseChecksumMatches(
  sidecar: string,
  actual: string,
  archiveName: string,
): boolean {
  // Match one lowercase SHA-256, two spaces, one basename, and one optional newline.
  const match = /^([a-f0-9]{64})  ([^\r\n]+)\r?\n?$/u.exec(sidecar)
  return match !== null && match[1] === actual && match[2] === archiveName
}

export function releaseSignatureMetadataIsValid(metadata: string): boolean {
  const flags = /^CodeDirectory .* flags=0x[0-9a-f]+\(([^)]*)\)/imu.exec(
    metadata,
  )?.[1]
  const timestamp = /^Timestamp=(.+)$/imu.exec(metadata)?.[1]?.trim()
  return (
    flags
      ?.split(',')
      .map(value => value.trim())
      .includes('runtime') === true &&
    timestamp !== undefined &&
    timestamp.length > 0 &&
    timestamp.toLowerCase() !== 'none'
  )
}

export function releasePlistBoolean(xml: string | undefined): boolean {
  return xml !== undefined && /<true\s*\/>/u.test(xml)
}

export function releasePlistStrings(xml: string | undefined): string[] {
  if (xml === undefined) {
    return []
  }
  return Array.from(
    xml.matchAll(/<string>\s*([^<]+?)\s*<\/string>/gu),
    match => match[1]!,
  )
}

export async function extractReleaseProfileField(
  plist: string,
  key: string,
  format: 'raw' | 'xml1' = 'raw',
  required = true,
): Promise<string | undefined> {
  try {
    const result = await spawn('/usr/bin/plutil', [
      '-extract',
      key,
      format,
      '-o',
      '-',
      plist,
    ])
    if (result.code === 0 && result.stdout) {
      return result.stdout.trim()
    }
  } catch {
    if (!required) {
      return undefined
    }
  }
  if (!required) {
    return undefined
  }
  throw new Error(
    `Provisioning profile field ${key} is missing or invalid. Supply the matching Developer ID profile.`,
  )
}

export function releaseEntitlementValue(
  plist: string,
  key: string,
): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(
    `<key>\\s*${escaped}\\s*</key>\\s*<string>\\s*([^<]+?)\\s*</string>`,
    'u',
  ).exec(plist)?.[1]
}

export function releaseEntitlementsAreValid(plist: string): boolean {
  const keys = Array.from(plist.matchAll(/<key>\s*([^<]+?)\s*<\/key>/gu)).map(
    match => match[1],
  )
  return (
    keys.length === 2 &&
    new Set(keys).size === 2 &&
    releaseEntitlementValue(plist, 'com.apple.application-identifier') ===
      RELEASE_APPLICATION_IDENTIFIER &&
    releaseEntitlementValue(plist, 'com.apple.developer.team-identifier') ===
      RELEASE_TEAM_IDENTIFIER
  )
}

export function releaseProfileGroupIsValid(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (value === RELEASE_APPLICATION_IDENTIFIER ||
      value === `${RELEASE_TEAM_IDENTIFIER}.*`)
  )
}

export function releaseProfileEntitlementsAreValid(
  entitlements: Record<string, unknown>,
): boolean {
  return [
    entitlements['com.apple.application-identifier'] ===
      RELEASE_APPLICATION_IDENTIFIER,
    entitlements['com.apple.developer.team-identifier'] ===
      RELEASE_TEAM_IDENTIFIER,
    entitlements['get-task-allow'] !== true,
    entitlements['com.apple.security.get-task-allow'] !== true,
    Array.isArray(entitlements['keychain-access-groups']) &&
      entitlements['keychain-access-groups'].length > 0 &&
      entitlements['keychain-access-groups'].every(releaseProfileGroupIsValid),
  ].every(Boolean)
}

export function releaseProfileMetadataIsValid(
  profile: Record<string, unknown>,
  certificateSha256: string | undefined,
  now: number,
): boolean {
  const certificates = profile['DeveloperCertificates']
  const platform = profile['Platform']
  const expiration = profile['ExpirationDate']
  return [
    Array.isArray(platform) && platform.length === 1 && platform[0] === 'OSX',
    profile['ProvisionsAllDevices'] === true,
    Array.isArray(certificates) &&
      certificates.length > 0 &&
      certificates.every(
        value => typeof value === 'string' && /^[A-F0-9]{64}$/u.test(value),
      ),
    certificateSha256 === undefined ||
      (Array.isArray(certificates) &&
        certificates.includes(certificateSha256.toUpperCase())),
    typeof expiration === 'string' && Date.parse(expiration) > now,
  ].every(Boolean)
}

export function validateReleaseProfile(
  profile: unknown,
  options: {
    certificateSha256?: string | undefined
    now?: number | undefined
  } = {},
): void {
  const now = options.now ?? Date.now()
  if (!isPlainObject(profile) || !isPlainObject(profile['Entitlements'])) {
    throw new Error(
      'Invalid provisioning profile; expected decoded profile entitlements. Supply a Developer ID profile.',
    )
  }
  const entitlements = profile['Entitlements']
  if (
    !releaseProfileEntitlementsAreValid(entitlements) ||
    !releaseProfileMetadataIsValid(profile, options.certificateSha256, now)
  ) {
    throw new Error(
      'Provisioning profile rejected; expected an unexpired Developer ID profile for Sockeye with debugging disabled. Regenerate the matching profile.',
    )
  }
}

export async function readReleaseProfile(profile: string): Promise<unknown> {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'sockeye-profile-'))
  try {
    const inspection = releaseProfileInspectionPaths(scratch)
    const decoded = await decodeReleaseProfileCms(profile)
    const plist = inspection.plist
    await fs.writeFile(plist, decoded, { mode: 0o600 })
    const certificateXml = await extractReleaseProfileField(
      plist,
      'DeveloperCertificates',
      'xml1',
    )
    const certificateData = Array.from(
      certificateXml!.matchAll(/<data>\s*([A-Za-z0-9+/=\s]+?)\s*<\/data>/gu),
      match => match[1]!.replace(/\s+/gu, ''),
    )
    return {
      DeveloperCertificates: certificateData.map(value =>
        crypto.hash('sha256', Buffer.from(value, 'base64')).toUpperCase(),
      ),
      Entitlements: {
        'com.apple.application-identifier': await extractReleaseProfileField(
          plist,
          'Entitlements.com\\.apple\\.application-identifier',
        ),
        'com.apple.developer.team-identifier': await extractReleaseProfileField(
          plist,
          'Entitlements.com\\.apple\\.developer\\.team-identifier',
        ),
        'com.apple.security.get-task-allow': releasePlistBoolean(
          await extractReleaseProfileField(
            plist,
            'Entitlements.com\\.apple\\.security\\.get-task-allow',
            'xml1',
            false,
          ),
        ),
        'get-task-allow': releasePlistBoolean(
          await extractReleaseProfileField(
            plist,
            'Entitlements.get-task-allow',
            'xml1',
            false,
          ),
        ),
        'keychain-access-groups': releasePlistStrings(
          await extractReleaseProfileField(
            plist,
            'Entitlements.keychain-access-groups',
            'xml1',
          ),
        ),
      },
      ExpirationDate: await extractReleaseProfileField(plist, 'ExpirationDate'),
      Platform: releasePlistStrings(
        await extractReleaseProfileField(plist, 'Platform', 'xml1'),
      ),
      ProvisionsAllDevices: releasePlistBoolean(
        await extractReleaseProfileField(plist, 'ProvisionsAllDevices', 'xml1'),
      ),
      UUID: await extractReleaseProfileField(plist, 'UUID'),
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

export function releaseInfoValue(
  plist: string,
  key: string,
): string | undefined {
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

export async function readReleaseCertificateSha256(
  bundle: string,
): Promise<string> {
  const scratch = await fs.mkdtemp(
    path.join(os.tmpdir(), 'sockeye-certificate-'),
  )
  try {
    const prefix = path.join(scratch, 'certificate')
    const extraction = await spawn('/usr/bin/codesign', [
      '--display',
      `--extract-certificates=${prefix}`,
      bundle,
    ])
    if (extraction.code !== 0) {
      throw new Error(
        `Signing certificate extraction failed for ${bundle}; expected the leaf certificate. Re-sign the application with its profile certificate.`,
      )
    }
    const digest = await spawn('/usr/bin/shasum', ['-a', '256', `${prefix}0`])
    const value = digest.stdout?.trim().split(/\s+/u)[0]
    if (
      digest.code !== 0 ||
      value === undefined ||
      !/^[a-f0-9]{64}$/iu.test(value)
    ) {
      throw new Error(
        `Signing certificate digest failed for ${bundle}; expected a SHA-256 leaf certificate digest. Inspect the codesign toolchain and retry.`,
      )
    }
    return value.toUpperCase()
  } finally {
    await safeDelete(scratch)
  }
}

export async function validateReleaseSignatureMetadata(
  bundle: string,
): Promise<void> {
  const result = await spawn('/usr/bin/codesign', [
    '--display',
    '--verbose=4',
    bundle,
  ])
  const metadata = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (result.code !== 0 || !releaseSignatureMetadataIsValid(metadata)) {
    throw new Error(
      `Release signature rejected for ${bundle}; expected hardened runtime and a secure timestamp. Sign with Developer ID before notarization.`,
    )
  }
}

export async function validateReleaseEntitlements(
  bundle: string,
): Promise<void> {
  const result = await spawn('/usr/bin/codesign', [
    '--display',
    '--entitlements',
    ':-',
    bundle,
  ])
  const entitlements = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (result.code !== 0 || !releaseEntitlementsAreValid(entitlements)) {
    throw new Error(
      `Release entitlements rejected for ${bundle}; expected only the application and team identifiers. Re-sign the application with the canonical entitlements.`,
    )
  }
}

export async function validateReleaseBundleMetadata(
  bundle: string,
  options: { expectedVersion?: string | undefined } = {},
): Promise<void> {
  const { expectedVersion } = { __proto__: null, ...options } as typeof options
  const files = releaseBundlePaths(bundle)
  validateReleaseInfoPlist(await readReleaseInfoPlist(files.info), {
    expectedVersion,
  })
  await validateReleaseEntitlements(bundle)
  await validateReleaseSignatureMetadata(bundle)
  validateReleaseProfile(await readReleaseProfile(files.profile), {
    certificateSha256: await readReleaseCertificateSha256(bundle),
  })
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

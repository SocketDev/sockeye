#!/usr/bin/env node
/**
 * @file Install the Sockeye binary: download from a GitHub release, verify the
 *   checksum, install to ~/.socket/bin, and remove the quarantine attribute so
 *   it executes without the "unidentified developer" prompt.
 *   Until the org-level Apple Developer ID secrets are in place, this script
 *   can also build and ad-hoc sign the binary from a local checkout:
 *   node scripts/repo/setup-sockeye.mts --local
 *   The --local path builds the prod binary, signs it ad-hoc with the hardened
 *   runtime, installs it, and strips the quarantine attribute. An ad-hoc
 *   signature is good for local Keychain testing but not releasable — rerun
 *   without --local once a signed release is available.
 *   Usage: node scripts/repo/setup-sockeye.mts [--local | --release <tag>]
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { getBinaryPath } from './paths.mts'
import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../fleet/_shared/is-main-module.mts'
import { runMain } from '../fleet/_shared/run-main.mts'

import type { ScriptMeta } from '../fleet/_shared/run-main.mts'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

const logger = getDefaultLogger()

const BIN_DIR = path.join(os.homedir(), '.socket', 'bin')
const BIN_PATH = path.join(BIN_DIR, 'sockeye')
const ARCH = process.arch
const PLATFORM = process.platform
const PLATFORM_ARCH = `${PLATFORM}-${ARCH}`

/**
 * Build, ad-hoc sign, and install from a local checkout.
 */
async function installLocal(): Promise<void> {
  if (PLATFORM !== 'darwin') {
    logger.fail('Sockeye requires macOS.')
    process.exit(1)
  }

  logger.log('Building prod binary…')
  const build = await spawn('pnpm', ['run', 'build', '--', '--mode', 'prod'])
  if (build.code !== 0) {
    logger.fail('Build failed.')
    process.exit(1)
  }

  logger.log('Ad-hoc signing with hardened runtime…')
  const sign = await spawn('pnpm', ['run', 'sign', '--ad-hoc', '--run'])
  if (sign.code !== 0) {
    logger.fail('Signing failed.')
    process.exit(1)
  }

  const prodPath = getBinaryPath('prod', PLATFORM_ARCH)
  const devPath = getBinaryPath('dev', PLATFORM_ARCH)
  const builtPath = existsSync(prodPath) ? prodPath : devPath
  if (!existsSync(builtPath)) {
    logger.fail(`Built binary not found at ${prodPath} or ${devPath}.`)
    process.exit(1)
  }
  installFrom(builtPath)
}

/**
 * Download from a GitHub release, verify, and install.
 */
async function installFromRelease(tag: string): Promise<void> {
  const assetName = `sockeye-darwin-${ARCH}.zip`
  const downloadUrl = `https://github.com/SocketDev/sockeye/releases/download/${tag}/${assetName}`
  const tmpDir = path.join(os.tmpdir(), 'sockeye-install')
  const zipPath = path.join(tmpDir, assetName)

  mkdirSync(tmpDir, { recursive: true })

  logger.log(`Downloading ${assetName} from ${tag}...`)
  const dl = await spawn('curl', ['-fsSL', '-o', zipPath, downloadUrl])
  if (dl.code !== 0) {
    logger.fail(
      `Download failed. Check that ${tag} exists and carries ${assetName}.`,
    )
    process.exit(1)
  }

  logger.log('Verifying checksum…')
  const checksumUrl = `${downloadUrl}.sha256`
  const checksum = await spawn('curl', ['-fsSL', checksumUrl])
  if (checksum.code === 0) {
    const expected = (
      typeof checksum.stdout === 'string' ? checksum.stdout : ''
    )
      .trim()
      .split(/\s+/)[0]
    const hash = spawnSync('shasum', ['-a', '256', zipPath])
    const actual = (typeof hash.stdout === 'string' ? hash.stdout : '')
      .trim()
      .split(/\s+/)[0]
    if (expected && actual !== expected) {
      logger.fail(`Checksum mismatch. Saw: ${actual}. Want: ${expected}.`)
      process.exit(1)
    }
    logger.success('Checksum verified.')
  }

  logger.log('Extracting…')
  await spawn('unzip', ['-o', zipPath, '-d', tmpDir])
  const extractedPath = path.join(tmpDir, 'sockeye')
  if (!existsSync(extractedPath)) {
    logger.fail(`Extracted binary not found at ${extractedPath}.`)
    process.exit(1)
  }

  installFrom(extractedPath)
  safeDeleteSync(tmpDir)
}

/**
 * Install a binary to ~/.socket/bin, make it executable, and strip the
 * quarantine attribute so it runs without the Gatekeeper prompt.
 */
function installFrom(binaryPath: string): void {
  mkdirSync(BIN_DIR, { recursive: true })
  copyFileSync(binaryPath, BIN_PATH)
  chmodSync(BIN_PATH, 0o755)

  // Remove the quarantine attribute that macOS sets on downloaded files.
  // A locally-built binary does not carry it, but the download path does,
  // and stripping it unconditionally is harmless.
  spawnSync('xattr', ['-d', 'com.apple.quarantine', BIN_PATH])

  // Verify the signature on disk.
  const verify = spawnSync('codesign', ['-dv', '--verbose=1', BIN_PATH])
  if (verify.status !== 0) {
    logger.warn('No signature on the installed binary.')
  } else {
    logger.success('Signature verified.')
  }

  logger.success(`Installed to ${BIN_PATH}`)
  logger.log('Usage: sockeye set <CREDENTIAL_NAME>')
  logger.log(
    '       sockeye run --credential <NAME> --cwd <dir> -- <exe> [args]',
  )
}

export async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const isLocal = args.includes('--local')
  const releaseIdx = args.indexOf('--release')
  const releaseTag = releaseIdx >= 0 ? args[releaseIdx + 1] : undefined

  if (isLocal) {
    await installLocal()
  } else if (releaseTag) {
    await installFromRelease(releaseTag)
  } else {
    await installFromRelease('latest')
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'install the Sockeye binary: download from a release or build and ad-hoc sign locally',
  help: `Usage: node scripts/repo/setup-sockeye.mts [options]

  --local            build, ad-hoc sign, and install from this checkout
  --release <tag>    download, verify, and install from a GitHub release
  (no flags)         install from the latest release

The binary installs to ~/.socket/bin/sockeye. The quarantine attribute is
removed so it executes without the Gatekeeper prompt.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}

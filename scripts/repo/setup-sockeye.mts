#!/usr/bin/env node
import {
  getScriptArgs,
  getScriptLogger,
} from '../fleet/process/script-output.mts'
/**
 * @file Install the Sockeye binary: download from a GitHub release, verify the
 *   checksum, install to ~/.socket/bin, and remove the quarantine attribute so
 *   it executes without the "unidentified developer" prompt.
 *   Usage: node scripts/repo/setup-sockeye.mts [--release <tag>]
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { abortScript } from '../fleet/process/script-result.mts'
import { runMain } from '../fleet/process/run-main.mts'

import type { ScriptMeta } from '../fleet/process/run-main.mts'
const logger = getScriptLogger()

const BIN_DIR = path.join(os.homedir(), '.socket', 'bin')
const BIN_PATH = path.join(BIN_DIR, 'sockeye')
const ARCH = process.arch

/**
 * Download from a GitHub release, verify, and install.
 */
async function installFromRelease(tag: string): Promise<void> {
  const assetName = `sockeye-darwin-${ARCH}.zip`
  const downloadUrl = `https://github.com/SocketDev/sockeye/releases/download/${tag}/${assetName}`
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sockeye-install-'))
  const zipPath = path.join(tmpDir, assetName)
  try {
    logger.log(`Downloading ${assetName} from ${tag}...`)
    const dl = await spawn('curl', ['-fsSL', '-o', zipPath, downloadUrl])
    if (dl.code !== 0) {
      logger.fail(
        `Download failed. Check that ${tag} exists and carries ${assetName}.`,
      )
      abortScript(1)
    }

    logger.log('Verifying checksum…')
    const checksumPath = `${zipPath}.sha256`
    const checksum = await spawn('curl', [
      '-fsSL',
      '-o',
      checksumPath,
      `${downloadUrl}.sha256`,
    ])
    if (checksum.code !== 0) {
      logger.fail('Checksum download failed. The release cannot be verified.')
      abortScript(1)
    }
    const expected = (await readFile(checksumPath, 'utf8'))
      .trim()
      .split(/\s+/)[0]
    const hash = spawnSync('shasum', ['-a', '256', zipPath])
    const actual = (typeof hash.stdout === 'string' ? hash.stdout : '')
      .trim()
      .split(/\s+/)[0]
    if (!expected || hash.status !== 0 || actual !== expected) {
      logger.fail(`Checksum mismatch. Saw: ${actual}. Want: ${expected}.`)
      abortScript(1)
    }
    logger.success('Checksum verified.')

    const releaseVerification = await spawn('pnpm', [
      'run',
      'verify-release',
      zipPath,
    ])
    if (releaseVerification.code !== 0) {
      logger.fail('Release signature, entitlements, or notarization failed.')
      abortScript(1)
    }

    logger.log('Extracting…')
    const extract = await spawn('unzip', ['-o', zipPath, '-d', tmpDir])
    const extractedPath = path.join(tmpDir, 'sockeye')
    if (extract.code !== 0 || !existsSync(extractedPath)) {
      logger.fail(`Extracted binary not found at ${extractedPath}.`)
      abortScript(1)
    }

    await installFrom(extractedPath)
  } finally {
    await safeDelete(tmpDir)
  }
}

/**
 * Install a binary to ~/.socket/bin, make it executable, and strip the
 * quarantine attribute so it runs without the Gatekeeper prompt.
 */
async function installFrom(binaryPath: string): Promise<void> {
  mkdirSync(BIN_DIR, { recursive: true })
  copyFileSync(binaryPath, BIN_PATH)
  chmodSync(BIN_PATH, 0o755)

  // Remove the quarantine attribute that macOS sets on downloaded files.
  // A locally-built binary does not carry it, but the download path does,
  // and stripping it unconditionally is harmless.
  spawnSync('xattr', ['-d', 'com.apple.quarantine', BIN_PATH])

  // Verify the signature on disk.
  const verify = await spawn('pnpm', ['run', 'verify-release', BIN_PATH])
  if (verify.code !== 0) {
    logger.fail('Installed binary failed release verification.')
    abortScript(1)
  }
  logger.success('Signature, entitlements, and notarization verified.')

  logger.success(`Installed to ${BIN_PATH}`)
  logger.log('Usage: sockeye set <CREDENTIAL_NAME>')
  logger.log(
    '       sockeye run --credential <NAME> --cwd <dir> -- <exe> [args]',
  )
}

export async function main(): Promise<number> {
  const args = getScriptArgs()
  const releaseIdx = args.indexOf('--release')
  const releaseTag = releaseIdx >= 0 ? args[releaseIdx + 1] : undefined

  if (args.length > 0 && releaseIdx < 0) {
    throw new Error(
      `Setup argument rejected at ${args[0]}; expected --release <tag>. Install a Developer ID release artifact.`,
    )
  }
  if (releaseIdx >= 0 && releaseTag === undefined) {
    throw new Error(
      'Release tag missing after --release; expected a published Sockeye tag.',
    )
  }
  if (releaseTag) {
    await installFromRelease(releaseTag)
  } else {
    await installFromRelease('latest')
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'Install the Developer ID signed Sockeye binary from a GitHub release.',
  help: `Usage: node scripts/repo/setup-sockeye.mts [options]

  --release <tag>    download, verify, and install from a GitHub release
  (no flags)         install from the latest release

The binary installs to ~/.socket/bin/sockeye. The quarantine attribute is
removed so it executes without the Gatekeeper prompt.`,
  json: 'result',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}

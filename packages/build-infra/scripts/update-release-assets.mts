#!/usr/bin/env node
import {
  getDefaultFormatting,
  stringifyWithFormatting,
} from '@socketsecurity/lib-stable/json/format'
import {
  BUILD_RELEASE_ASSETS_FILE,
  getBuildTempDir,
  getReleaseChecksumDownloadPath,
} from '../lib/paths.mts'
import { PACKAGE_ROOT } from '../lib/constants.mts'
import { isMainModule } from '../../../scripts/fleet/process/is-main-module.mts'
import { runMain } from '../../../scripts/fleet/process/run-main.mts'
import type { ScriptMeta } from '../../../scripts/fleet/process/run-main.mts'
/**
 * Update checksums from GitHub releases to release-assets.json.
 *
 * This script fetches checksums.txt from the latest release of each tool
 * and updates the embedded checksums in release-assets.json.
 *
 * Usage:
 * node scripts/update-release-assets.mts [--tool=<tool>] [--force]
 *
 * Options: --tool=<name> Only sync specific tool (lief, curl, stubs, binpress,
 * binflate, binject) --force Force update even if checksums haven't changed
 * --dry-run Show what would be updated without writing.
 */

import { existsSync, promises as fs, readFileSync } from 'node:fs'
import process from 'node:process'

import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getLatestRelease } from '@socketsecurity/lib-stable/releases/github-listing'
import { downloadReleaseAsset } from '@socketsecurity/lib-stable/releases/github-downloads'
import { SOCKET_BTM_REPO } from '@socketsecurity/lib-stable/releases/socket-btm'

import { errorMessage } from '../lib/error-utils.mts'
import { parseChecksums } from '../../../scripts/fleet/build/infra/lib/release-checksums/core.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const logger = getDefaultLogger()

export const SCRIPT_META: ScriptMeta = {
  describe: 'Update recorded release asset checksums from GitHub releases.',
  help: 'Usage: pnpm --filter local-build-infra update-release-assets [--tool=<name>] [--force] [--dry-run]\n\n  --tool=<name>  Update one tool.\n  --force        Write unchanged release checksums.\n  --dry-run      Report changes without writing.',
}

/**
 * Tools to sync checksums for (only packages with GitHub releases).
 */
const TOOLS = [
  'lief',
  'curl',
  'stubs',
  'binpress',
  'binflate',
  'binject',
  'node-smol',
  'ink',
  'iocraft',
  'onnxruntime',
  'models',
  'yoga-layout',
  'opentui',
]

/**
 * Fetch checksums for a tool from GitHub release.
 *
 * @param {string} tool - Tool name.
 *
 * @returns {Promise<
 *   { tag: string; checksums: Record<string, string> } | undefined
 * >}
 */
export async function fetchToolChecksums(tool) {
  const toolPrefix = `${tool}-`

  try {
    // Get latest release tag.
    const tag = await getLatestRelease(toolPrefix, SOCKET_BTM_REPO)
    if (!tag) {
      logger.warn(`No release found for ${tool}`)
      return undefined
    }

    // Download checksums.txt to temp location.
    const tempDir = getBuildTempDir(PACKAGE_ROOT)
    await safeMkdir(tempDir)
    const checksumPath = getReleaseChecksumDownloadPath({ tool, tag })

    // Download checksums.txt.
    await downloadReleaseAsset(
      tag,
      'checksums.txt',
      checksumPath,
      SOCKET_BTM_REPO,
      { quiet: true },
    )

    // Parse checksums.
    const content = await fs.readFile(checksumPath, 'utf8')
    const checksums = parseChecksums(content)

    // Clean up temp file.
    await safeDelete(checksumPath).catch(() => {})

    return { __proto__: null, checksums, tag }
  } catch (e) {
    logger.warn(`Failed to fetch checksums for ${tool}: ${errorMessage(e)}`)
    return undefined
  }
}

/**
 * Main sync function.
 */
export async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const dryRun = args.includes('--dry-run')
  const toolArg = args.find(arg => arg.startsWith('--tool='))
  const toolFilter = toolArg ? toolArg.split('=')[1] : undefined

  // Validate tool filter.
  if (toolFilter && !TOOLS.includes(toolFilter)) {
    logger.fail(`Unknown tool: ${toolFilter}`)
    logger.info(`Valid tools: ${TOOLS.join(', ')}`)
    process.exitCode = 1
    return
  }

  const toolsToSync = toolFilter ? [toolFilter] : TOOLS

  // Load current checksums file.
  let currentData = { __proto__: null }
  if (existsSync(BUILD_RELEASE_ASSETS_FILE)) {
    try {
      currentData = JSON.parse(readFileSync(BUILD_RELEASE_ASSETS_FILE, 'utf8'))
    } catch (e) {
      logger.warn(
        `Failed to parse ${BUILD_RELEASE_ASSETS_FILE}: ${errorMessage(e)}`,
      )
    }
  }

  logger.info(`Syncing checksums for ${toolsToSync.length} tool(s)...`)
  logger.info('')

  const counts = { updated: 0, unchanged: 0, skipped: 0, failed: 0 }

  for (let i = 0, { length } = toolsToSync; i < length; i += 1) {
    const tool = toolsToSync[i]
    const outcome = await syncToolReleaseChecksums({ tool, currentData, force })
    counts[outcome] += 1
  }

  const { updated, unchanged, skipped, failed } = counts
  logger.info('')

  await writeReleaseAssetUpdates({ currentData, updated, dryRun })

  // Summary.
  logger.info('')
  const parts = [`${updated} updated`, `${unchanged} unchanged`]
  if (skipped > 0) {
    parts.push(`${skipped} skipped (no release)`)
  }
  if (failed > 0) {
    parts.push(`${failed} failed`)
  }
  const summary = parts.join(', ')

  if (failed > 0) {
    logger.warn(`Summary: ${summary}`)
    process.exitCode = 1
  } else {
    logger.success(`Summary: ${summary}`)
  }
}

export async function syncToolReleaseChecksums(config) {
  const { tool, currentData, force } = { __proto__: null, ...config }
  logger.info(`Fetching checksums for ${tool}...`)

  const result = await fetchToolChecksums(tool)
  if (!result) {
    // No release found — not an error, tool hasn't been released yet.
    return 'skipped'
  }

  const { checksums, tag } = result
  const checksumCount = Object.keys(checksums).length

  if (checksumCount === 0) {
    logger.warn(`  No checksums found in release ${tag}`)
    return 'failed'
  }

  // Check if update is needed.
  const current = currentData[tool]
  const currentTag = current?.tag
  const currentChecksums = current?.checksums || {}
  const currentCount = Object.keys(currentChecksums).length

  const tagChanged = currentTag !== tag
  const checksumsChanged =
    JSON.stringify(checksums) !== JSON.stringify(currentChecksums)

  if (!force && !tagChanged && !checksumsChanged) {
    logger.info(`  ${tool}: unchanged (${tag}, ${checksumCount} checksums)`)
    return 'unchanged'
  }

  // Update the data.
  if (!currentData[tool]) {
    currentData[tool] = { __proto__: null }
  }
  currentData[tool].description = current?.description || `${tool} binaries`
  currentData[tool].tag = tag
  currentData[tool].checksums = checksums

  if (tagChanged) {
    logger.success(
      `  ${tool}: ${currentTag || '(none)'} -> ${tag} (${checksumCount} checksums)`,
    )
  } else {
    logger.success(
      `  ${tool}: updated checksums (${currentCount} -> ${checksumCount})`,
    )
  }
  return 'updated'
}

export async function writeReleaseAssetUpdates(config) {
  const { currentData, updated, dryRun } = { __proto__: null, ...config }
  // Write updated file.
  if (updated > 0 && !dryRun) {
    const { $schema: schema, $comment: comment, ...rest } = currentData
    void schema
    void comment
    const output = {
      $schema: './release-assets.schema.json',
      $comment:
        "SHA-256 checksums for GitHub release assets. Run 'pnpm --filter local-build-infra update-release-assets' to update.",
      ...rest,
    }

    await fs.writeFile(
      BUILD_RELEASE_ASSETS_FILE,
      stringifyWithFormatting(output, getDefaultFormatting()),
      'utf8',
    )
    logger.success(`Updated ${BUILD_RELEASE_ASSETS_FILE}`)
  } else if (dryRun && updated > 0) {
    logger.info('Dry run - no changes written')
  }
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}

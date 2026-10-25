/**
 * Get tool version from build-requirements.json.
 *
 * Zero external dependencies — safe to run before `pnpm install`.
 *
 * Usage:
 * node get-tool-version.mts <tool-name> [version-key]
 *
 * Examples:
 * node get-tool-version.mts python version    # prints "3.11"
 * node get-tool-version.mts ninja version     # prints "1.12.1"
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  BUILD_REQUIREMENTS_PACKAGE_ROOT,
  getBuildRequirementsPath,
} from '../lib/build-requirements/paths.mts'

// Parse --package-root flag to find the right build-requirements.json.
const args = process.argv.slice(2)
let packageRoot = BUILD_REQUIREMENTS_PACKAGE_ROOT
const packageRootIdx = args.indexOf('--package-root')
if (packageRootIdx !== -1 && args[packageRootIdx + 1]) {
  packageRoot = path.resolve(args[packageRootIdx + 1])
  args.splice(packageRootIdx, 2)
}

const BUILD_REQUIREMENTS_PATH = getBuildRequirementsPath(packageRoot)
const toolName = args[0]
const versionKey = args[1] || 'version'

// This script runs BEFORE `pnpm install` (it reads build-requirements.json
// to learn the pnpm + node versions). Importing @socketsecurity/lib's
// logger would create a chicken-and-egg dependency — node_modules
// doesn't exist yet. Use console directly; the markers exempt the
// logger-guard PreToolUse hook from flagging the writes.
if (!toolName) {
  const usage =
    'Usage: get-tool-version.mts <tool-name> [version-key] [--package-root <path>]'
  // oxlint-disable-next-line socket/no-console-prefer-logger -- runs before `pnpm install`, no lib logger available yet
  console.error(usage) // socket-hook: allow logger
  process.exitCode = 1
} else {
  try {
    const data = JSON.parse(readFileSync(BUILD_REQUIREMENTS_PATH, 'utf8'))
    const tool = data.tools?.[toolName]
    if (!tool) {
      // oxlint-disable-next-line socket/no-console-prefer-logger -- runs before `pnpm install`, no lib logger available yet
      console.error(`Tool '${toolName}' not found in build-requirements.json`) // socket-hook: allow logger
      // oxlint-disable-next-line socket/no-console-prefer-logger -- runs before `pnpm install`, no lib logger available yet
      console.error(`Available: ${Object.keys(data.tools || {}).join(', ')}`) // socket-hook: allow logger
      process.exitCode = 1
    } else {
      const value = tool[versionKey] ?? tool.version
      if (!value) {
        // oxlint-disable-next-line socket/no-console-prefer-logger -- runs before `pnpm install`, no lib logger available yet
        console.error(`No '${versionKey}' found for tool '${toolName}'`) // socket-hook: allow logger
        process.exitCode = 1
      } else {
        // oxlint-disable-next-line socket/no-console-prefer-logger -- runs before `pnpm install`, no lib logger available yet
        console.log(value) // socket-hook: allow logger
      }
    }
  } catch (e) {
    // oxlint-disable-next-line socket/no-console-prefer-logger -- runs before `pnpm install`, no lib logger available yet
    console.error(e.message) // socket-hook: allow logger
    process.exitCode = 1
  }
}

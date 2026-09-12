import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import process from 'node:process'
import {
  execBuildStep,
  formatDuration,
  getBuildLogPath,
  getLastLogLines,
} from 'local-build-infra/lib/build-operations'
import { printError } from 'local-build-infra/lib/build-output'
import { appendCCRemapFlags } from 'local-build-infra/lib/path-remap-flags'
import colors from 'yoctocolors-cjs'
import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { isWin32 } from '@socketsecurity/lib-stable/constants/platform'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  getReleaseNinjaPaths,
  getReleaseWindowsConfigurationPath,
} from './paths.mts'
import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'

const logger = getDefaultLogger()

export async function compileReleaseBinary(config) {
  const {
    buildDir,
    buildEnv,
    configureArgs,
    jobCount,
    modeSourceDir,
    platform,
  } = config

  const totalCpus = os.cpus().length
  const totalRamGB = Math.floor(os.totalmem() / (1024 * 1024 * 1024))
  const isMemoryConstrained = jobCount < totalCpus
  const isEnvOverride = Boolean(getEnvValue('BUILD_JOBS'))

  if (isEnvOverride) {
    logger.log(
      `🚀 Using ${jobCount} CPU core${jobCount > 1 ? 's' : ''} for parallel compilation (BUILD_JOBS override)`,
    )
  } else if (isMemoryConstrained) {
    logger.log(
      `🚀 Using ${jobCount} CPU core${jobCount > 1 ? 's' : ''} for parallel compilation (${totalCpus} CPUs available, reduced for ${totalRamGB}GB RAM)`,
    )
    logger.log(
      '   Memory-optimized build to prevent resource exhaustion (each job uses ~400-800MB RAM)',
    )
  } else {
    logger.log(
      `🚀 Using ${jobCount} CPU core${jobCount > 1 ? 's' : ''} for parallel compilation`,
    )
  }
  logger.log('')
  logger.log('Starting build…')
  logger.log('')

  // Clean macOS AppleDouble files that may have been restored from checkpoints
  // These ._* files cause ninja to fail trying to compile binary metadata as C++
  if (platform !== 'darwin') {
    try {
      await spawn(
        'find',
        [modeSourceDir, '-name', '._*', '-type', 'f', '-delete'],
        { stdio: 'pipe' },
      )
      logger.log('Cleaned macOS AppleDouble files from source tree')
    } catch {
      // find not available or failed - non-fatal, build may still succeed
    }
  }

  const buildStart = Date.now()

  logger.log(
    '::group::Compiling Node.js with Ninja (this will take a while...)',
  )

  await refreshReleaseNinja(modeSourceDir, { configureArgs, buildEnv })

  try {
    const ninjaCommand = whichSync('ninja')
    await execBuildStep(ninjaCommand, {
      args: ['-C', 'out/Release', `-j${jobCount}`],
      cwd: modeSourceDir,
      env: process.env,
    })
    logger.log('::endgroup::')
  } catch (e) {
    logger.log('::endgroup::')
    logger.log('')
    logger.log('::error::Ninja build failed - see collapsed section above')
    logger.log('')

    const lastLines = await getLastLogLines(buildDir, 100)
    if (lastLines) {
      logger.error()
      logger.error('Last 100 lines of build log:')
      logger.error('━'.repeat(60))
      logger.error(lastLines)
      logger.error('━'.repeat(60))
    }

    printError(
      'Build Failed',
      'Node.js compilation failed. See build log for details.',
      [
        `Full log: ${getBuildLogPath(buildDir)}`,
        'Try again with: pnpm build --clean',
      ],
    )
    throw e
  }

  const buildDuration = Date.now() - buildStart
  const buildTime = formatDuration(buildDuration)

  logger.log('')
  logger.success(`Build completed in ${buildTime}`)
  logger.log('')
}

export async function configureReleaseBinary(config) {
  const { configureFlags, modeSourceDir, outDir } = config
  // Clean build directory.
  logger.step('Cleaning Build Directory')
  if (existsSync(outDir)) {
    logger.log(`Removing ${outDir} to prevent ninja duplicate rules…`)
    await safeDelete(outDir)
    logger.success(`Cleaned ${outDir}`)
    logger.log('')
  } else {
    logger.log('No out/ directory found (clean state)')
    logger.log('')
  }

  // Windows: Clean stale junction links.
  if (isWin32()) {
    const configDirs = ['Release', 'Debug']
    for (let i = 0, { length } = configDirs; i < length; i += 1) {
      const configDir = configDirs[i]
      const junctionPath = getReleaseWindowsConfigurationPath(
        modeSourceDir,
        configDir,
      )
      if (existsSync(junctionPath)) {
        logger.log(`Removing stale ${configDir} directory/junction…`)
        await execBuildStep('cmd.exe', {
          args: ['/c', `rd /S /Q "${configDir}"`],
          cwd: modeSourceDir,
        })
        logger.log(`Removed ${configDir}`)
      }
    }
  }

  // Configure.
  const configureCommand = isWin32() ? 'vcbuild.bat' : './configure'
  const configureArgs = isWin32()
    ? convertToVcbuildFlags(configureFlags)
    : configureFlags

  logger.log(`::group::Running ${isWin32() ? 'vcbuild.bat' : './configure'}`)

  // Anonymize absolute build-host paths in DWARF and __FILE__ macros so the
  // shipped node-smol binary doesn't carry the dev's home dir... or
  // the dev's home dir... strings. Node.js's ./configure passes CFLAGS/CXXFLAGS
  // through to GYP-generated build files, which propagates to ninja.
  const buildEnv = {
    ...process.env,
    CFLAGS: appendCCRemapFlags(getEnvValue('CFLAGS')),
    CXXFLAGS: appendCCRemapFlags(getEnvValue('CXXFLAGS')),
  }

  await execBuildStep(configureCommand, {
    args: configureArgs,
    cwd: modeSourceDir,
    env: buildEnv,
    shell: isWin32(),
  })
  logger.log('::endgroup::')
  logger.log(
    // Emoji is wrapped in colors.green() decorator before being embedded in
    // multi-line build summary; logger.success() would drop the color.
    // oxlint-disable-next-line socket/no-status-emoji -- see above
    `${colors.green('✓')} ${isWin32() ? 'Build' : 'Configuration'} complete`,
  )
  logger.log('')

  if (isWin32()) {
    logger.success('Windows build completed by vcbuild.bat')
    logger.log('')
  } else {
    logger.step('Building Node.js')
  }
  return { __proto__: null, configureArgs, buildEnv }
}

export function convertToVcbuildFlags(configureFlags) {
  const vcbuildFlags = []

  // Always add openssl-no-asm
  vcbuildFlags.push('openssl-no-asm')
  vcbuildFlags.push('download-all')

  const flagMap = {
    '--without-node-options': 'no-NODE-OPTIONS',
    '--without-npm': 'nonpm',
    '--without-snapshot': 'nosnapshot',
  }

  for (let i = 0, { length } = configureFlags; i < length; i += 1) {
    const flag = configureFlags[i]
    if (flag === '--dest-cpu=arm64') {
      vcbuildFlags.push('arm64')
    } else if (flag === '--dest-cpu=x64') {
      vcbuildFlags.push('x64')
    } else if (flag === '--with-intl=small-icu') {
      // Windows: use full-icu (downloads ICU data). small-icu on Windows
      // has ICU data generation issues (MSB8066 in icudata.vcxproj).
      vcbuildFlags.push('full-icu')
    } else if (flag === '--with-intl=none') {
      vcbuildFlags.push('intl-none')
    } else if (flag === '--enable-lto') {
      vcbuildFlags.push('ltcg')
    } else if (flag === '--ninja') {
      // No-op: Ninja is default
    } else if (flag === '--experimental-enable-pointer-compression') {
      // No-op: V8 pointer compression is already default in Node.js
    } else if (flag in flagMap) {
      vcbuildFlags.push(flagMap[flag])
    } else if (flag.startsWith('--without-')) {
      // No-op: Most unsupported
    } else {
      logger.warn(`Unknown vcbuild.bat flag mapping for: ${flag}`)
    }
  }

  return vcbuildFlags
}

export async function refreshReleaseNinja(
  modeSourceDir: string,
  config: { configureArgs: string[]; buildEnv: NodeJS.ProcessEnv },
): Promise<void> {
  const { configureArgs, buildEnv } = config
  const { ninjaPath, gypPath } = getReleaseNinjaPaths(modeSourceDir)
  try {
    const { 0: ninjaStat, 1: gypStat } = await Promise.all([
      // oxlint-disable-next-line socket/prefer-exists-sync -- reads mtimeMs
      fs.stat(ninjaPath),
      // oxlint-disable-next-line socket/prefer-exists-sync -- reads mtimeMs
      fs.stat(gypPath),
    ])
    if (gypStat.mtimeMs > ninjaStat.mtimeMs) {
      logger.warn(
        `node.gyp is newer than build.ninja (${new Date(gypStat.mtimeMs).toISOString()} > ${new Date(ninjaStat.mtimeMs).toISOString()}) — re-running configure to refresh ninja source list`,
      )
      await execBuildStep(isWin32() ? 'vcbuild.bat' : './configure', {
        args: configureArgs,
        cwd: modeSourceDir,
        env: buildEnv,
        shell: isWin32(),
      })
      logger.success('Configure re-run complete; ninja refreshed')
    }
  } catch (err) {
    // First-time build (no build.ninja yet) or stat failure — let
    // ninja itself surface the error.
  }
}

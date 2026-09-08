import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getPlatform } from './build-env.mts'
import { getToolConfig } from './pinned-versions.mts'
import { detectPackageManagers } from './tool-installer-config.mts'
import { installTool, verifyToolWorks } from './tool-installer-impl.mts'

const logger = getDefaultLogger()

export async function installMissingTool(config) {
  const {
    tool,
    config: toolConfig,
    autoInstall,
    autoYes,
    toolOptions,
    ensureDependency,
  } = {
    __proto__: null,
    ...config,
  }
  // Install dependencies first.
  if (toolConfig?.dependencies?.length) {
    logger.substep(`Installing dependencies for ${tool}...`)
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const dep of toolConfig.dependencies) {
      // eslint-disable-next-line no-await-in-loop
      const depResult = await ensureDependency(dep, {
        autoInstall,
        autoYes,
        toolOptions,
      })
      if (!depResult.available) {
        return {
          __proto__: null,
          available: false,
          error: `Failed to install dependency: ${dep}`,
          installed: false,
          packageManager: undefined,
        }
      }
    }
  }

  // Detect available package managers.
  const managers = detectPackageManagers()
  if (!managers.length) {
    logger.warn(`No package manager detected for auto-installing ${tool}`)
    return {
      __proto__: null,
      available: false,
      installed: false,
      packageManager: undefined,
    }
  }

  // Try to install using the first available package manager.
  const packageManager = managers[0]
  if (!packageManager) {
    // Defensive fallback for race conditions
    logger.error('Package manager became unavailable')
    return {
      __proto__: null,
      available: false,
      installed: false,
      packageManager: undefined,
    }
  }
  logger.substep(`Attempting to install ${tool} using ${packageManager}`)

  const installed = await installTool(tool, packageManager, { autoYes })

  // Verify installation works.
  if (installed) {
    const verifyArgs = toolConfig?.verify || ['--version']
    const works = await verifyToolWorks(tool, verifyArgs)
    if (!works) {
      logger.error(`${tool} installed but failed verification`)
      return {
        __proto__: null,
        available: false,
        error: `${tool} installed but failed to run`,
        installed: true,
        packageManager,
      }
    }
  }

  return {
    __proto__: null,
    available: installed,
    installed,
    packageManager: installed ? packageManager : undefined,
  }
}

export async function repairInstalledTool(config) {
  const {
    tool,
    config: toolConfig,
    autoInstall,
    autoYes,
    toolOptions,
    ensureDependency,
  } = {
    __proto__: null,
    ...config,
  }
  // Binary exists, but verify it actually works (catches broken dependencies).
  const verifyArgs = toolConfig?.verify || ['--version']
  const works = await verifyToolWorks(tool, verifyArgs)
  if (works) {
    return {
      __proto__: null,
      available: true,
      installed: false,
      packageManager: undefined,
    }
  }

  // Tool exists but doesn't work - likely missing dependency.
  // Try to install dependencies first.
  if (toolConfig?.dependencies?.length) {
    logger.warn(`${tool} exists but failed to run - checking dependencies…`)
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const dep of toolConfig.dependencies) {
      // eslint-disable-next-line no-await-in-loop
      const depResult = await ensureDependency(dep, {
        autoInstall,
        autoYes,
        toolOptions,
      })
      if (!depResult.available) {
        const depConfig = getToolConfig(dep, toolOptions)
        return {
          __proto__: null,
          available: false,
          error: `Dependency ${dep} not available: ${depConfig?.note || 'install required'}`,
          installed: false,
          packageManager: undefined,
        }
      }
    }
    // Dependencies installed, try verifying again.
    const worksAfterDeps = await verifyToolWorks(tool, verifyArgs)
    if (worksAfterDeps) {
      return {
        __proto__: null,
        available: true,
        installed: false,
        packageManager: undefined,
      }
    }
  }

  reportBrokenTool({ tool, toolConfig })

  return {
    __proto__: null,
    available: false,
    error: `${tool} exists but failed to run (possible broken dependency)`,
    installed: false,
    packageManager: undefined,
  }
}

export function reportBrokenTool(config) {
  const { tool, toolConfig } = { __proto__: null, ...config }
  // Still broken - suggest reinstall.
  const platform = getPlatform()

  logger.error(`${tool} exists but failed to run`)
  if (toolConfig?.notes) {
    logger.substep(toolConfig.notes)
  }
  if (platform === 'darwin') {
    logger.substep(`Try: brew reinstall ${tool}`)
  } else if (platform === 'linux') {
    logger.substep(`Try: sudo apt-get install --reinstall ${tool}`)
  }
}

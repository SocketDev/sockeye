import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import {
  isPEP668Managed,
  setCachedPEP668,
  venvAvailable,
} from './python-installer.mts'
const logger = getDefaultLogger()
const PEP_668_ERROR_TOKEN = 'externally-managed-environment'

export function getPythonInstallArgs(config) {
  const { pinnedPackage, user, upgrade } = { __proto__: null, ...config }
  const args = ['install']
  // Only use --user when no venv is available. A venv does not need it.
  if (user && !venvAvailable) {
    args.push('--user')
  }
  if (upgrade) {
    args.push('--upgrade')
  }
  // On a PEP 668 managed system (Ubuntu 24.04, etc.) where no venv
  // is usable, pip refuses to touch the system interpreter without
  // --break-system-packages. We only reach this branch when the
  // venv path is unavailable (e.g. python3-venv not installed in a
  // build sandbox container), so the interpreter is intentionally
  // single-purpose and this opt-out is safe.
  if (!venvAvailable && isPEP668Managed()) {
    args.push('--break-system-packages')
  }
  // Prefer prebuilt binary wheels to avoid source compilation issues,
  // especially on Python 3.14+ where many packages don't have source compatibility yet.
  // This ensures packages like tokenizers use abi3 wheels.
  args.push('--only-binary=:all:')
  args.push(pinnedPackage)

  return args
}

export async function runPythonPipRetries(config) {
  const { pip, args, spawnOptions, packageName, quiet } = {
    __proto__: null,
    ...config,
  }
  let result = await spawn(pip, args, spawnOptions)
  let exitCode = result.code ?? 0

  // PEP 668 runtime retry (quiet mode only): if the marker file was
  // missing but pip still rejected with the externally-managed token,
  // retry once with --break-system-packages added. Verbose (inherit)
  // mode relies on the marker-file check above.
  if (shouldRetryManagedPython({ result, exitCode, args })) {
    setCachedPEP668(true)
    const pepArgs = [...args]
    // Insert --break-system-packages before the trailing package
    // specifier so pip parses it as a flag, not as a package name.
    pepArgs.splice(pepArgs.length - 1, 0, '--break-system-packages')
    result = await spawn(pip, pepArgs, spawnOptions)
    exitCode = result.code ?? 0
  }

  if (exitCode !== 0 && args.includes('--only-binary=:all:')) {
    // Binary wheel not available (e.g., Python 3.14+ without prebuilt wheels).
    // Retry without --only-binary to allow source builds as fallback.
    if (!quiet) {
      logger.warn(
        `No binary wheel for ${packageName}, retrying with source build…`,
      )
    }
    const retryArgs = args.filter(a => a !== '--only-binary=:all:')
    // Preserve --break-system-packages on the source-build retry so
    // PEP 668 doesn't block it on Debian/Ubuntu.
    if (
      !venvAvailable &&
      isPEP668Managed() &&
      !retryArgs.includes('--break-system-packages')
    ) {
      retryArgs.splice(retryArgs.length - 1, 0, '--break-system-packages')
    }
    result = await spawn(pip, retryArgs, spawnOptions)
    exitCode = result.code ?? 0
  }

  return exitCode
}

export function shouldRetryManagedPython(config) {
  const { result, exitCode, args } = { __proto__: null, ...config }
  const stderrText =
    typeof result.stderr === 'string'
      ? result.stderr
      : result.stderr instanceof Buffer
        ? result.stderr.toString('utf8')
        : ''
  return (
    exitCode !== 0 &&
    !venvAvailable &&
    !args.includes('--break-system-packages') &&
    stderrText.includes(PEP_668_ERROR_TOKEN)
  )
}

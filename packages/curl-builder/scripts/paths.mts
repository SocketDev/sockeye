import path from 'node:path'
import { fileURLToPath } from 'node:url'

export * from '../../../scripts/fleet/paths.mts'

export const CURL_PACKAGE_ROOT = path.resolve(
  fileURLToPath(new URL('../', import.meta.url)),
)

export function getCurlDownloadPaths(platformArch: string) {
  const targetDir = path.join(
    CURL_PACKAGE_ROOT,
    'build',
    'downloaded',
    'curl',
    platformArch,
  )
  return {
    __proto__: null,
    targetDir,
    versionFile: getCurlVersionFile(targetDir),
  }
}

export function getCurlExtractPaths(extractDir: string) {
  return {
    __proto__: null,
    include: path.join(extractDir, 'include'),
    lib: path.join(extractDir, 'lib'),
    bin: path.join(extractDir, 'bin'),
  }
}

export function getCurlLibraryPath(config: {
  directory: string
  filename: string
}): string {
  const { directory, filename } = {
    __proto__: null,
    ...config,
  } as typeof config
  return path.join(directory, filename)
}

export function getCurlVersionFile(directory: string): string {
  return path.join(directory, '.version')
}

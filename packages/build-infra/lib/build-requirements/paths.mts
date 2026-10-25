import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILD_REQUIREMENTS_FILENAME = 'build-requirements.json'
export const ML_BUILD_REQUIREMENTS_FILENAME = 'ml-build-requirements.json'
export const BUILD_REQUIREMENTS_PACKAGE_ROOT = fileURLToPath(
  new URL('../../', import.meta.url),
)
export const BUILD_REQUIREMENTS_SCHEMA_PATH = fileURLToPath(
  new URL('../build-requirements-schema.json', import.meta.url),
)

export function getBuildRequirementsPath(packageRoot: string): string {
  return path.join(packageRoot, BUILD_REQUIREMENTS_FILENAME)
}

export function getCheckpointRequirementsPath(config: {
  checkpointName: string
  packageRoot: string
}): string {
  const { packageRoot, checkpointName } = {
    __proto__: null,
    ...config,
  } as typeof config
  return getBuildRequirementsPath(
    path.join(packageRoot, 'scripts', checkpointName, 'shared'),
  )
}

export function isBuildRequirementsPath(filePath: string): boolean {
  const name = path.basename(filePath)
  return (
    name === BUILD_REQUIREMENTS_FILENAME ||
    name === ML_BUILD_REQUIREMENTS_FILENAME
  )
}

export function resolveRequirementReference(config: {
  manifestPath: string
  reference: string
}): string {
  const { manifestPath, reference } = {
    __proto__: null,
    ...config,
  } as typeof config
  return path.resolve(path.dirname(manifestPath), reference)
}

export const BUILD_REQUIREMENTS_PATTERNS = [
  `packages/**/${BUILD_REQUIREMENTS_FILENAME}`,
  `packages/**/${ML_BUILD_REQUIREMENTS_FILENAME}`,
]

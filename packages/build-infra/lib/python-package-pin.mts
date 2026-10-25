import {
  getPinnedPackage,
  loadPythonVersions,
  PYTHON_VERSIONS,
} from './pinned-versions.mts'
import { getConsumerManifestDirectoryPath } from './paths.mts'

export function getExpectedPythonVersion(config) {
  const { packageName, consumerPackageJsonPath } = {
    __proto__: null,
    ...config,
  }
  // Check if package exists and get expected version
  // Use consumer overrides if provided
  let expectedVersion
  if (consumerPackageJsonPath) {
    // Convert package.json path to packageRoot for loadPythonVersions
    const packageRoot = getConsumerManifestDirectoryPath(
      consumerPackageJsonPath,
    )
    const { PYTHON_VERSIONS: consumerVersions } = loadPythonVersions({
      packageRoot,
    })
    expectedVersion = consumerVersions[packageName]
  } else {
    expectedVersion = PYTHON_VERSIONS[packageName]
  }

  return expectedVersion
}

export function getPythonInstallSpec(config) {
  const { packageName, consumerPackageJsonPath } = {
    __proto__: null,
    ...config,
  }
  // Use pinned version for reproducible builds
  // Load Python versions with consumer overrides if provided
  let pinnedPackage
  if (consumerPackageJsonPath) {
    // Convert package.json path to packageRoot for loadPythonVersions
    const packageRoot = getConsumerManifestDirectoryPath(
      consumerPackageJsonPath,
    )
    const {
      PYTHON_PACKAGE_EXTRAS: consumerExtras,
      PYTHON_VERSIONS: consumerVersions,
    } = loadPythonVersions({ packageRoot })
    const version = consumerVersions[packageName]
    if (!version) {
      throw new Error(
        `No pinned version found for ${packageName}. Add to build-requirements.json with type: "python"`,
      )
    }
    const extras = consumerExtras[packageName]
    const packageSpec = extras
      ? `${packageName}[${extras.join(',')}]`
      : packageName
    pinnedPackage = `${packageSpec}==${version}`
  } else {
    pinnedPackage = getPinnedPackage(packageName)
  }

  return pinnedPackage
}

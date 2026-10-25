import path from 'node:path'
import process from 'node:process'

export function getCheckpointArchiveFile(
  directory: string,
  name: string,
): string {
  return path.join(directory, `${name}.tar.gz`)
}

export function getCheckpointArtifactPath(
  buildDir: string,
  artifactPath: string,
): string {
  return path.isAbsolute(artifactPath)
    ? artifactPath
    : path.join(buildDir, artifactPath)
}

export function getCheckpointCacheHashFile(cacheDir: string): string {
  return path.join(cacheDir, 'cache-validation.hash')
}

export function getCheckpointDirectory(
  buildDir: string,
  packageName: string,
): string {
  return path.join(buildDir, 'checkpoints', packageName)
}

export function getCheckpointExtractionTarget(
  artifactPath: string,
  destDir: string | undefined,
): string {
  return destDir
    ? path.join(destDir, path.basename(artifactPath))
    : artifactPath
}

export function getCheckpointFile(directory: string, name: string): string {
  return path.join(directory, `${name}.json`)
}

export function getCheckpointLockPath(tarballPath: string): string {
  return `${tarballPath}.lock`
}

export function getCheckpointTarballPath(checkpointFile: string): string {
  return checkpointFile.replace('.json', '.tar.gz')
}

export function getCheckpointTempExtractionDir(tarballPath: string): string {
  return `${tarballPath}.extract.tmp.${process.pid}.${Date.now()}`
}

export function getCheckpointTempFilePath(checkpointFile: string): string {
  return `${checkpointFile}.tmp.${process.pid}.${Date.now()}`
}

export function getCheckpointTempTarballPath(
  tarballPath: string,
  randomId: string,
): string {
  return `${getCheckpointTempFilePath(tarballPath)}.${randomId}`
}

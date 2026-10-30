import { randomUUID } from 'node:crypto'
import { lstat, mkdir, rename, symlink } from 'node:fs/promises'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { getInstalledSockeyeBinaryPath } from './paths.mts'

export interface LinkSockeyeBuildOptions {
  readonly destination?: string | undefined
}

export async function linkSockeyeBuild(
  binaryPath: string,
  options: LinkSockeyeBuildOptions = {},
): Promise<string> {
  const destination = options.destination ?? getInstalledSockeyeBinaryPath()
  const absoluteBinaryPath = path.resolve(binaryPath)
  const directory = path.dirname(destination)
  await mkdir(directory, { recursive: true })

  try {
    const existing = await lstat(destination)
    if (!existing.isSymbolicLink()) {
      throw new Error(
        `Sockeye build link refused at ${destination}; an existing non-symlink file is present.`,
      )
    }
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error
    }
  }

  const temporaryLink = path.join(directory, `.sockeye-${randomUUID()}.link`)
  await symlink(absoluteBinaryPath, temporaryLink)
  try {
    await rename(temporaryLink, destination)
  } catch (error) {
    await safeDelete(temporaryLink, { allowedDirs: [directory] })
    throw error
  }
  return destination
}

import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { lstat, mkdir, rename, symlink } from 'node:fs/promises'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  getInstalledSockeyeBinaryPath,
  getShellSockeyeBinaryPath,
} from './paths.mts'

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

  return await replaceSockeyeLink(absoluteBinaryPath, destination)
}

async function replaceSockeyeLink(
  source: string,
  destination: string,
): Promise<string> {
  const directory = path.dirname(destination)
  await mkdir(directory, { recursive: true })
  const temporaryLink = path.join(directory, `.sockeye-${randomUUID()}.link`)
  await symlink(source, temporaryLink)
  try {
    await rename(temporaryLink, destination)
  } catch (error) {
    await safeDelete(temporaryLink, { allowedDirs: [directory] })
    throw error
  }
  return destination
}

export async function wireSockeyeBuild(
  binaryPath: string,
  homeDirectory?: string,
): Promise<{ installedPath: string; shellPath: string }> {
  const installedPath = getInstalledSockeyeBinaryPath(homeDirectory)
  const shellPath = getShellSockeyeBinaryPath(homeDirectory)
  await linkSockeyeBuild(binaryPath, { destination: installedPath })
  let existing: Stats | undefined
  try {
    existing = await lstat(shellPath)
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error
  }
  if (existing && !existing.isSymbolicLink()) {
    const verified = existing.isFile()
      ? await spawn(
          'codesign',
          [
            '--verify',
            '--strict',
            '-R',
            'identifier "dev.socket.sockeye"',
            shellPath,
          ],
          { stdio: 'pipe', throws: false },
        )
      : undefined
    if (verified?.code !== 0) {
      throw new Error(
        `Sockeye PATH link refused at ${shellPath}: the existing file is not a verified Sockeye executable. Move that file and run pnpm build again.`,
      )
    }
  }
  await replaceSockeyeLink(installedPath, shellPath)
  return { installedPath, shellPath }
}

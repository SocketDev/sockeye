import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { linkSockeyeBuild } from '../../../scripts/repo/build-link.mts'

const scratchDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    scratchDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { force: true, recursive: true })),
  )
})

async function makeScratchDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'sockeye-build-link-'),
  )
  scratchDirectories.push(directory)
  return directory
}

test('creates the managed Sockeye path when it is missing', async () => {
  const root = await makeScratchDirectory()
  const binary = path.join(root, 'build', 'sockeye')
  const destination = path.join(root, '.socket', 'bin', 'sockeye')
  await fs.mkdir(path.dirname(binary), { recursive: true })
  await fs.writeFile(binary, 'new build')

  await linkSockeyeBuild(binary, { destination })

  await expect(fs.readlink(destination)).resolves.toBe(binary)
})

test('points the managed Sockeye path to the latest local build', async () => {
  const root = await makeScratchDirectory()
  const binary = path.join(root, 'build', 'sockeye')
  const destination = path.join(root, '.socket', 'bin', 'sockeye')
  await fs.mkdir(path.dirname(binary), { recursive: true })
  await fs.writeFile(binary, 'new build')
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.symlink('/old/install/sockeye', destination)

  await expect(linkSockeyeBuild(binary, { destination })).resolves.toBe(
    destination,
  )
  await expect(fs.readlink(destination)).resolves.toBe(binary)
})

test('refuses to replace an existing regular file', async () => {
  const root = await makeScratchDirectory()
  const binary = path.join(root, 'build', 'sockeye')
  const destination = path.join(root, '.socket', 'bin', 'sockeye')
  await fs.mkdir(path.dirname(binary), { recursive: true })
  await fs.writeFile(binary, 'new build')
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(destination, 'user file')

  await expect(linkSockeyeBuild(binary, { destination })).rejects.toThrow(
    'existing non-symlink file is present',
  )
  await expect(fs.readFile(destination, 'utf8')).resolves.toBe('user file')
})

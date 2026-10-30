import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import {
  linkSockeyeBuild,
  wireSockeyeBuild,
} from '../../../scripts/repo/build-link.mts'

const { verifyCodesign } = vi.hoisted(() => ({
  verifyCodesign: vi.fn(async () => ({ code: 0 })),
}))
vi.mock('@socketsecurity/lib-stable/process/spawn/child', () => ({
  spawn: verifyCodesign,
}))

const scratchDirectories: string[] = []

afterEach(async () => {
  verifyCodesign.mockReset()
  verifyCodesign.mockResolvedValue({ code: 0 })
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

test('keeps the PATH command pointed at the current build across rebuilds', async () => {
  const root = await makeScratchDirectory()
  const first = path.join(root, 'first-build')
  const second = path.join(root, 'second-build')
  await fs.writeFile(first, 'first build')
  await fs.writeFile(second, 'second build')
  const links = await wireSockeyeBuild(first, root)
  await expect(fs.readlink(links.shellPath)).resolves.toBe(links.installedPath)
  await expect(fs.realpath(links.shellPath)).resolves.toBe(first)
  await wireSockeyeBuild(second, root)
  await expect(fs.realpath(links.shellPath)).resolves.toBe(second)
  expect(verifyCodesign).not.toHaveBeenCalled()
})

test('replaces a stale verified Sockeye PATH executable with the managed link', async () => {
  const root = await makeScratchDirectory()
  const binary = path.join(root, 'current-build')
  const shellPath = path.join(root, '.local', 'bin', 'sockeye')
  await fs.writeFile(binary, 'current build')
  await fs.mkdir(path.dirname(shellPath), { recursive: true })
  await fs.writeFile(shellPath, 'old Sockeye fixture')
  await wireSockeyeBuild(binary, root)
  await expect(fs.realpath(shellPath)).resolves.toBe(binary)
  expect(verifyCodesign).toHaveBeenCalledWith(
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
})

test('preserves a foreign regular file at the PATH destination', async () => {
  const root = await makeScratchDirectory()
  const binary = path.join(root, 'current-build')
  const shellPath = path.join(root, '.local', 'bin', 'sockeye')
  await fs.writeFile(binary, 'current build')
  await fs.mkdir(path.dirname(shellPath), { recursive: true })
  await fs.writeFile(shellPath, 'user command')
  verifyCodesign.mockResolvedValue({ code: 1 })
  await expect(wireSockeyeBuild(binary, root)).rejects.toThrow()
  await expect(fs.readFile(shellPath, 'utf8')).resolves.toBe('user command')
})

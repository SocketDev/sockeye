import { existsSync, promises as fs } from 'node:fs'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

interface CurlArchiveFiles {
  archivePath: string
  versionFile: string
}

export async function discardCurlArchive(
  config: CurlArchiveFiles,
): Promise<void> {
  const { archivePath, versionFile } = {
    __proto__: null,
    ...config,
  } as CurlArchiveFiles
  await safeDelete(archivePath)
  if (existsSync(versionFile)) {
    await safeDelete(versionFile)
  }
}

export async function validateCurlArchiveHeader(
  config: CurlArchiveFiles,
): Promise<void> {
  const { archivePath } = { __proto__: null, ...config } as CurlArchiveFiles
  if (!existsSync(archivePath)) {
    throw new Error(
      `Downloaded archive not found at expected path: ${archivePath}`,
    )
  }
  // oxlint-disable-next-line socket/prefer-exists-sync -- size log
  const archiveStats = await fs.stat(archivePath)
  logger.info(
    `Archive size: ${(archiveStats.size / 1024 / 1024).toFixed(2)} MB`,
  )
  const gzipMagic = Buffer.alloc(2)
  const fd = await fs.open(archivePath, 'r')
  try {
    await fd.read(gzipMagic, 0, 2, 0)
  } finally {
    await fd.close()
  }
  if (gzipMagic[0] !== 0x1f || gzipMagic[1] !== 0x8b) {
    await discardCurlArchive(config)
    throw new Error(
      'Downloaded archive is not a valid gzip file (missing magic bytes). ' +
        `File may be corrupted or truncated. Deleted ${archivePath} to force re-download.`,
    )
  }
}

export async function validateCurlChecksum(
  config: CurlArchiveFiles & {
    result: {
      valid: boolean
      expected?: string | undefined
      actual?: string | undefined
    }
  },
): Promise<void> {
  const { archivePath, result } = {
    __proto__: null,
    ...config,
  } as typeof config
  if (!result.valid) {
    await discardCurlArchive(config)
    throw new Error(
      'Archive checksum mismatch - file is corrupted.\n' +
        `  Expected: ${result.expected}\n` +
        `  Actual:   ${result.actual}\n` +
        `Deleted ${archivePath} to force re-download.`,
    )
  }
  if (result.actual) {
    logger.info(
      `Checksum verified: ${result.actual.slice(0, 16)}...${result.actual.slice(-8)}`,
    )
  }
}

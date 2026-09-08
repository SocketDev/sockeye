import { existsSync, promises as fs } from 'node:fs'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { verifyReleaseChecksum } from '../../../scripts/fleet/build-infra/lib/release-checksums/core.mts'

const logger = getDefaultLogger()

export async function discardPrebuiltArchive(config: {
  downloadedArchive: string
  versionFile: string
}): Promise<void> {
  const { downloadedArchive, versionFile } = {
    __proto__: null,
    ...config,
  } as typeof config
  await safeDelete(downloadedArchive)
  if (existsSync(versionFile)) {
    await safeDelete(versionFile)
  }
}

export async function verifyPrebuiltArchive(config: {
  downloadedArchive: string
  versionFile: string
  assetName: string
  tempDir: string
  tool: string
}): Promise<void> {
  const { downloadedArchive, versionFile, assetName, tempDir, tool } = {
    __proto__: null,
    ...config,
  } as typeof config
  // Verify tarball integrity via gzip magic bytes — catches
  // truncated downloads before the checksum stage.
  const fd = await fs.open(downloadedArchive, 'r')
  const gzipMagic = Buffer.alloc(2)
  try {
    await fd.read(gzipMagic, 0, 2, 0)
  } finally {
    await fd.close()
  }
  if (gzipMagic[0] !== 0x1f || gzipMagic[1] !== 0x8b) {
    await discardPrebuiltArchive({ downloadedArchive, versionFile })
    throw new Error(
      'Downloaded archive is not a valid gzip file (missing magic bytes). ' +
        `File may be corrupted or truncated. Deleted ${downloadedArchive} to force re-download.`,
    )
  }

  // Verify SHA256 checksum — catches corrupted-but-magic-byte-valid
  // downloads.
  logger.info('Verifying archive checksum…')
  const checksumResult = await verifyReleaseChecksum({
    assetName,
    filePath: downloadedArchive,
    tempDir,
    tool,
  })
  if (!checksumResult.valid) {
    await discardPrebuiltArchive({ downloadedArchive, versionFile })
    throw new Error(
      'Archive checksum mismatch - file is corrupted.\n' +
        `  Expected: ${checksumResult.expected}\n` +
        `  Actual:   ${checksumResult.actual}\n` +
        `Deleted ${downloadedArchive} to force re-download.`,
    )
  }
  if (checksumResult.actual) {
    logger.info(
      `Checksum verified: ${checksumResult.actual.slice(0, 16)}...${checksumResult.actual.slice(-8)}`,
    )
  }
}

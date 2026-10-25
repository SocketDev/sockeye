import { statSync } from 'node:fs'
import { expect, test } from 'vitest'
import manifest from '../package.json' with { type: 'json' }
import * as canonicalCore from '../../../scripts/fleet/build/infra/lib/release-checksums/core.mts'
import * as canonicalProducer from '../../../scripts/fleet/build/infra/lib/release-checksums/producer.mts'

test.each(Object.entries(manifest.exports))(
  'package export %s resolves to an existing file',
  (specifier, target) => {
    expect(target.startsWith('./')).toBe(true)
    expect(
      statSync(new URL(target, new URL('../', import.meta.url))).isFile(),
      specifier,
    ).toBe(true)
  },
)

test('release checksum package exports preserve canonical function identities', async () => {
  const core = await import('local-build-infra/lib/release-checksums/core')
  const producer =
    await import('local-build-infra/lib/release-checksums/producer')
  expect(core.verifyReleaseChecksum).toBe(canonicalCore.verifyReleaseChecksum)
  expect(core.parseChecksums).toBe(canonicalCore.parseChecksums)
  expect(producer.writeChecksumsFile).toBe(canonicalProducer.writeChecksumsFile)
  expect(producer.updateReleaseAssets).toBe(
    canonicalProducer.updateReleaseAssets,
  )
})

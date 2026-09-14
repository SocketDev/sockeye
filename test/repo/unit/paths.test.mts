import path from 'node:path'

import { expect, test } from 'vitest'

import {
  RELEASE_BUNDLE_NAME,
  releaseAssetName,
  releaseBundleDirectoryPath,
  releaseBundlePath,
  releaseBundlePaths,
  releaseChecksumPath,
  releaseNotaryEvidencePaths,
  releaseNotaryWorkingPaths,
  releaseProfileInspectionPaths,
} from '../../../scripts/repo/paths.mts'

test('constructs every public release path from one archive reference', () => {
  const archive = path.join('/example', releaseAssetName('arm64'))
  expect(releaseChecksumPath(archive)).toBe(`${archive}.sha256`)
  expect(releaseNotaryEvidencePaths(archive)).toEqual({
    log: `${archive}.notary-log.json`,
    receipt: `${archive}.notary-receipt.json`,
    submission: `${archive}.notary-submission.zip`,
  })
})

test('constructs the bundle and its contents from one directory reference', () => {
  const binary = '/example/sockeye'
  const bundle = releaseBundlePath(binary)
  expect(bundle).toBe(releaseBundleDirectoryPath('/example'))
  expect(path.basename(bundle)).toBe(RELEASE_BUNDLE_NAME)
  expect(releaseBundlePaths(bundle)).toEqual({
    binary: '/example/sockeye.app/Contents/MacOS/sockeye',
    contents: '/example/sockeye.app/Contents',
    info: '/example/sockeye.app/Contents/Info.plist',
    profile: '/example/sockeye.app/Contents/embedded.provisionprofile',
  })
})

test('keeps temporary notarization output beside the final archive', () => {
  const output = '/example/sockeye-darwin-arm64.zip'
  expect(releaseNotaryWorkingPaths(output, 'example-nonce')).toEqual({
    finalArchive: '/example/.sockeye-darwin-arm64.zip.example-nonce.zip',
    finalSidecar: '/example/.sockeye-darwin-arm64.zip.example-nonce.zip.sha256',
    unresolved: `${output}.notary-unresolved.json`,
  })
})

test('keeps profile inspection files in one temporary directory', () => {
  expect(releaseProfileInspectionPaths('/example/inspection')).toEqual({
    plist: '/example/inspection/profile.plist',
  })
})

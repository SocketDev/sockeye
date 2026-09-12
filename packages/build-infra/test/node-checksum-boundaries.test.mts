import { beforeEach, expect, test, vi } from 'vitest'
import { httpText } from '@socketsecurity/lib-stable/http-request'
import { getSubmoduleChecksum } from '../lib/submodule-version.mts'
import {
  fetchNodeChecksum,
  parseShasums,
  verifyNodeChecksum,
} from '../lib/node-checksum.mts'

vi.mock(import('@socketsecurity/lib-stable/http-request'), () => ({
  httpText: vi.fn(),
}))
vi.mock(import('../lib/submodule-version.mts'), () => ({
  getSubmoduleChecksum: vi.fn(),
  getSubmoduleVersion: () => '26.0.0',
}))

beforeEach(() => {
  vi.resetAllMocks()
})

test('rejects a checksum listing without the requested source archive', async () => {
  vi.mocked(httpText).mockResolvedValue(`${'1'.repeat(64)}  unrelated.tar.gz`)
  const result = await fetchNodeChecksum('26.0.0')
  expect(result).toHaveProperty('error')
  expect(result).not.toHaveProperty('hash')
  expect(httpText).toHaveBeenCalledWith(
    'https://nodejs.org/dist/v26.0.0/SHASUMS256.txt',
    {
      headers: { 'accept-encoding': 'identity' },
      timeout: 10_000,
    },
  )
})

test('ignores malformed digest records while accepting GNU binary markers', () => {
  const digest = '2'.repeat(64)
  expect(
    parseShasums(
      `\n# checksum fixture\ninvalid archive.tar.gz\n${digest} *source.tar.gz\n${digest}  too many fields\n`,
    ),
  ).toEqual({ 'source.tar.gz': digest })
})

test('refuses verification without a stored checksum before making a request', async () => {
  vi.mocked(getSubmoduleChecksum).mockReturnValue(undefined)
  expect(await verifyNodeChecksum()).toEqual(
    expect.objectContaining({ valid: false, version: '26.0.0' }),
  )
  expect(httpText).not.toHaveBeenCalled()
})

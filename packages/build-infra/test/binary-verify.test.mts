import { expect, test } from 'vitest'
import { verifyBinaryFormat } from '../lib/binary-verify.mts'

test.each([
  {
    info: 'ELF 64-bit x86-64 statically linked',
    arch: 'x64',
    platform: 'linux',
    valid: true,
  },
  { info: 'ELF 64-bit aarch64', arch: 'arm64', platform: 'linux', valid: true },
  {
    info: 'Mach-O 64-bit arm64',
    arch: 'arm64',
    platform: 'darwin',
    valid: true,
  },
  {
    info: 'PE32+ executable x86-64',
    arch: 'x64',
    platform: 'win32',
    valid: true,
  },
  { info: 'MS Windows x64', arch: 'x64', platform: 'win32', valid: true },
  { info: 'ELF 64-bit aarch64', arch: 'x64', platform: 'linux', valid: false },
  {
    info: 'Mach-O 64-bit x86-64',
    arch: 'x64',
    platform: 'linux',
    valid: false,
  },
  { info: 'ELF 64-bit x86-64', arch: 'x64', platform: 'darwin', valid: false },
  { info: 'ELF 64-bit x86-64', arch: 'x64', platform: 'win32', valid: false },
])(
  'validates target $platform/$arch against file output',
  ({ info, arch, platform, valid }) => {
    expect(verifyBinaryFormat(info, { arch, platform, static: true })).toBe(
      valid,
    )
  },
)

test('keeps static linking advisory and permits an unspecified architecture', () => {
  expect(
    verifyBinaryFormat('ELF dynamically linked', {
      arch: undefined,
      platform: 'linux',
      static: true,
    }),
  ).toBe(true)
})

test('keeps unknown target formats and architecture names unchecked', () => {
  expect(
    verifyBinaryFormat('example binary', {
      arch: 'example-arch',
      platform: 'example-platform',
      static: undefined,
    }),
  ).toBe(true)
})

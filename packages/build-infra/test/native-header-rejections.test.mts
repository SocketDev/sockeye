import { expect, test } from 'vitest'
import {
  validateNativeBinary,
  validateNativeTarget,
} from '../lib/native-release-binary.mts'

test('rejects unsupported target metadata before inspecting binary bytes', () => {
  expect(() => validateNativeTarget('unsupported-target', 'fixture')).toThrow()
  expect(() =>
    validateNativeBinary(Buffer.alloc(1024), 'unsupported-target', 'fixture'),
  ).toThrow()
})

test('rejects truncated and unrecognized binaries', () => {
  expect(() =>
    validateNativeBinary(Buffer.alloc(999), 'linux-x64', 'fixture'),
  ).toThrow()
  expect(() =>
    validateNativeBinary(Buffer.alloc(1024), 'linux-x64', 'fixture'),
  ).toThrow()
})

test.each([1020, 128])('rejects invalid PE header at offset %s', offset => {
  const bytes = Buffer.alloc(1024)
  bytes.write('MZ')
  bytes.writeUInt32LE(offset, 0x3c)
  expect(() => validateNativeBinary(bytes, 'win32-x64', 'fixture')).toThrow()
})

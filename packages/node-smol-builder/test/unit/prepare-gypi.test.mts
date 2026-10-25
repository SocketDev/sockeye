import { beforeEach, expect, test, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { generateVendoredGypi } from '../../scripts/binary-released/shared/prepare-gypi.mts'
const io = vi.hoisted(() => ({ exists: vi.fn(), readdir: vi.fn() }))
vi.mock(import('node:fs'), async original => ({
  ...(await original()),
  existsSync: io.exists,
  promises: {
    ...(await original()).promises,
    readdir: io.readdir,
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  },
}))
vi.mock(import('../../scripts/binary-released/shared/paths.mts'), () => ({
  ADDITIONS_SOURCE_PATCHED_DIR: '/example/additions',
}))
function requireWrittenText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Expected generated manifest text in writeFile call')
  }
  return value
}
function entry(name: string, kind: 'file' | 'directory' | 'link' = 'file') {
  return {
    name,
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  io.exists.mockReturnValue(true)
  io.readdir.mockResolvedValue([])
})
test('does not emit manifests for absent, empty or unreadable source trees', async () => {
  io.exists.mockReturnValue(false)
  await generateVendoredGypi()
  expect(io.readdir).not.toHaveBeenCalled()
  io.exists.mockReturnValue(true)
  await generateVendoredGypi()
  io.readdir.mockRejectedValue(new Error('fixture unreadable directory'))
  await generateVendoredGypi()
  expect(fs.writeFile).not.toHaveBeenCalled()
})
test('emits sorted relative source paths, excluding headers, links, test sources and certificate blobs', async () => {
  io.readdir.mockImplementation(async directory => {
    if (directory.endsWith('/test')) {
      return [entry('fixture-test.c'), entry('fixture-test.cpp')]
    }
    if (directory.endsWith('/nested')) {
      return [entry('first.cpp')]
    }
    if (directory.endsWith('/yoga')) {
      return [
        entry('last.cpp'),
        entry('nested', 'directory'),
        entry('test', 'directory'),
        entry('header.h'),
        entry('link.cpp', 'link'),
      ]
    }
    if (directory.endsWith('/liblsquic')) {
      return [
        entry('transport.c'),
        entry('common_cert_set_2.c'),
        entry('common_cert_set_3.c'),
        entry('test', 'directory'),
      ]
    }
    if (directory.endsWith('/ls-qpack')) {
      return [entry('lsqpack.c')]
    }
    if (directory.endsWith('/lshpack')) {
      return [entry('lshpack.c')]
    }
    return []
  })
  await generateVendoredGypi()
  expect(fs.writeFile).toHaveBeenCalledTimes(4)
  const writes = vi.mocked(fs.writeFile).mock.calls
  const yoga = requireWrittenText(
    writes.find(call => call[0] === '/example/additions/deps/yoga.gypi')?.[1],
  )
  expect(yoga).toContain("'yoga/last.cpp'")
  expect(yoga).toContain("'yoga/nested/first.cpp'")
  expect(yoga.indexOf("'yoga/last.cpp'")).toBeLessThan(
    yoga.indexOf("'yoga/nested/first.cpp'"),
  )
  expect(yoga).not.toContain('fixture-test')
  expect(yoga).not.toContain('header.h')
  expect(yoga).not.toContain('link.cpp')
  const quic = requireWrittenText(
    writes.find(call => call[0] === '/example/additions/deps/lsquic.gypi')?.[1],
  )
  expect(quic).toContain("'lsquic/src/liblsquic/transport.c'")
  expect(quic).not.toContain('common_cert_set')
  expect(quic).not.toContain('fixture-test')
  expect(quic).toContain("'HAVE_BORINGSSL'")
  expect(quic).toContain("'-Wno-error=extra-semi'")
  const hpack = requireWrittenText(
    writes.find(
      call => call[0] === '/example/additions/deps/lshpack.gypi',
    )?.[1],
  )
  expect(hpack).toContain("'XXH_INLINE_ALL'")
  expect(hpack).toContain('\'XXH_HEADER_NAME="xxhash.h"\'')
  expect(fs.mkdir).toHaveBeenCalledWith('/example/additions/deps', {
    recursive: true,
  })
})

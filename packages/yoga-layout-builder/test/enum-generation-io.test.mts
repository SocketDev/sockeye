import { beforeEach, expect, test, vi } from 'vitest'
import {
  generateEnumsFile,
  parseEnumHeader,
  stampWrapAssemblyVersion,
} from '../scripts/source-cloned/shared/generate-enums.mts'
const io = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), mkdir: vi.fn() }))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: io.read,
      writeFile: io.write,
      mkdir: io.mkdir,
    },
  }
})
beforeEach(() => vi.resetAllMocks())

test('enum generation writes parsed numeric constants after creating the output directory', async () => {
  io.read.mockResolvedValue(
    'YG_ENUM_DECL(YGExample, YGExampleLast = 0x10, YGExampleFirst = -2, YGExampleNext)',
  )
  const result = await generateEnumsFile(
    '/example/YGEnums.h',
    '/example/generated/enums.mts',
    '3.2.1',
  )
  expect(result).toContain('First: -2')
  expect(result).toContain('Next: -1')
  expect(result).toContain('Last: 16')
  expect(result.indexOf('First:')).toBeLessThan(result.indexOf('Last:'))
  expect(io.mkdir).toHaveBeenCalledWith('/example/generated', {
    recursive: true,
  })
  expect(io.mkdir).toHaveBeenCalledBefore(io.write)
  expect(io.write).toHaveBeenCalledWith(
    '/example/generated/enums.mts',
    result,
    'utf8',
  )
})

test('enum generation rejects missing declarations without writing artifacts', async () => {
  io.read.mockResolvedValue('YG_ENUM_DECL(YGEmpty)')
  await expect(
    generateEnumsFile('/example/YGEnums.h', '/example/enums.mts', '3.2.1'),
  ).rejects.toBeInstanceOf(Error)
  expect(io.write).not.toHaveBeenCalled()
})

test('enum parsing rejects nonfinite values and implicit int32 overflow', () => {
  expect(() =>
    parseEnumHeader(
      `YG_ENUM_DECL(YGExample, YGExampleHuge = ${'9'.repeat(400)})`,
    ),
  ).toThrow(Error)
  expect(() =>
    parseEnumHeader(
      'YG_ENUM_DECL(YGExample, YGExampleMaximum = 2147483647, YGExampleOverflow)',
    ),
  ).toThrow(Error)
})

test('version stamping updates only the upstream marker and is idempotent', async () => {
  const source =
    '// Lock-step from upstream: yoga/javascript/src/wrapAssembly.ts @ yoga 3.2.0\nexport const example = 42\n'
  io.read.mockResolvedValue(source)
  expect(
    await stampWrapAssemblyVersion('/example/wrapAssembly.mts', '3.2.1'),
  ).toBe(true)
  const expected = source.replace('3.2.0', '3.2.1')
  expect(io.write).toHaveBeenCalledWith(
    '/example/wrapAssembly.mts',
    expected,
    'utf8',
  )
  io.read.mockResolvedValue(expected)
  io.write.mockClear()
  expect(
    await stampWrapAssemblyVersion('/example/wrapAssembly.mts', '3.2.1'),
  ).toBe(false)
  expect(io.write).not.toHaveBeenCalled()
})

test('version stamping refuses a missing provenance marker', async () => {
  io.read.mockResolvedValue('export const example = 42')
  await expect(
    stampWrapAssemblyVersion('/example/wrapAssembly.mts', '3.2.1'),
  ).rejects.toBeInstanceOf(Error)
  expect(io.write).not.toHaveBeenCalled()
})

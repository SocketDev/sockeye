import { beforeEach, expect, test, vi } from 'vitest'
import { validateOnnxFile, validateOnnxFiles } from '../lib/onnx-validation.mts'
const io = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock(import('node:fs'), async original => {
  const actual = await original()
  return { ...actual, promises: { ...actual.promises, readFile: io.read } }
})
beforeEach(() => vi.resetAllMocks())

test.each([0x08, 0x0a])(
  'accepts model protobuf header %s at the minimum size',
  async magic => {
    const bytes = Buffer.alloc(100)
    bytes[0] = magic
    io.read.mockResolvedValue(bytes)
    await expect(
      validateOnnxFile('/example/model.onnx'),
    ).resolves.toBeUndefined()
    expect(io.read).toHaveBeenCalledWith('/example/model.onnx')
  },
)

test('rejects undersized files and invalid protobuf headers', async () => {
  io.read.mockResolvedValue(Buffer.alloc(99, 0x08))
  await expect(
    validateOnnxFile('/example/encoder.onnx', 'encoder'),
  ).rejects.toBeInstanceOf(Error)
  io.read.mockResolvedValue(Buffer.alloc(100, 0xff))
  await expect(
    validateOnnxFile('/example/decoder.onnx', 'decoder'),
  ).rejects.toBeInstanceOf(Error)
})

test('single model read failures preserve their original cause', async () => {
  const failure = Object.assign(new Error('fixture missing model'), {
    code: 'ENOENT',
  })
  io.read.mockRejectedValue(failure)
  await expect(validateOnnxFile('/example/model.onnx')).rejects.toBe(failure)
})

test('batch validation checks every model before reporting failure', async () => {
  io.read
    .mockResolvedValueOnce(Buffer.alloc(100, 0x08))
    .mockResolvedValueOnce(Buffer.alloc(10))
    .mockRejectedValueOnce(
      Object.assign(new Error('fixture denied model'), { code: 'EACCES' }),
    )
  await expect(
    validateOnnxFiles([
      { path: '/example/encoder.onnx', type: 'encoder' },
      { path: '/example/decoder.onnx', type: 'decoder' },
      { path: '/example/embedding.onnx', type: 'embedding' },
    ]),
  ).rejects.toBeInstanceOf(Error)
  expect(io.read.mock.calls.map(call => call[0])).toEqual([
    '/example/encoder.onnx',
    '/example/decoder.onnx',
    '/example/embedding.onnx',
  ])
})

test('batch validation accepts valid and empty model sets', async () => {
  await expect(validateOnnxFiles([])).resolves.toBeUndefined()
  io.read.mockResolvedValue(Buffer.alloc(100, 0x08))
  await expect(
    validateOnnxFiles([{ path: '/example/encoder.onnx', type: 'encoder' }]),
  ).resolves.toBeUndefined()
})

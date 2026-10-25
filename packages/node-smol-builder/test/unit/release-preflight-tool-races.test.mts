import { beforeEach, expect, test, vi } from 'vitest'
import { checkRequiredTools } from '../../scripts/binary-released/shared/preflight-checks.mts'
const io = vi.hoisted(() => ({
  which: vi.fn(),
  instructions: vi.fn(),
  error: vi.fn(),
  tools: vi.fn(),
}))
vi.mock(import('node:process'), async original => {
  const actual = await original()
  return { ...actual, default: { ...actual.default, platform: 'linux' } }
})
vi.mock(import('local-build-infra/lib/tool-installer'), () => ({
  ensureAllToolsInstalled: io.tools,
  ensurePackageManagerAvailable: async () => ({
    available: true,
    installed: false,
    manager: 'apt',
  }),
  getInstallInstructions: io.instructions,
  getPackageManagerInstructions: () => [],
}))
vi.mock(import('local-build-infra/lib/build-output'), () => ({
  printError: io.error,
}))
vi.mock(
  import('@socketsecurity/lib-stable/exe/path/which'),
  async original => ({ ...(await original()), whichSync: io.which }),
)
beforeEach(() => {
  vi.resetAllMocks()
  io.tools.mockResolvedValue({ allAvailable: true, installed: [], missing: [] })
  io.instructions.mockReturnValue(['example install instructions'])
})

test('a manual tool installed between probes no longer blocks the build', async () => {
  // oxlint-disable-next-line socket/prefer-undefined-over-null -- whichSync returns null when no executable is found.
  io.which.mockReturnValueOnce(null).mockReturnValue('/example/strip')
  await expect(
    checkRequiredTools({ arch: 'x64', autoYes: false }),
  ).resolves.toBeUndefined()
  expect(io.which).toHaveBeenCalledTimes(2)
  expect(io.error).not.toHaveBeenCalled()
})

test('Linux missing-tool instructions do not suggest Xcode installation', async () => {
  // oxlint-disable-next-line socket/prefer-undefined-over-null -- whichSync returns null when no executable is found.
  io.which.mockReturnValue(null)
  await expect(
    checkRequiredTools({ arch: 'x64', autoYes: false }),
  ).rejects.toThrow()
  expect(io.instructions).toHaveBeenCalledExactlyOnceWith('strip')
  const instructions = io.error.mock.calls[0]?.[2]
  expect(instructions).toContain('example install instructions')
  expect(instructions).not.toContain('  xcode-select --install')
})

import { beforeEach, expect, test, vi } from 'vitest'
import {
  checkGitHubStatus,
  isTransientError,
  logTransientErrorHelp,
  parseGitHubServiceStatus,
} from '../lib/github-error-utils.mts'
const io = vi.hoisted(() => ({ request: vi.fn(), warn: vi.fn() }))
vi.mock(import('@socketsecurity/lib-stable/http-request/request'), () => ({
  httpRequest: io.request,
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({ warn: io.warn }),
}))
beforeEach(() => vi.resetAllMocks())

test('status reports preserve service state and provide defaults for incomplete responses', async () => {
  io.request.mockResolvedValue({
    ok: true,
    json: async () => ({
      status: { indicator: 'minor', description: 'Example degradation' },
    }),
  })
  expect(await checkGitHubStatus()).toEqual({
    status: 'minor',
    description: 'Example degradation',
    url: 'https://www.githubstatus.com',
  })
  expect(io.request).toHaveBeenCalledWith(
    'https://www.githubstatus.com/api/v2/status.json',
    { timeout: 5000 },
  )
  io.request.mockResolvedValue({ ok: true, json: async () => ({}) })
  expect(await checkGitHubStatus()).toEqual({
    status: 'unknown',
    description: 'Unknown status',
    url: 'https://www.githubstatus.com',
  })
})

test('status lookup failures never replace the original diagnostic', async () => {
  io.request.mockResolvedValue({ ok: false })
  expect(await checkGitHubStatus()).toBeUndefined()
  io.request.mockRejectedValue(
    Object.assign(new Error('fixture network failure'), { code: 'ECONNRESET' }),
  )
  expect(await checkGitHubStatus()).toBeUndefined()
  io.request.mockResolvedValue({
    ok: true,
    json: async () => {
      throw new SyntaxError('fixture invalid JSON')
    },
  })
  expect(await checkGitHubStatus()).toBeUndefined()
})

test.each([
  'HTTP 408',
  'HTTP 429',
  'HTTP 502',
  'HTTP 503',
  'Bad Gateway',
  'Service Unavailable',
  'Gateway Timeout',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'socket hang up',
])('classifies transient failure %s', message => {
  expect(isTransientError(new Error(message))).toBe(true)
})

test('nontransient errors do not produce retry advice or status requests', async () => {
  expect(isTransientError('HTTP 404')).toBe(false)
  await logTransientErrorHelp(new Error('invalid configuration'))
  expect(io.request).not.toHaveBeenCalled()
  expect(io.warn).not.toHaveBeenCalled()
})

test('retry advice can skip status lookup explicitly', async () => {
  await logTransientErrorHelp(new Error('HTTP 503'), { checkStatus: false })
  expect(io.request).not.toHaveBeenCalled()
  expect(io.warn).toHaveBeenCalledWith('Recommended action: Re-run the CI job.')
})

test.each([
  { status: 'none', label: 'operational' },
  { status: 'minor', label: 'degraded' },
  { status: 'major', label: 'major issue' },
])(
  'labels service state $status in retry advice',
  async ({ status, label }) => {
    io.request.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: { indicator: status, description: 'Example service state' },
      }),
    })
    await logTransientErrorHelp(new Error('HTTP 503'))
    expect(io.warn).toHaveBeenCalledWith(
      `GitHub Status: ${label} - Example service state`,
    )
  },
)

test('retry advice remains available when status lookup fails', async () => {
  io.request.mockRejectedValue(
    Object.assign(new Error('fixture timeout'), { code: 'ETIMEDOUT' }),
  )
  await logTransientErrorHelp(new Error('HTTP 503'))
  expect(io.warn).toHaveBeenCalledWith('Recommended action: Re-run the CI job.')
})

test.each([
  undefined,
  42,
  { status: 'invalid' },
  { status: { indicator: 42, description: false } },
  { status: { indicator: '', description: '' } },
])('status parsing rejects non-string service fields: %j', data => {
  expect(parseGitHubServiceStatus(data)).toEqual({
    status: 'unknown',
    description: 'Unknown status',
    url: 'https://www.githubstatus.com',
  })
})

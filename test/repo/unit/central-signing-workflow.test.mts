import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { parse } from 'yaml'

test('scopes draft inspection to the request step and Sockeye release', () => {
  const workflow = parse(
    readFileSync('.github/workflows/verify-central-signing.yml', 'utf8'),
  ) as {
    permissions: Record<string, string>
    jobs: Record<
      string,
      {
        permissions: Record<string, string>
        steps: Array<{
          id?: string
          name?: string
          uses?: string
          with?: Record<string, string>
          env?: Record<string, string>
        }>
      }
    >
  }
  const job = workflow.jobs.request!
  expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read' })
  const buildIndex = job.steps.findIndex(
    step => step.name === 'Build the unsigned executable',
  )
  const draftIndex = job.steps.findIndex(step => step.id === 'draft-reader')
  const uploadIndex = job.steps.findIndex(
    step => step.name === 'Upload source-bound signing request',
  )
  expect(buildIndex).toBeGreaterThanOrEqual(0)
  expect(draftIndex).toBeGreaterThan(buildIndex)
  expect(draftIndex).toBe(uploadIndex - 1)
  const draft = job.steps[draftIndex]!
  expect(draft.uses).toBe('./.github/actions/fleet/github-release-app-token')
  expect(draft.with).toEqual({
    'client-id':
      '${{ secrets.SOCKET_RELEASE_CLIENT_ID || vars.SOCKET_RELEASE_CLIENT_ID }}',
    'private-key': '${{ secrets.SOCKET_RELEASE_APP_PRIVATE_KEY }}',
    owner: 'SocketDev',
    repositories: 'sockeye',
  })
  const upload = job.steps[uploadIndex]!
  expect(upload.env?.GH_TOKEN).toBe('${{ github.token }}')
  expect(upload.env?.SIGNING_DRAFT_READ_TOKEN).toBe(
    '${{ steps.draft-reader.outputs.token }}',
  )
  for (const [index, step] of job.steps.entries()) {
    if (index !== uploadIndex) {
      expect(step.env ?? {}).not.toHaveProperty('SIGNING_DRAFT_READ_TOKEN')
    }
  }
})

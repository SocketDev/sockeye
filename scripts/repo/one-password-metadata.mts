import childProcess from 'node:child_process'
import process from 'node:process'

export interface OnePasswordChoice {
  name: string
  value: string
}

export interface OnePasswordSelection {
  account: string
  reference: string
}

export interface OnePasswordPrompts {
  authorize(account: string): Promise<void>
  choose(message: string, choices: OnePasswordChoice[]): Promise<unknown>
  field(message: string): Promise<unknown>
}

export function onePasswordEnvironment(
  options?: { account?: string | undefined } | undefined,
): NodeJS.ProcessEnv {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  const account = opts.account
  const env = { ...process.env }
  const keys = Object.keys(env)
  for (let index = 0, { length } = keys; index < length; index += 1) {
    const key = keys[index]!
    if (key.startsWith('OP_')) {
      delete env[key]
    }
  }
  if (account) {
    env['OP_ACCOUNT'] = account
  }
  env['OP_BIOMETRIC_UNLOCK_ENABLED'] = 'true'
  return env
}

export async function readOnePasswordMetadata(
  executable: string,
  args: string[],
): Promise<unknown> {
  if (
    !['account', 'vault', 'item'].includes(args[0] ?? '') ||
    args[1] !== 'list' ||
    args.at(-2) !== '--format' ||
    args.at(-1) !== 'json'
  ) {
    throw new Error(
      '1Password metadata access permits only JSON list commands.',
    )
  }
  for (let index = 2; index < args.length - 2; index += 2) {
    if (
      !['--account', '--vault'].includes(args[index] ?? '') ||
      !/^[a-zA-Z0-9_-]+$/.test(args[index + 1] ?? '')
    ) {
      throw new Error('1Password metadata scope arguments are invalid.')
    }
  }
  return await new Promise((resolve, reject) => {
    childProcess.execFile(
      executable,
      args,
      {
        env: onePasswordEnvironment(),
        encoding: 'utf8',
        maxBuffer: 1_048_576,
        timeout: 30_000,
      },
      (error, stdout) => {
        if (error) {
          reject(
            new Error(
              '1Password metadata lookup failed. Unlock the desktop app and retry.',
            ),
          )
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch {
          reject(
            new Error(
              '1Password returned invalid metadata. Update its CLI and retry.',
            ),
          )
        }
      },
    )
  })
}

function metadataText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  )
}

function isOnePasswordMetadataRow(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCredentialLabel(value: string): string {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)
    .join(' ')
}

function credentialLabelScore(label: string, credentialName: string): number {
  const target = normalizeCredentialLabel(credentialName)
  if (!target) {
    return 0
  }
  const normalized = normalizeCredentialLabel(label)
  const tokens = new Set(target.split(' '))
  if (normalized === target) {
    return tokens.size + 2
  }
  if (` ${normalized} `.includes(` ${target} `)) {
    return tokens.size + 1
  }
  const labelTokens = new Set(normalized.split(' '))
  return [...tokens].filter(token => labelTokens.has(token)).length
}

export function onePasswordChoices(
  value: unknown,
  kind: 'account' | 'vault' | 'item',
  options?: { credentialName?: string | undefined } | undefined,
): OnePasswordChoice[] {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new Error('1Password metadata list is invalid or too large.')
  }
  const choices = value.map((entry: unknown) => {
    if (!isOnePasswordMetadataRow(entry)) {
      throw new Error('1Password metadata entry is invalid.')
    }
    const row = entry
    const id = kind === 'account' ? row['user_uuid'] : row['id']
    const name =
      kind === 'account'
        ? row['url']
        : kind === 'vault'
          ? row['name']
          : row['title']
    if (
      !metadataText(id) ||
      !/^[a-zA-Z0-9_-]+$/.test(id) ||
      !metadataText(name)
    ) {
      throw new Error('1Password metadata names or IDs are invalid.')
    }
    return {
      __proto__: null,
      choice: { __proto__: null, name: `${name} (${id})`, value: id },
      score:
        kind === 'item'
          ? credentialLabelScore(name, opts.credentialName ?? '')
          : 0,
    }
  })
  return choices
    .toSorted((left, right) => right.score - left.score)
    .map(entry => entry.choice)
}

export function onePasswordFieldReference(
  vault: string,
  item: string,
  field: string,
): string | undefined {
  if (![vault, item].every(value => /^[a-zA-Z0-9_-]+$/.test(value))) {
    return undefined
  }
  const segments = field.split('/')
  if (
    segments.length < 1 ||
    segments.length > 2 ||
    segments.some(segment => !metadataText(segment) || /[?#]/.test(segment))
  ) {
    return undefined
  }
  const reference = `op://${vault}/${item}/${segments.map(encodeURIComponent).join('/')}`
  return Buffer.byteLength(reference) <= 2048 ? reference : undefined
}

export async function selectOnePasswordReference(
  executable: string,
  prompts: OnePasswordPrompts,
  options?:
    | {
        credentialName?: string | undefined
        read?: typeof readOnePasswordMetadata | undefined
      }
    | undefined,
): Promise<OnePasswordSelection | undefined> {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  const read = opts.read ?? readOnePasswordMetadata
  async function choose(
    kind: 'account' | 'vault' | 'item',
    args: string[],
  ): Promise<string | undefined> {
    const choices = onePasswordChoices(
      await read(executable, [...args, '--format', 'json']),
      kind,
      { credentialName: opts.credentialName },
    )
    if (!choices.length) {
      throw new Error(
        `No 1Password ${kind} entries are available in the selected scope.`,
      )
    }
    const selected = await prompts.choose(
      `Select the 1Password ${kind}:`,
      choices,
    )
    return typeof selected === 'string' &&
      choices.some(choice => choice.value === selected)
      ? selected
      : undefined
  }
  const account = await choose('account', ['account', 'list'])
  if (!account) {
    return undefined
  }
  await prompts.authorize(account)
  const vault = await choose('vault', ['vault', 'list', '--account', account])
  if (!vault) {
    return undefined
  }
  const item = await choose('item', [
    'item',
    'list',
    '--account',
    account,
    '--vault',
    vault,
  ])
  if (!item) {
    return undefined
  }
  const field = await prompts.field(
    'Field name or section/field from 1Password (not its secret value):',
  )
  const reference =
    typeof field === 'string'
      ? onePasswordFieldReference(vault, item, field)
      : undefined
  if (!reference) {
    return undefined
  }
  return { account, reference }
}

# Sockeye command reference

Sockeye stores credentials in the macOS Keychain and releases them only to an
explicitly approved child process. Start credential setup and run commands
from an attached terminal so the human approval prompt is visible.

## Store and manage credentials

Store a value without echoing it:

```sh
sockeye set SOCKET_RELEASE_CLIENT_ID --binding <binding-id>
```

For a guided Keychain or one-time 1Password import, use
`pnpm run setup:credential`. Sockeye does not use 1Password as a runtime
credential provider.

Other commands include `sockeye import-1password`, `sockeye verify`, and
`sockeye delete`; each credential operation names the binding explicitly.
See the [credential setup guide](credential-setup.md) for attended setup and
recovery limits.

## Run a child process

`sockeye run` requires the credential names and binding, exact working
directory, absolute executable, and arguments. Use `--pass-env` for public
environment variables and `--bind-file` to bind required files into the
request:

```sh
sockeye run \
  --credential SOCKET_RELEASE_APP_PRIVATE_KEY --binding <binding-id> \
  --pass-env SOCKET_RELEASE_CLIENT_ID \
  --bind-file /absolute/path/to/runner.mjs \
  --cwd /absolute/path/to/repository \
  -- /absolute/path/to/node /absolute/path/to/runner.mjs
```

Sockeye prints the request and manifest digest before prompting for approval.
The child receives only requested credentials and explicitly passed
environment variables. `ENVRYPT_PRIVATE_KEY` uses Envrypt's one-use pipe
instead of the child environment.

## Local CI

Use the repository bridge to derive credential names from one workflow:

```sh
pnpm run ci:sockeye -- \
  run --workflow .github/workflows/github-release.yml \
  --var SOCKET_RELEASE_CLIENT_ID=example-release-client-id \
  --quiet --pause-on-failure --github-token
```

The bridge requests only secrets referenced by that workflow. Public variables
are supplied with `--var`. It rejects multi-workflow runs, secret overrides,
environment files, and generated gh-aw lock files. The bridge sees names and
public values; Sockeye displays the human approval prompt immediately before
launching the selected child.

## Diagnostics

- `sockeye doctor` checks installation and credential state; `--credential`
  and `--binding` limit the check to one binding.
- `sockeye capabilities` prints supported operating-system features.
- `sockeye explain` validates and displays the effective child request without
  releasing credential values to the caller.

For design details, see the [security model](security-model.md),
[threat model](threat-model.md), and [native development guide](native-development.md).

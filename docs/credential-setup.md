# Set up a credential

Sockeye stores credentials in the macOS Keychain. Each stored value is tied to
the current Touch ID enrollment and this Mac. It does not write a `.env` file,
print the secret, or offer a command that reads it back.

Run this from a real terminal after building Sockeye:

```sh
pnpm run setup:credential -- SOCKET_RELEASE_APP_PRIVATE_KEY
```

If the 1Password CLI is installed in a supported location, setup recommends
**Import once from 1Password**. Guided selection lists your accounts, vaults,
and items through the 1Password CLI. Account access can trigger 1Password's
approval prompt for your terminal. Select an item, then enter its field name
or section/field path. You can also enter an account and an explicit
`op://Vault/item/field` reference.

Setup shows the account, reference, and destination credential before import.
The native Sockeye process reads the selected value and stores it in Keychain.
The setup process lists metadata only; it does not read secret fields.
The selected account remains pinned during import. Service-account and Connect
environment settings cannot silently select another credential source.

When 1Password is unavailable, or when the credential is not stored there,
setup offers **macOS Keychain** entry instead. Choose it to type or paste a
value directly into the native CLI. The input is hidden and goes straight from
the terminal into locked native memory.

The 1Password option is deliberately an import, not a runtime provider. A
later `sockeye run` reads the Keychain item after Touch ID; it never expands an
`op://` reference or starts `op`. This means an Agent-CI manifest cannot turn
an arbitrary environment value into a 1Password read.

## What to expect

During direct entry, Touch ID authorizes storing the value. During an import,
you may see both the Sockeye Touch ID request and a 1Password request. That is
expected: they protect different operations.

You can safely cancel any prompt. No credential is stored until the native
command completes successfully. To replace a stored credential, run the same
setup command again. To remove it, use:

```sh
sockeye delete SOCKET_RELEASE_APP_PRIVATE_KEY
```

Use the built binary path if `sockeye` is not installed on your shell PATH.
Never put the private key in a shell command, an environment file, or a
workflow variable.

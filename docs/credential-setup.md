# Set up a credential

Sockeye stores credentials in the macOS Keychain. Each stored value is tied to
the current Touch ID enrollment and this Mac. It does not write a `.env` file,
print the secret, or offer a command that reads it back.

Run this from a real terminal after building Sockeye:

```sh
pnpm run setup:credential -- SOCKET_RELEASE_APP_PRIVATE_KEY
```

Add `--source one-password` to require an attended 1Password import. This mode
stops if the supported CLI is unavailable. It keeps account selection and
import confirmation. Canceled selection or confirmation returns exit code 130.

If the 1Password CLI is installed in a supported location, setup recommends
**Import once from 1Password**. Guided selection lists your accounts, vaults,
and items through the 1Password CLI. Search item names after selecting a vault.
The search checks metadata in that vault and shows at most 100 matching items. Account access can trigger 1Password's
approval prompt for your terminal. Select an item, then enter its field name
or section/field path. You can also enter an account and an explicit
`op://Vault/item/field` reference.

Setup shows the account, reference, and destination credential before import.
The native Sockeye process reads the selected value and stores it in Keychain.
The setup process lists metadata only; it does not read secret fields.
Successful imports save the account and field reference in private local state
under `~/.socket/_state/sockeye/one-password/`. These files contain no credential
values. Setup offers saved references as an explicit choice. Reuse still requires
account authorization and import confirmation. Invalid or unsafe metadata stops
setup until its private file is repaired. A metadata write failure reports that
the credential was imported but the reference was not saved.

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

## Preview a request

Use `sockeye explain` with the same arguments as `sockeye run`:

```sh
sockeye explain --credential SOCKET_RELEASE_APP_PRIVATE_KEY \
  --cwd "$PWD" -- /usr/bin/true
```

The preview prints current file hashes, credential names, escaped arguments,
and the full manifest digest. It does not authenticate, read credential
values, or start the child. It grants no authorization for a later run.

`run` prepares the request again and requires fresh Touch ID. Parent
environment values are neither displayed nor bound by the manifest.
The preview does not validate unbound modules, plugins, or child behavior.
Request paths and arguments appear in its output; keep that output local.

## Recovery

<details>
<summary>Diagnose and repair a credential</summary>

Run `sockeye doctor` to check terminal and biometric availability. To check one
credential's policy metadata, run:

```sh
sockeye doctor --credential SOCKET_RELEASE_APP_PRIVATE_KEY
```

The check does not read the credential value or request authentication.
Healthy metadata does not prove that a later credential read will succeed.

To repair a missing item or an observed policy mismatch, run:

```sh
sockeye doctor --credential SOCKET_RELEASE_APP_PRIVATE_KEY --fix
```

Repair uses the existing attended setup operation. Enter the original value
through the hidden terminal prompt and approve fresh Touch ID. A healthy item
needs no change. If its policy cannot be determined, repair refuses mutation.
Without a credential name, `--fix` reports required manual actions for device
or session problems; it cannot enroll biometrics or unlock the session.

Keep the original credential in its external source. Sockeye cannot export the
stored plaintext for recovery. A new Mac requires fresh attended setup from
that source. Changed biometric enrollment can make an existing item unusable.

If a run reports a missing item or policy mismatch, check the requested name.
Use attended setup to attempt replacement from the original source. If it
fails, preserve the error code and stop. Deletion and recreation of an
inaccessible item have not yet been verified across supported test devices.
Do not weaken the access policy or use a password fallback to recover it.

Cancellation, biometric lockout, and session lock must not reuse an earlier
approval. Restore foreground terminal access and biometric availability, then
start a fresh operation. Do not assume replacement completed after a failed
command; verify with the intended child through another approved run.

The [attended validation runbook](keychain-validation.md) tracks lifecycle and
recovery evidence. Its hardware observations remain unverified until recorded
against the intended binaries on both supported architectures.

</details>

## Release signing prerequisite

Sockeye uses an application bundle to carry its Developer ID provisioning profile.
The installer keeps that bundle intact and exposes `~/.socket/bin/sockeye` as a symlink.

An Apple Developer account administrator must register `dev.socket.sockeye` for the existing Socket team.
Create a Developer ID provisioning profile for that identifier and the existing Developer ID Application certificate.
The profile must authorize the application identifier and team identifier, disable debugging, and remain unexpired.

Store the profile in 1Password. Provision its base64 representation as the repository secret `SOCKEYE_PROVISIONING_PROFILE_BASE64`.
Local signing uses its file path through `SOCKEYE_PROVISIONING_PROFILE`.
No new GitHub App permission is required.

The signing workflow validates the profile before embedding it, then verifies executable startup and the notarized bundle.
A profile alone does not verify biometric behavior. Complete the attended checks after installing the signed release.

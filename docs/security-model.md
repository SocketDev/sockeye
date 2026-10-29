# Sockeye security model

Sockeye solves one narrow problem: a local tool needs a credential, but the
agent arranging the work should not receive that credential.

This page explains the design in plain language. The formal list of threats,
controls, and remaining risks lives in [`threat-model.md`](threat-model.md).

## The trust boundary

Treat the parent agent and every subagent it creates as one untrusted caller.
Current agent runtimes do not give Sockeye a cryptographic identity for each
subagent. A prompt therefore approves the smallest useful operation for the
whole agent tree, not a reusable permission for one named subagent.

The approved child is different. Sockeye starts that process itself and gives
it the requested credentials. The child is trusted to use and protect them.

## What happens during `run`

1. The caller names every credential, non-secret environment variable, bound
   file, argument, working directory, and absolute executable path.
2. Sockeye rejects unknown options, duplicates, wildcard credential names,
   relative paths, oversized fields, and unsafe file permissions.
3. Sockeye resolves and hashes the executable and every bound file. It converts
   the request into one canonical manifest and prints a short request ID. Use
   `sockeye explain` with the same options to view the full request details.
4. The macOS prompt names the child and credentials and requires Touch ID.
   Password fallback and recent-device-unlock reuse are disabled.
5. The same one-use authorization context opens only the listed Keychain items.
   Sockeye checks that each item has its exact device-only,
   `biometryCurrentSet` access-control policy.
6. Sockeye invalidates the authorization context before launch. It rechecks the
   approved files, binds the working directory through an open directory
   descriptor, and starts one child.
7. The child receives a new minimal environment. Sockeye adds only the listed
   credentials and explicit `--pass-env` names. `ENVRYPT_PRIVATE_KEY` travels
   through the one-use `envrypt-v1` inherited pipe instead. Sockeye then clears
   its secret buffers.

There is no bearer token, plaintext response, unlocked socket, or time-to-live
cache to reuse later.

## Where the secret exists

At rest, the secret is a macOS Data Protection Keychain generic-password item.
Its access policy requires the currently enrolled biometric set and makes it
device-only. The Secure Enclave evaluates Touch ID; Sockeye never sees a
fingerprint or biometric template.

During a run, Keychain returns plaintext to the Sockeye process because the
approved child ultimately needs plaintext. Sockeye moves it into locked memory,
disables core dumps, avoids extra application-level copies where the Keychain
API permits, and clears the complete allocation on every exit path.

These controls shorten plaintext lifetime; they do not make process memory
magical. macOS security APIs may use internal buffers, and the approved child
owns its copy after launch.

## Mutating credentials

`set`, `delete`, and the one-time 1Password import require an attached
foreground terminal and a fresh Touch ID approval. `set` reads hidden input
from the terminal, not from arguments, environment variables, a pipe, or an
environment file. The import accepts only one explicit printable `op://`
reference, captures `op read --no-newline` through a private native pipe, and
stores the result in Keychain. Sockeye never resolves a 1Password reference
while running an approved child. An update preserves the old Keychain item
until macOS accepts the replacement. See [credential setup](credential-setup.md).

## Limits that remain release gates

- The executable is hashed and rechecked immediately before `posix_spawn`, but
  the final path-based spawn still has a narrow replacement race. Closing or
  formally accepting that risk blocks a security-stable release.
- The complete interactive Keychain flow needs manual tests on clean macOS
  accounts, changed biometric enrollment, cancellation, and missing Touch ID.
- Local ASan and UBSan runs are clean, and the native input-policy fuzz target
  is wired. Release evidence still needs the documented 15-minute fuzz budget.
- The release binary still needs hardened-runtime signing, notarization,
  provenance, checksums, and installer verification.
- Linux and Windows are unsupported until they can enforce an equivalent
  biometric guarantee. Sockeye must not silently fall back to a weaker policy.

See the [release checklist](release-checklist.md) for the concrete gates.

### Why the executable race is still open

The 2026-07-17 prototype checked the installed macOS SDK and the running host.
macOS provides path-based `execve` and `posix_spawn`, but no public `fexecve` or
`execveat` call that executes an already-open file. Trying to execute the open
file through `/dev/fd/<number>` is rejected with `EACCES`. A private copied
snapshot is not enough either: an attacker running as the same user can still
rename or replace paths owned by that user.

That rules out the tempting “just spawn the descriptor” patch. The promising
design is delayed credential delivery: start the approved executable suspended
and **without secrets**, verify the live process image, then deliver credentials
over a private inherited channel understood by a small trusted bootstrap. This
can work for Node/Agent-CI, where a bootstrap can populate `process.env` before
loading the runner. It is not yet a generic environment-variable solution for
arbitrary native children. The design needs a separate threat review before it
replaces the current path-based launch.

## Local CI boundary

`pnpm run ci:sockeye -- run --workflow <path>` reads one workflow before Touch
ID and extracts only its static `secrets.NAME` and `vars.NAME` references. It
does not read Keychain. Public variables come from explicit `--var NAME=value`
arguments and must match the workflow's declared variable names. The bridge
does not use arbitrary parent environment values as public configuration. Secret values
are fetched later inside Sockeye and exist only in the approved child's minimal
environment.

The bridge binds the selected workflow plus Local CI's installed JavaScript
files into the approval manifest. It launches the JavaScript CLI directly.
Sockeye hashes and rechecks the bound files before
launch. This is stronger than launching the mutable `.bin` shell shim, but it
does not close the same-user path replacement race described above: Node still
opens its module files by path. Independent review of that limitation remains
required before calling the integration security-stable.

# Release checklist

Sockeye handles developer credentials. “It compiles” is not a release bar. A
release is ready only when every required row below has evidence attached to the
release commit.

## Current gate status

| Gate             | Required evidence                                                                                                     | Status                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Threat model     | Reviewed `docs/threat-model.md` matches the release code.                                                             | In progress                                            |
| CLI contract     | Vitest negative tests pass without opening Keychain UI.                                                               | Passing locally                                        |
| Keychain policy  | Fresh-item, update, cancel, missing-item, changed-biometry, and policy-mismatch tests on clean macOS accounts.        | Open                                                   |
| Process identity | Executable launch race is closed or explicitly accepted with independent review.                                      | Open                                                   |
| Memory safety    | ASan and UBSan runs are clean; the manifest/input fuzz target meets its time budget.                                  | Sanitizers pass; 15-minute fuzz evidence recorded      |
| Architecture     | Apple silicon and Intel binaries pass the same contract and interactive tests.                                        | Open                                                   |
| Signing          | Hardened-runtime Developer ID signature and provisioning profile verify on both final archives.                       | App-wrapper release validation required                |
| Notarization     | Apple accepts the archive; binaries pass online ticket verification. Staple supported DMG and PKG outputs.            | ARM64 CI validation passed; release recheck required   |
| Provenance       | CI records source commit, compiler inputs, checksums, and artifact attestations.                                      | Open                                                   |
| Installation     | The installer downloads through the shared helper, verifies the checksum, installs atomically, and rejects tampering. | Open                                                   |
| Agent-CI         | One approval launches the exact bound Agent-CI entry point with only its requested credentials.                       | Bridge and name-set tests pass; interactive smoke open |
| Platform scope   | Linux and Windows artifacts do not ship without an equivalent biometric design.                                       | Enforced by macOS-only build                           |

## Release sequence

1. The user chooses the version. Do not infer or auto-select it.
2. Run all automated, sanitizer, fuzz, architecture, and interactive gates.
3. Review the final threat model and binary diff independently.
4. Build in CI from the reviewed commit.
5. Run the signing workflow in the authorized repository against the reviewed
   commit. It signs and notarizes the exact archive. ZIP contents require online
   ticket verification; staple supported DMG and PKG outputs.
6. Produce SHA-256 checksums and provenance for every archive:
   `pnpm run verify-release <archive>` runs signature, online notarization,
   archive-listing, and SHA-256 checks for real and emits the evidence rows in
   this document's table format; provenance comes from CI attestations.
7. Create the immutable GitHub release through the fleet release workflow.
8. Install through the shared download helper on a clean macOS machine.
9. Repeat the Touch ID, Keychain policy, and exact-child smoke tests against the
   installed binary.

Publishing is user-gated. Local development commits and dry runs must not create
a public release.

## Recorded evidence

### 2026-09-11 ARM64 signing validation

The [signing workflow](https://github.com/SocketDev/sockeye/actions/runs/34664748749)
built the production binary, imported the certificate, signed the binary, and
received Apple's accepted notarization result. Signature verification, artifact
upload, and temporary keychain cleanup passed.

The downloaded ZIP contents passed strict signature verification and
`codesign --check-notarization`. Its checksum matched the uploaded checksum file.

| Item             | Evidence                                                           |
| ---------------- | ------------------------------------------------------------------ |
| Artifact source  | `ea8a1564570c55aae730595510856cf9c9b8be6b`                         |
| Archive          | `sockeye-darwin-arm64.zip`                                         |
| Signing identity | `Developer ID Application: Socket Inc. (PZRCDQ736X)`               |
| Code identifier  | `dev.socket.sockeye`                                               |
| SHA-256          | `ed272c81a7516694a1a07c834298aec69efa2328b728ff74ddfb9fad5cf503a1` |
| Result           | Signature and online notarization verification passed              |

This validates the ARM64 signing pipeline. Repeat verification for the release
commit. Intel, attended Keychain, installation, and provenance gates remain open.

### 2026-07-17 native fuzz budget

This is the release-duration check for the pure native input-policy target. It
does not test the Keychain interface or close the executable path race; those
are separate rows above.

| Item        | Evidence                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| Source      | `2bba2fcc69887edacd71559dab65771b2d59025a`                               |
| Command     | `SOCKEYE_FUZZ_SECONDS=900 pnpm run fuzz`                                 |
| Compiler    | Homebrew clang 22.1.4                                                    |
| Result      | Passed: 197,438,814 executions in 901 seconds, with no sanitizer finding |
| Coverage    | 190 edges, 474 features, 71 minimized corpus inputs                      |
| Peak memory | 475 MiB resident set size                                                |

The fuzzer found 185 new inputs while minimizing its corpus. Its memory use
reached 475 MiB and then remained stable for the run. Record a new row when a
release changes the native input-policy code, compiler, sanitizer settings, or
fuzz duration.

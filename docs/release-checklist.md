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
| Signing          | Hardened-runtime Developer ID signature verifies on the final archive.                                                | Open                                                   |
| Notarization     | Apple notarization succeeds and the ticket is stapled.                                                                | Open                                                   |
| Provenance       | CI records source commit, compiler inputs, checksums, and artifact attestations.                                      | Open                                                   |
| Installation     | The installer downloads through the shared helper, verifies the checksum, installs atomically, and rejects tampering. | Open                                                   |
| Agent-CI         | One approval launches the exact bound Agent-CI entry point with only its requested credentials.                       | Bridge and name-set tests pass; interactive smoke open |
| Platform scope   | Linux and Windows artifacts do not ship without an equivalent biometric design.                                       | Enforced by macOS-only build                           |

## Release sequence

1. The user chooses the version. Do not infer or auto-select it.
2. Run all automated, sanitizer, fuzz, architecture, and interactive gates.
3. Review the final threat model and binary diff independently.
4. Build in CI from the reviewed commit.
5. Sign, notarize, staple, and verify the exact archives that will be
   uploaded: `pnpm run sign -- --run` (hardened runtime + Developer ID; dry
   run without `--run`, `--ad-hoc` for a certificate-free local pass), then
   `pnpm run notarize -- --run <archive>` (notarytool submit + staple; dry run
   without `--run`), then `pnpm run verify-release -- <archive>`.
6. Produce SHA-256 checksums and provenance for every archive:
   `pnpm run verify-release -- <archive>` runs the codesign, Gatekeeper,
   archive-listing, and SHA-256 checks for real and emits the evidence rows in
   this document's table format; provenance comes from CI attestations.
7. Create the immutable GitHub release through the fleet release workflow.
8. Install through the shared download helper on a clean macOS machine.
9. Repeat the Touch ID, Keychain policy, and exact-child smoke tests against the
   installed binary.

Publishing is user-gated. Local development commits and dry runs must not create
a public release.

## Recorded evidence

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

# Release checklist

Sockeye handles developer credentials. “It compiles” is not a release bar. A
release is ready only when every required row below has evidence attached to the
release commit.

## Current gate status

| Gate             | Required evidence                                                                                                | Status                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Threat model     | Reviewed `docs/threat-model.md` matches the release code.                                                        | In progress                                            |
| CLI contract     | Vitest negative tests pass without opening Keychain UI.                                                          | Passing locally                                        |
| Keychain policy  | Fresh-item, update, cancel, missing-item, changed-biometry, and policy-mismatch tests on clean macOS accounts.   | Open                                                   |
| Process identity | Executable launch race is closed or explicitly accepted with independent review.                                 | Open                                                   |
| Memory safety    | ASan and UBSan runs are clean; the manifest/input fuzz target meets its time budget.                             | Sanitizers pass; 15-minute fuzz evidence recorded      |
| Architecture     | Apple silicon and Intel binaries pass the same contract and interactive tests.                                   | Open                                                   |
| Signing          | The Developer ID leaf certificate matches each embedded profile. The profile authorizes the exact signed claims. | ARM64 and x64 validation passed at `1e57cc0c`          |
| Notarization     | Apple accepts each submission. Each final ZIP contains an application with a validated stapled ticket.           | ARM64 and x64 validation passed at `1e57cc0c`          |
| Provenance       | CI records source commit, compiler inputs, checksums, and artifact attestations.                                 | Open                                                   |
| Installation     | The installer verifies the checksum, exact release version, full bundle, signature, profile, and stapled ticket. | Automated checks pass; clean-machine test remains open |
| Agent-CI         | One approval launches the exact bound Agent-CI entry point with only its requested credentials.                  | Bridge and name-set tests pass; interactive smoke open |
| Platform scope   | Linux and Windows artifacts do not ship without an equivalent biometric design.                                  | Enforced by macOS-only build                           |

## Release sequence

1. The user chooses the version. Do not infer or auto-select it.
2. Run all automated, sanitizer, fuzz, architecture, and interactive gates.
3. Review the final threat model and binary diff independently.
4. Build in CI from the reviewed commit.
5. Run the signing workflow in the authorized repository against the reviewed
   commit. It signs the application before it creates the submission ZIP.
6. Require an accepted submission ID and inspect the Apple notarization log.
   Staple the accepted ticket to the application and validate the ticket.
7. Package the stapled application with `ditto --norsrc`. Extract it into a
   new directory and validate its ticket before publication.
8. Produce one SHA-256 sidecar for each final archive. Run
   `pnpm run verify-release --expected-version <version> <archive>`.
9. Create the immutable GitHub release through the fleet release workflow.
10. Install through the shared download helper on a clean macOS machine.
11. Repeat the Touch ID, Keychain policy, and exact-child smoke tests against the
    installed binary.

Publishing is user-gated. Local development commits and dry runs must not create
a public release.

## Recorded evidence

### 2026-09-14 two-architecture signing validation

The [signing workflow](https://github.com/SocketDev/sockeye/actions/runs/34814574533)
built, signed, notarized, stapled, verified, and uploaded both macOS archives.
The workflow restored and deleted its temporary signing keychains.

Independent verification matched each checksum and receipt to the source,
architecture, workflow run, notary submission, and final archive.
`codesign`, Gatekeeper, and stapler validation passed for both archives.

| Architecture | Archive SHA-256                                                    |
| ------------ | ------------------------------------------------------------------ |
| ARM64        | `4954378ddde59033cb7ab926ba432151924c101bc7ae1d614b39c025ca4df946` |
| x64          | `a4fead777f56cc996d6211e0f7d585b21582f020439cfb5a427a456616d6d11f` |

The source was `1e57cc0cfb1b58930e9c0c2a780a1ba624bec940`.
No public release was created.
Attended Keychain, clean-machine installation, and release-version gates remain open.

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

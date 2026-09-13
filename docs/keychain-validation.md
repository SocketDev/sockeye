# Attended Keychain validation

Status: unverified. No attended results accompany this tooling.
The collector records operator observations. It does not perform the lifecycle
operations or prove an observation independently.

Use dedicated Apple silicon and Intel test Macs. Enrollment changes affect the
device, so a disposable account alone does not isolate them. Stop if a procedure
would affect normal credentials or enrollment. Never use real credentials.

## Preparation

<details>
<summary>Build helpers and prepare disposable fixtures</summary>

Use the Developer ID release artifact. Record its full source commit and signing
class as `developer-id`. Confirm the checkout has no source changes. Record the
tested binary's architecture and signing identity independently before
collecting observations. An ad-hoc signature can test certificate-free signing
mechanics. It cannot pass the Data Protection Keychain lifecycle gate.

The build produces `sockeye-keychain-observer` and, on macOS,
`sockeye-keychain-policy-fixture` as test helpers. They do not belong in release
artifacts. The observer prints only `fixture-match` or `fixture-mismatch`.
Its exit status is zero only for equality. The policy helper creates only the
disposable test item, refuses replacement, and requires fresh biometric approval
from a foreground terminal. It deliberately omits the biometric access policy.
Never install that helper as a product command.

Use `SOCKEYE_TEST_LIFECYCLE_TOKEN` as the disposable credential name.
Enter `SOCKEYE_FAKE_LIFECYCLE_INITIAL` through `sockeye set`'s hidden terminal
prompt. For replacement, enter `SOCKEYE_FAKE_LIFECYCLE_REPLACEMENT` there.
These are public fake fixtures. Never place actual credentials in arguments,
environment files, evidence, logs, or test notes.

For an approved run, use this manifest with absolute build paths:

```sh
sockeye run --credential SOCKEYE_TEST_LIFECYCLE_TOKEN \
  --cwd /absolute/test/directory -- /absolute/build/sockeye-keychain-observer initial
```

Use the `replacement` observer argument after replacing the fixture. Confirm
the observer launches only after approval. Record process exit status, equality,
and total biometric prompt count in your observation notes. Do not record values
or account metadata. Preserve failed observations as failures.

</details>

## Required observations

Complete each row on both architectures. A row passes only when every listed
observation holds. Missing hardware, an unperformed step, or uncertain behavior
requires `unverified`. Do not mark an inapplicable case passed.

| Evidence case                       | Procedure and required observation                                                                                                                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fresh-set`                         | Set the initial fixture through hidden input; approve an observer run. Each operation requests fresh approval and the child reports equality.                                                                                                                        |
| `replacement`                       | Set the replacement fixture; approve a replacement observer run and confirm equality.                                                                                                                                                                                |
| `cancelled-replacement`             | Cancel replacement at each available prompt. Confirm the previous fixture still matches whenever mutation did not commit.                                                                                                                                            |
| `delete-repeat`                     | Create an unrelated disposable test item through attended setup. Delete the lifecycle item twice. Verify lifecycle runs cannot launch a child and the unrelated item still works. Record both delete statuses.                                                       |
| `cancelled-delete`                  | Cancel deletion of an existing lifecycle fixture. Confirm an approved observer run still matches.                                                                                                                                                                    |
| `missing-item`                      | Request the absent lifecycle item. Confirm failure, no observer launch, and no substitute credential.                                                                                                                                                                |
| `policy-mismatch`                   | After attended deletion, invoke the fixture helper with `create-disposable-mismatch`. Approve its fresh prompt. A product run must refuse delivery. Attempt attended replacement and observe policy recovery with an approved run. Record failure if recovery fails. |
| `enrollment-change`                 | On a dedicated device, change enrollment manually. Confirm the old item cannot satisfy its original policy. Attempt fresh attended setup from the external fake source and record its outcome.                                                                       |
| `no-biometry`                       | On a device without available enrolled Touch ID, attempt the relevant operations. Confirm controlled refusal, no password fallback, and no child launch.                                                                                                             |
| `lockout-cancellation-session-lock` | Exercise biometric lockout, cancelled approval, and a locked session separately. Confirm controlled failure and no reused approval in each condition.                                                                                                                |
| `one-password-import`               | Import a disposable fake fixture from an explicitly pinned account/reference. Cancel an import to a previously absent item and confirm nothing was stored. Complete import, then verify an approved observer run does not invoke 1Password.                          |
| `repeat-run`                        | Run the observer twice successfully. Each launch must request a new approval.                                                                                                                                                                                        |
| `new-mac`                           | Verify the original device-only item is absent on another Mac. Recover through fresh attended setup from the original external fake source.                                                                                                                          |
| `release-binary`                    | Confirm architecture, OS, source, signing class, and exact binary identity. Run every other case against this binary without rebuilding it.                                                                                                                          |

If cancellation destroys a prior item or policy mismatch delivers a value,
stop testing and preserve redacted failure evidence. Reproduce the defect under
a bounded fix plan before changing production Keychain code.

## Collect and check evidence

<details>
<summary>Record observations and validate artifacts</summary>

Run the collector from a foreground terminal after performing the observations.
Set `SOCKEYE_KEYCHAIN_EVIDENCE_FILE` to a new JSON file outside the checkout.
Set `SOCKEYE_KEYCHAIN_SOURCE` to the tested full source commit.
Set `SOCKEYE_KEYCHAIN_SIGNING_CLASS` to the observed signing class.
Then run `pnpm run test:keychain:interactive` and type `ATTENDED`.

For each row, enter `passed:2` or `failed:2`, replacing `2` with the observed
prompt count. Enter `unverified` for any missing observation. The collector
rejects CI and absent foreground terminals. Default tests clear its selection
marker. Direct discovery skips the suite without the attendance contract.
Skipped cases cannot create passing evidence. Evidence paths must be new.

The schema stores only source commit, binary SHA-256, OS release, architecture,
signing class, case identifier, fixed outcome, prompt count, and status.
It accepts no extra fields. It records no credential inventory, account name,
biometric details, or freeform text. Store redacted operator notes separately.

Collect both architecture files in a dedicated evidence directory. Verify them
against the exact intended artifacts:

```sh
pnpm run check:keychain-evidence -- /absolute/evidence/directory \
  --binary /absolute/arm64/sockeye --binary /absolute/x64/sockeye \
  --source 0123456789012345678901234567890123456789
```

Supply separate thin Mach-O binaries. The checker reads their CPU headers and
hashes their bytes. It requires every case exactly once for each architecture,
the supplied source commit, matching hashes, and passing observations.
This validates evidence consistency; it does not authenticate operator claims
or independently verify signing identity.

With no arguments, the checker validates tooling and documented coverage only.
Preflight uses that mode. It does not close the release gate. Follow-up
RELEASE-EVIDENCE must connect strict artifact checking to the release pipeline.

After testing, remove disposable items through attended `sockeye delete`.
Record any failed cleanup as unverified recovery. Repeat the matrix after
access-policy, mutation, authentication, signing, or release-binary changes.

</details>

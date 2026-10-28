---
name: property-and-fuzz-testing
description: Pick a property/fuzz tier and harness for parsers, decoders, and native addons.
metadata:
  internal: true
---

# Property and fuzz testing

Three tiers, each for a different shape of bug. Pick the tier by what you're
testing, then open the per-language reference for the harness.

| Testing…                                                                                                                                                                              | Tier                                 | Why                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| A **pure function** with an invariant ("always/never")                                                                                                                                | **property** (Tier 1)                | Generated inputs + shrinking to a minimal counterexample                      |
| **Any untrusted-input boundary**, such as a parser, decoder, config/manifest loader, wire-format reader, or **native C++/Rust module**, that must not crash/hang/corrupt on any input | **coverage-guided fuzzing** (Tier 2) | Finds crash / memory-safety / security inputs with no spec; replayable corpus |
| A **stateful SUT invariant** over synthetic worlds (cascade parity, `check↔fix` idempotence)                                                                                          | **hand-rolled seeded** (Tier 3)      | Drives the real SUTs over generated repo trees; deterministic replay          |

Property/fuzz tests **complement** example tests - they don't replace them.
Keep a few concrete `test('…')` cases as living documentation; add a property
or fuzz test for the "for all inputs" claim.

**Correctness vs safety are different fuzzers, both wanted.** A property test
checks _correctness_ against a property you write (finds wrong answers); a
coverage-guided fuzzer finds _crashes / memory / security_ violations with **no
spec**, using coverage feedback to reach deep paths random sampling misses. A
function can be crash-free but wrong (property catches) or correct-on-samples
but crash on a deep-path input (fuzzer catches). For a **native parser do
both**: libFuzzer + ASan on the native code (memory safety) AND a JS-surface
fuzz through the boundary (the integration contract).

## Pick your language

Each reference carries the tool, file layout, run commands, escalation to
stronger engines, and CI/gate wiring for that ecosystem. The Rust lane is the
canonical reference where a surface is implemented in several languages (see
"Lock-step" below).

| Language | Tier 1 (property)             | Tier 2 (coverage-guided)                          | Reference                                                                  |
| -------- | ----------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| JS / TS  | `fast-check`                  | `vitiate` (SWC-instrumented)                      | [references/javascript-typescript.md](references/javascript-typescript.md) |
| Rust     | `proptest` / `quickcheck`     | `cargo-fuzz` (libFuzzer) + ASan/UBSan             | [references/rust.md](references/rust.md)                                   |
| Go       | table props / `testing/quick` | `go test -fuzz` (native)                          | [references/go.md](references/go.md)                                       |
| C++      | assertion harness             | libFuzzer + `-fsanitize=address,fuzzer,undefined` | [references/cpp.md](references/cpp.md)                                     |

## The high-value fleet targets

Read [references/high-value-targets.md](references/high-value-targets.md) for
the named list of "a bug here = red CI everywhere" fleet functions and
packages before picking what to property/fuzz first.

## Lock-step (multi-language surfaces)

When ONE surface is implemented in several languages (acorn's parser: Rust /
Go / C++ / TS), the fuzzers are lock-step across lanes. Read
[references/lock-step.md](references/lock-step.md) for the shared-contract
rules before adding a harness to a multi-language surface.

## Beyond the default engine

The native engines above are the right DEFAULT. Read
[references/escalation-engines.md](references/escalation-engines.md) for the
escalation catalogue (ClusterFuzzLite, AFL++, Honggfuzz, Centipede, bolero,
structure-aware fuzzing, additional sanitizers) once the default engine proves
insufficient.

## Conventions (all languages)

- A discovered counterexample becomes a **pinned regression test** (example
  test / committed corpus entry) next to the property - regression +
  documentation.
- **Corpus + dictionary are committed** so a crash is replayable and coverage
  accrues across runs. Seed with real inputs (conformance suites, fixtures).
- Seed + iteration/time budget are env-/flag-overridable so CI can widen and a
  failure replays deterministically (`FUZZ_SEED` / `FUZZ_ITERS` for seeded
  harnesses; `-max_total_time` / `-fuzztime` / `--fuzz-time` for the native
  fuzzers).
- **Read the exit-code contract** in the language reference before wiring CI:
  `0` = clean, a crash code = fail + upload the minimized artifact, a timeout
  code = hang. Never treat "exit 1 = crash found" - the codes are tool- and
  version-specific.
- A fuzzer build/run that can't find its toolchain **reports the exact install
  command and exits non-zero - it never fabricates a pass.**

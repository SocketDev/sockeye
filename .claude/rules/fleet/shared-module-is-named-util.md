# A shared module is named `util`, and never repeats its directory

A directory's grab-bag of shared helpers has ONE name per repo, and that name
is `util` or `utils`. It never carries the directory's own name.

## The rule

- **Pick `util` or `utils` once per repo, then never mix.** socket-lib uses
  `util` (`src/node/util.mts`, mirroring `node:util`). Match whatever the repo
  already has rather than introducing the other spelling beside it.
- **Never name a file after its own directory.** `tarball/tarball-helpers.mts`
  says tarball twice, and the import reads
  `from './tarball-helpers.mjs'` inside `tarball/` where the context is already
  established. It is `tarball/util.mts`.
- **`-helpers` is not a name.** It describes the shape of the contents, not
  what they are about, which is the same fault as a directory called
  `constants/` holding modules from six unrelated subjects.
- **A module that IS about something gets that name.** Reach for `util` only
  when the contents genuinely have no shared subject. Two functions about
  parsing belong in `parse.mts`, not swept into `util.mts`.

## Why

Naming a file after its directory doubles the token in every import path and
tells a reader nothing the path did not already say. Mixing `util` and `utils`
in one repo means every author guesses, and a grep for one spelling misses
the other half. socket-lib carried `src/node/util.mts` and a
`tarball/tarball-helpers.mts` at the same time, so both faults were live in one
package.

Related: [`code-style`](code-style.md) - an exported name carries a domain word,
and a bare generic token is grep noise. This is the same rule at file scope.

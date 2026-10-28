# A shared module is named `util`, and never repeats its directory

A directory's grab-bag of shared helpers has ONE name per repo. That name is
`util` or `utils`, and it never carries the directory's own name.

## The rule

- Pick `util` or `utils` once per repo, then never mix. socket-lib uses `util`
  (`src/node/util.mts`, mirroring `node:util`). Match what the repo already
  has rather than introducing the other spelling beside it.
- Never name a file after its own directory.
  `tarball/tarball-helpers.mts` says tarball twice, and the import reads
  `from './tarball-helpers.mjs'` inside `tarball/`, where the path already
  established the context. It is `tarball/util.mts`.
- `-helpers` is not a name. It describes the shape of the contents, not their
  subject, which is the same fault as a `constants/` directory holding modules
  from six unrelated subjects.
- A module that IS about something gets that name. Reach for `util` only when
  the contents have no shared subject. Two functions about parsing belong in
  `parse.mts`, not swept into `util.mts`.

## Why

Naming a file after its directory doubles the token in every import path and
tells a reader nothing the path did not already say. Mixing `util` and `utils`
in one repo makes every author guess, and a grep for one spelling misses the
other half.

socket-lib carried `src/node/util.mts` and
`test/unit/eco/npm/registry/tarball/tarball-helpers.mts` at the same time, so
both faults were live in one package.

Related: [`code-style`](code-style.md), where an exported name carries a domain
word and a bare generic token is grep noise. This is that rule at file scope.

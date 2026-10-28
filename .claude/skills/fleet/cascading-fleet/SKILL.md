---
name: cascading-fleet
description: Propagate a wheelhouse template change across fleet repos: worktrees, push/PR fallback, cleanup.
user-invocable: true
allowed-tools: Bash(git fetch:*), Bash(git worktree:*), Bash(git branch:*), Bash(git status:*), Bash(git rev-list:*), Bash(git symbolic-ref:*), Bash(git show-ref:*), Bash(git push:*), Bash(git commit:*), Bash(git add:*), Bash(git log:*), Bash(node:*), Bash(gh pr create:*), Bash(gh repo view:*), Read, Bash(bash:*), Bash(chmod:*), Bash(cd:*), Bash(printf:*), Bash(echo:*), Bash(tee:*), Bash(tail:*), Bash(ls:*)
model: claude-haiku-4-5
context: fork
metadata:
  internal: true
---

# cascading-fleet

The fleet runs on `chore(wheelhouse): cascade template@<sha>` commits. Every wheelhouse template change has to land in every fleet repo to take effect. This skill packages the operation so it isn't recreated ad-hoc per session.

🚨 **This is mechanical work, not a thinking task.** Run the canonical operation, commit, push. Don't analyze each modified file in the cascade, don't design alternatives, don't write multi-paragraph rationale: the wheelhouse template is the source of truth and the sync runner decides what changes. If a repo's cascade refuses to apply (lockfile policy reject, soak window, broken hook from a stale install), bump the immediate blocker (soak-exclude entry, lockfile rebuild) or defer the repo and report it --don't reason through a multi-step manual reproduction of what the sync runner already does. Cheap/fast model settings are the right default; reserve heavier reasoning for genuine design work.

## When to use

- A wheelhouse `template/` SHA needs to propagate to every fleet repo.
- Batching multiple template SHAs into one wave.

Tool-version bumps (pnpm, zizmor, sfw, …) route through the wheelhouse-owned
<!-- oxlint-disable-next-line socket/no-cross-repo-path -->

pipeline (`node scripts/repo/pipeline.mts`, run FROM the wheelhouse: bump →
reconcile → CI-green gate → propagate); this skill then carries the resulting
template change fleet-wide like any other.

Never use this skill while another cascade is in flight (each cascade creates a `chore/wheelhouse-<sha>` branch per repo; concurrent runs collide).

## The cascade

Propagates a `socket-wheelhouse/template/` SHA to every fleet repo. The flow:

1. For each fleet repo:
2. Worktree off `origin/<default-branch>` on a fresh `chore/wheelhouse-<sha>` branch.
3. Run `socket-wheelhouse/scripts/repo/commit-cascade/run.mts --target <wt> --fix`.
4. If the cascade modified anything: surgical-stage with `FLEET_SYNC=1 git add --update`, commit `chore(wheelhouse): cascade template@<sha>`, push direct to base.
5. If direct push is rejected: push the branch, open a PR.
6. Clean up the worktree + the temp branch.

The `FLEET_SYNC=1` sentinel is recognized by the wheelhouse `no-revert-guard` + `overeager-staging-guard` hooks. It allowlists exactly: `git commit --no-verify` whose message starts with `chore(wheelhouse): cascade template@`, `git push --no-verify`, and `git add -A`/`-u`/`.`. Nothing else.

## Pre-cascade gate

The wave driver's preflight refuses to start on a dirty `template/`, a cascade already in flight, or a red `pnpm run check --all` in the wheelhouse. Read [references/pre-cascade-gate.md](references/pre-cascade-gate.md) for the full refusal rules, the `knownRed` one-run exemption, and the dogfood-green ordering before running a wave.

## How to invoke

```bash
# Propagate a wheelhouse template SHA fleet-wide
node .claude/skills/fleet/cascading-fleet/lib/cascade-template.mts <template-sha>
```

The script reads the wave list from `lib/fleet-repos.txt`, the worktree-cascade SUBSET of the canonical roster `lib/fleet-repos.json`. It validates the list against that roster at startup, where an unknown name refuses the whole wave, then iterates and writes a per-repo result line to stdout. Output also tees to `/tmp/cascade-<sha>.log` for post-hoc inspection.

## Membership gate - sweeps write only into roster members

A repo is fleet surface because its **origin remote resolves to a roster member** (`lib/fleet-repos.json`), never because it sits under `~/projects`. A past sweep treated a non-member clone there as fleet surface and landed a fleet-convention commit into it. Every fleet tool that WRITES into a working tree asserts destination membership first and refuses non-members: `fetch-fleet-pack.mts` (default root and `--dest`), `gen/agents-skills-mirror.mts`, `soak-bypass.mts`, `scripts/repo/sync.mts` + `commit-cascade/run.mts` path targets, and this wave driver (txt-vs-json validation). The shared predicates live in `scripts/fleet/member/fleet-membership.mts`, deriving from the hooks' `fleet-repos.mts` - one roster, many readers.

The escape hatch is explicit and audited - never an env var: `--allow-non-member --reason "<why>"`. The reason is required and logged, so a sanctioned non-member write always leaves a line in the transcript. The commit-side backstop is `no-fleet-scope-in-non-member-guard`, which blocks a `<type>(fleet): …` commit subject in a repo whose origin is outside the roster.

## Post-cascade: reconcile lockfiles

🚨 A cascade that changes the catalog, `packageManager`, or dep overrides lands a **lockfile-less** commit downstream, red-lining every consumer's `pnpm install --frozen-lockfile` in CI. Read [references/lockfile-reconciliation.md](references/lockfile-reconciliation.md) for the per-repo executable, the parallel Workflow fan-out, and how to scope it to just the repos a cascade touched, before treating a catalog cascade as done.

## Stop conditions

- Branch already exists in a fleet repo (`fatal: a branch named 'chore/wheelhouse-<sha>' already exists`): pre-clean from `${src}` then retry that repo only.
- Worktree-add fails: another worktree at the target path; cleanup with `git worktree remove --force <wt>`.
- Push rejected on direct base: the script automatically falls back to PR. Confirm via the PR URL printed to stdout.

## Recovery playbook

The cascade script is deterministic and always cleans up its worktree, but three situations need a human/agent judgment call it cannot make on its own: a dirty downstream checkout, stranded local cascade commits, and soak-bypassing a tool bump. Read [references/recovery-playbook.md](references/recovery-playbook.md) for the full decision tree before acting on any of them. That same reference covers the worktree-cleanup cwd gotcha and the soak-time wait before a catalog cascade.

## Reference

- FLEET_SYNC sentinel: `template/.claude/hooks/fleet/no-revert-guard/` + `template/.claude/hooks/fleet/overeager-staging-guard/`.
- Wheelhouse sync-scaffolding: `socket-wheelhouse/scripts/repo/commit-cascade/run.mts`.
- Fleet-repo manifest: `lib/fleet-repos.txt`.
- Tool-pin propagation: the wheelhouse pipeline (`socket-wheelhouse/scripts/repo/pipeline.mts` - bump → reconcile → CI-green gate → propagate); this skill then carries the template change fleet-wide.

## Handoff

For a narrow, named cascade category, use [syncing-fleet](../../repo/syncing-fleet/SKILL.md)
instead of a full template wave.

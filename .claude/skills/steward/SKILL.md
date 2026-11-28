---
name: steward
description: Conventions for driving a Rhizome PR to green after it is opened - CI fixes, review comments, changelog and shallow-clone gotchas.
---

# Stewarding a Rhizome PR

Applies on top of `AGENTS.md`; that file's workflow still holds.

## Before every push

- Make the clone full first: `git rev-parse --is-shallow-repository`, and if
  `true`, `git fetch --unshallow --tags origin`. A shallow clone makes
  `just changelog` silently drop entries.
- Run `just changelog` after committing, and commit any change as
  `docs: refresh changelog`. Repeat after every follow-up commit, since CI fails
  a PR whose `CHANGELOG.md` differs from what `cz changelog` generates.
- Run the fast check for what you changed (`just lint`, `just test`), not the
  whole suite repeatedly. CI is the full pass.

## CI failures

- Read the failing job's log before changing anything; fix the root cause.
- Every frontend change needs a VRT refresh: `git lfs pull`, then `just vrt`
  (rebuilds Storybook, so baselines never come from a stale build). Look
  through every diff and ping the user if any change is unexpected; never
  re-accept to silence an unexplained diff. If all look as intended, run
  `just vrt-accept` and push the baselines to the PR, so the user can review
  the new UI in its screenshot diff. Do this proactively, not only after CI
  fails.
- `assets-check` failures mean generated assets are stale: run `just assets`
  and commit the result.
- Do not skip, disable or quarantine a test to get green.

## Review comments

- Do small asks directly and reply on the thread.
- Answer larger asks (multi-file refactors, design changes) with a proposal
  rather than pushing.
- Leave nits unless they ride along with a push you are making anyway.

## Merging

- The repo only allows rebase-style merging, so every commit lands on `main`
  individually: keep messages conventional (`feat`, `fix`, `ci`, `docs`, ...).
- Merge only when the user explicitly asks: "merge now", or "merge once CICD
  succeeds" (then wait for CI to be green on the PR's current head and merge
  with the rebase method). Without such an ask, stop at "green and approved".

---
name: steward
description: Conventions for driving a Rhizz PR to green after it is opened - CI fixes, review comments, changelog and shallow-clone gotchas.
---

# Stewarding a Rhizz PR

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
- VRT (visual regression) failures: only re-accept baselines when the visual
  change is intended, and rebuild Storybook first so the baselines are not
  taken from a stale build. Never re-accept to silence an unexplained diff.
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

## Pace

- Wait for events rather than polling. After pushing, end the turn; CI results
  wake the session.

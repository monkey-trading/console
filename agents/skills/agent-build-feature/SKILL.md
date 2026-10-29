---
name: agent-build-feature
description: >
  Use when implementing a feature — "build #12", "implement this feature", "start the next
  feature". Confirms the feature is ready to build, builds all of it on one branch for one PR
  (parallel subagents allowed), self-reviews it with agent-code-review, runs its dev scenario in a
  browser on a production build of the branch before the PR is marked ready, and opens the PR
  through agent-create-pr ending `Closes #<feature>`, so the merge closes the issue. Merges,
  deploys, and issue writes need the user's approval, except the `bug` issues the review loop files
  for Mediums from round 3 on.
---

# agent-build-feature

Build one ready feature end to end on one branch, so the team reviews it once, checks it in dev,
and it goes live at merge. Features are planned with
[agent-plan-feature](../agent-plan-feature/SKILL.md); a bug fix or a refactor that is not a feature
goes straight through [git-workflow](../../rules/git-workflow.md) and
[agent-create-pr](../agent-create-pr/SKILL.md).

## Dev

Dev is a production build checked in a browser: a local build (`npm run build`, then
`npm start -- --port <port>` on a free port) until the repository is connected to Vercel, and the
branch's preview deployment of the pushed head once it is
([no-guessing-current-state](../../rules/no-guessing-current-state.md) says how to tell). A merge
deploys production, so the dev scenario passes before the PR is marked ready, not after. A check
made before a push, such as on a review fix not yet pushed, runs on a local production build of the
working tree: a head has no preview until it is pushed.

The scenario's check is a script that drives a browser, so anyone can run it again:

- Serve a local build with `npm start -- --port <port>` on a free port, its output captured to a
  log in the run directory, and point the script at that port only once the log says it listens
  there. `next start` exits when its port is taken, so a request to the default port could reach
  another server, such as a dev server, and judge the wrong build.
- Use Playwright from a scratch directory outside the repository, at an exact version of the
  official `playwright` package (`npm view playwright version`); it never becomes a dependency of
  this repo. Run the script from beside that install so its imports resolve.
- Keep the run's record — a copy of the script, its screenshots, and its results — in the
  gitignored `agents/.processes/dev-runs/<YYYY-MM-DD-HHMM>-<kebab-slug>/`.
- Drive the page the way a visitor does: by role and accessible name (`getByRole`), with the
  keyboard where the scenario says so, and at the mobile and desktop widths it names.
- When the change alters what the page loads or renders, run Lighthouse in its mobile
  configuration on a local production build of the PR head, whatever dev is, as
  [web-implementation](../web-implementation/SKILL.md#performance) describes, so the scores measure
  the build rather than a preview's hosting settings; keep its report in the run directory. When it
  adds client JavaScript, also compare `npx next analyze --output` before and after on local
  builds, and keep both reports there.
- When a preview deployment is protected and the run cannot reach it, run the scenario on a local
  production build of the same commit and say so. Never change protection settings
  ([no-deploy](../../rules/no-deploy.md)).

## Before the first edit

- **Ready.** Read the feature issue (`gh issue view <n> --comments`). A planned feature carries the
  `ready-to-build` label, every blocker is done — including any engine issue in a
  `Blocked by monkey-trading/engine#<n>` line — and its acceptance criteria cite their sources. If
  a decision is open, stop and name it. Build nothing of a feature that is not ready, not even the
  parts that look settled.
- **An issue the plan did not write.** Check the same things: every decision its design needs is
  made, its criteria have sources, and it has a dev scenario. Name each gap and ask the user to fill
  it or confirm the issue is ready; never decide that alone.
- **Whole scope.** List what the feature needs on the live page: its copy and the engine README or
  decision each claim comes from, components, `src/lib` logic and tests, metadata, headers and CSP,
  assets, and anything the owner must set at Vercel. A feature is complete when its dev scenario
  passes in a browser on a production build. Anything the issue does not cover is a question for
  the user now, not a later PR.
- **Size.** Estimate the PR from that scope, counting production code and tests as
  [agent-plan-feature](../agent-plan-feature/SKILL.md#what-a-feature-is) does, and again when
  planning the build (the interfaces the subagents build against) shows more than the issue
  suggested. When the issue records why a large feature has no seam and the estimate has not grown
  past its size, build it. Otherwise, past about 5k lines, look for a seam as agent-plan-feature
  describes and propose any split to the user before the first edit; past about 10k, build one PR
  only when they agree there is no seam. An agreed split changes the plan: re-plan through
  agent-plan-feature, then build the first resulting feature once its issue is ready.
- **Branch.** One pushed branch for the feature, named for its issue per git-workflow.
- Load [think-before-coding](../../rules/think-before-coding.md),
  [development-checklist](../../rules/development-checklist.md), and the `*-implementation` skill
  for every area the feature touches.

## Building

- Build the narrowest end-to-end path first, then widen it, so the branch builds and renders at
  every step.
- Parallel work is fine: split by area across subagents, each in its own worktree on a local
  branch, and merge each into the feature branch. Never push a branch or open a PR per part, and
  never stack PRs for one feature.
- Map every acceptance criterion to code and a test. Test where the behaviour lives: vitest unit
  tests for logic in `src/lib`, and the dev scenario's browser check for what only a browser shows
  — rendering, keyboard use, motion, and the absence of third-party requests.

## Before review

- Run the local checks per git-workflow.
- Self-review with [agent-code-review](../agent-code-review/SKILL.md), multi-agent at `medium` or
  higher: fix every accepted Critical, High, and Medium finding by class
  ([Fixing an accepted finding](../agent-code-review/SKILL.md#fixing-an-accepted-finding)) and run
  it again until [the review loop](../agent-code-review/SKILL.md#the-review-loop) ends, as
  [agent-create-pr](../agent-create-pr/SKILL.md#before-a-pr-is-ready-for-review) requires before
  the PR is marked ready.
- Show the user the dev scenario — steps, expected result, and the build it runs on — and on their
  yes write it into the issue's dev scenario section, replacing the planned text.
- Rebase the branch onto `main` and run the dev scenario in dev on that build, as [Dev](#dev)
  describes. Show the user the result. The site's CI runs no browser job, so this check, not CI,
  is the scenario's gate; a browser job in CI is the operator's call
  ([general-practices](../../rules/general-practices.md)). A mechanical rebase, as
  [the review loop](../agent-code-review/SKILL.md#the-review-loop) defines it, needs no new review
  round; any other rebase is re-checked by its delta (the same section).
- Put what promotion needs in the PR body: anything the owner must set at Vercel, ordering against
  an engine change, and rollback when a revert is not enough.

## PR and merge

- Open the PR with agent-create-pr, ending `Closes #<feature>`, never `Part of #<feature>`. The PR
  is marked ready only after the dev scenario has passed on the rebased branch, so the merge
  finishes the feature and GitHub closes the issue.
- Answer review with [agent-address-pr-comments](../agent-address-pr-comments/SKILL.md), aiming for
  one round.
- A later push that changes the feature's behaviour, from a review fix or a rebase, runs the dev
  scenario again on the new head and shows the user the result before the PR merges.
- The merge is the promotion: it deploys production once Vercel is connected, and it happens only
  on the owner's go-ahead, as [agent-create-pr](../agent-create-pr/SKILL.md#merging) describes.

## Rules

- One feature never spans several pushed branches or PRs.
- Never build part of a feature that is not ready.
- Never write to a GitHub issue without the user's yes to the exact text. The exceptions are the
  merge closing the feature issue through `Closes #<feature>`, and the `bug` issues
  [the review loop](../agent-code-review/SKILL.md#the-review-loop) files for Mediums from round 3
  on.
- Never merge, deploy, or change an environment without explicit per-action approval.

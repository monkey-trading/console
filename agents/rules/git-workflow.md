# Git workflow

Load on request before creating a branch, committing, pushing, or opening or updating a PR.

**Rule**: Branch, commit, verify, and push the same way every time.

## Branches

- GitHub flow: feature and fix branches → protected `main`. Never commit directly to `main`.
- One feature never spans several pushed branches or stacked PRs
  ([agent-build-feature](../skills/agent-build-feature/SKILL.md)). Local branches that merge into
  the feature branch, such as one per subagent worktree, are fine.
- Rebase a branch on the latest `main` before opening its PR; the PR lands as one squashed
  commit.
- Name new branches `0xjevons/<slug>[-gh<issue>...]`:
  - `0xjevons` — the owner's GitHub account. `gh` runs as that account; check
    with `gh api user --jq .login` before any GitHub write.
  - `<slug>` — 2–5 kebab-case words, max 40 chars, `a-z 0-9 -`, no leading or trailing hyphen.
    Drop filler words.
  - `gh<issue>` — the GitHub issue number the branch works on (e.g. `gh12`). Ask whether there is
    one when the request does not say; omit it when the user confirms there is none. Several
    issues are appended in order.
- An existing branch, including a PR's head branch, keeps its original name.
- A new branch starts with no fix notes: whoever creates it removes any
  `agents/.processes/fixes/<branch>.md` left in the main checkout
  ([agent-code-review](../skills/agent-code-review/SKILL.md#fixing-an-accepted-finding)), so a
  reused name inherits no stale invariants.
- Worktrees live under the sibling `console-worktrees/` directory, named after the branch
  ([agent-create-worktree](../skills/agent-create-worktree/SKILL.md)).

```
0xjevons/replay-tamper-hint
0xjevons/replay-tamper-hint-gh12
0xjevons/replay-tamper-hint-gh12-gh15
```

## Commits

- Commit only finished work, after the user approves the exact message — unless they already told
  you to commit. One commit per coherent change.
- Message: `[<scopes>] Subject`, optionally followed by a blank line and `-` bullets of logical
  changes. The squash builds the `main` commit from the PR title and body, so branch commits may
  stay one line; the detail belongs in the PR body.
  - Scopes are the areas touched, comma-separated: `[app]` (`src/`, and static files in
    `public/`), `[workspace]` (root config and manifests — `package.json`, the lockfile,
    `next.config.ts`, `tsconfig.json`, lint and test config, `.nvmrc`, `.npmrc`, `.gitignore` — the
    README and LICENSE, `.github/`, and `scripts/`), `[agents]` (`agents/` and the root
    `AGENTS.md` / `CLAUDE.md` links) — e.g. `[app,workspace]`.
  - Subject: imperative, specific, ≤ 72 chars including the tag, no trailing period.
  - Bullets use `-`, never `*`, and start with a verb such as `Add`, `Update`, `Fix`, `Remove`, or
    `Refactor`; logical changes, not file-by-file detail.
  - State what the commit does; no narration of discussion, design history, or review.
- No AI signatures anywhere — commits, PR titles and bodies, GitHub comments, or site metadata: no
  `Co-Authored-By`, `Generated with`, or tool badges.

## Local checks before push

Before a push that opens or updates a PR, check only what the change affects. GitHub runs the full
CI on the PR.

- Take the validation commands of the `.github/workflows/` jobs the change can affect and run
  them, each exiting zero. In `.github/workflows/ci.yaml` those are the `docs` job's
  `python3 scripts/check-docs.test.py` and `python3 scripts/check-docs.py`, run for every change,
  since moving or renaming a file can break a link as surely as editing a page; for a change under
  `agents/skills/agent-code-review/scripts/`, the `review-delta` job's
  `agents/skills/agent-code-review/scripts/review-delta-test.sh`; and, for a change under
  `.github/workflows/`, the `workflows` job's actionlint, at the version `ci.yaml` pins.
- `ci.yaml` runs the app's checks — `npm ci`, then `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build`, and `npm audit --audit-level=high` — each covers the whole project,
  so any change outside Markdown and `agents/` runs all six, `npm ci` first so the checks use the
  lockfile as CI installs it.
- A push to a draft PR may carry failing or skipped checks when the PR says which; every CI
  check passes before the PR is marked ready.
- Leave long-running checks — Lighthouse, browser runs, bundle analysis — to the steps that ask
  for them ([agent-build-feature](../skills/agent-build-feature/SKILL.md)).
- Never run a publishing or mutating step: registry logins, `npm publish`, releases, deploys
  ([no-deploy](no-deploy.md)), cache or artifact uploads, or repository writes.
- [context-discipline](context-discipline.md) counts a request to open or update the PR as
  approval for these checks; keep their output out of the prompt as it says.
- After the push, the PR's CI is the full check: read its result before asking for review.

## Push

- Push only on a request for that push; a request to make or commit changes is not one. A request
  to open or update a PR is.
- Read every check result before pushing. Never chain checks and the push in one command: a
  pipeline or a grep over a log can exit zero on a failed run.
- Force-push only your own unreviewed history, and only with `--force-with-lease`.

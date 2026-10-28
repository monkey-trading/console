# No guessing current state

Load on request when a task depends on state that may have changed since the last session.

**Rule**: Verify live state before acting or claiming.

- Check GitHub PRs, CI, reviews, branches, deploys, packages, Vercel deployments, model catalogs, and external docs from their current source.
- Use local git / repo files for local state; use GitHub, CI, and the deployed site itself (its pages and response headers) for remote state.
- Whether Vercel is connected is live state. Count it as connected only when Vercel reports a status on the commit in question (`gh pr checks <pr>`, or `gh api "repos/{owner}/{repo}/commits/<sha>/status"`); a deployment of an older commit does not prove it. Without that evidence, say the connection is unverified and use the local production build.
- Quote the command, source, PR, commit, run, or file that established the state.
- If current state cannot be checked, say what is unverified and avoid merge / deploy / release claims.
- Memory can suggest where to look; it is not proof of current state.

**A green check is not the same as "everything ran".** Before reporting CI green, know which jobs
actually ran on that commit:

- A **cancelled** job is not a passed job. The first failing job cancels the whole run, and
  `fail-fast` cancels sibling matrix lanes as soon as one fails, so "only lane X failed" usually means the others never finished — check every lane's
  conclusion, not just the failures.
- Verify a push produced a new run: `git push` on an unchanged branch succeeds silently and
  triggers nothing, which looks identical to a real push. Match the run's `headSha` to the branch
  tip before believing a result belongs to your change.

Why: stale state causes false approvals, wrong deploy claims, duplicate fixes, and broken follow-up work.

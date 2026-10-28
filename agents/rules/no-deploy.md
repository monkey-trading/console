# No unapproved deploys

Load on request before any command that changes a live environment, and before merging a PR.

**Rule**: Never deploy or otherwise mutate a live environment without approval for that action.

- Once the owner connects the repository to Vercel, every merge to `main` deploys production. The
  merge gate is the deploy gate: a PR merges only on the owner's go-ahead in chat for that PR, as
  [agent-create-pr](../skills/agent-create-pr/SKILL.md#merging) describes. Treat every merge as a
  production deploy, whether or not Vercel is connected yet.
- Covers:
  - merging to `main`, and posting `merge-approved`, which allows the merge;
  - triggering a deploy by any other route: the `vercel` CLI (`deploy`, `--prod`, `redeploy`,
    `promote`, `rollback`), a deploy hook, or a redeploy from the dashboard;
  - changing Vercel project settings: build and install commands, framework and Node.js version,
    the Git connection, deployment protection, and anything else under the project's settings;
  - reading or writing environment variables in any Vercel environment, including
    `vercel env pull`, which copies their values into a local file;
  - adding, removing, or reassigning domains and aliases, and any DNS record at Vercel or the
    registrar;
  - linking a checkout to a Vercel project (`vercel link`);
  - changing GitHub repository settings, rulesets, Actions secrets, or variables, which can bypass
    the merge gate.
- A push to any branch other than `main` builds a preview deployment through Vercel's Git
  integration once the repository is connected. That preview is expected and needs no approval of
  its own; the push itself still follows [git-workflow](git-workflow.md). Reading a preview or
  production page in a browser, or its response headers with `curl -sI`, changes nothing and is
  not a deploy.
- `next dev` or `next start` on the agent's own machine is not a live environment; a Vercel
  preview or production deployment, the domain, and its DNS are.
- Approval covers one action. A yes to merge one PR is not a yes to merge another or to change an
  environment variable, and a yes to redeploy a preview is not a yes to deploy production.
- When in doubt, propose the exact command and wait.

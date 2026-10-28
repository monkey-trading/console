# Agent code review: severity guide

Load for every [agent-code-review](../SKILL.md) run, and hand its absolute path to every
multi-agent reviewer. Grade each finding by its impact; confidence is a separate field.

- **Critical** — a security breach (script injection, a secret in the client bundle), visitor data
  sent to a third party, public copy that misstates risk or presents the project as a live offer or
  an investment, or an active bypass of a safety or process rule.
- **High** — wrong behavior on a realistic path (a broken section, a hydration failure, a control
  the keyboard or a screen reader cannot use), a silent failure (an error swallowed so a panel or a
  verdict shows stale state), a false claim about the engine, a weakened security header, an
  unsafe rollout, or a violation of a safety or process rule.
- **Medium** — wrong behavior on an edge path, an untested changed branch, a test that does not
  test what it claims, a failure path nobody would notice, a WCAG 2.2 AA failure off the main
  path, or a performance budget missed.
- **Low** — maintainability or consistency cost with no behavior impact.
- **Nit** — style or wording.

Safety and process rules are those whose breach does harm by itself:

- `no-deploy`;
- secrets;
- the development checklist's privacy rules;
- its public-copy rules on engine claims and status, competitor names, internal build management,
  investment claims and the risk notice, and names and contacts;
- pushes or GitHub posts without approval;
- `no-guessing-current-state`.

Any other rule or skill — imports, naming, comments, formatting, `minimal-change` — is graded by
its impact like any other finding, usually Low or Nit.

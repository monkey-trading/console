---
name: agent-plan-feature
description: >
  Use when turning a spec or project brief into GitHub issues, or re-planning an existing project —
  "break this spec into issues", "plan the build", "organise the milestones", "which features are
  ready". Groups the work into complete features that each ship as one PR, work end to end on a
  production build checked in a browser, and can go live at merge; gates each feature on the
  decisions it needs; writes issues that cite their sources. The user revises and approves the plan
  before any issue write.
---

# agent-plan-feature

Turn a spec into a short list of features, each a complete, cohesive change that ships as one PR.
Implementation is now the cheap part; human review time, context, and wrong guesses are the
expensive ones. Settle the shape of the work here, so each feature is reviewed once, checked in
dev, and goes live at merge. Build a planned feature with
[agent-build-feature](../agent-build-feature/SKILL.md).

## What a feature is

- **Vertical.** One capability a visitor can see and use, end to end: its copy, its components,
  the pure logic in `src/lib` and its tests, its metadata, and any header or config change it
  needs. A layer on its own (a `src/lib` module no component uses, a set of theme tokens, a
  component nothing renders) is not a feature.
- **Copy follows the engine.** A feature that describes or demonstrates engine behaviour depends on
  that behaviour being settled in the engine's README or its decision issues in
  `monkey-trading/engine`. An open engine decision blocks it like any other decision.
- **Testable in dev.** A scenario someone can run with an observable result in a browser. Until
  the repository is connected to Vercel, dev is a local production build served on a free port, as
  [agent-build-feature](../agent-build-feature/SKILL.md#dev) describes; once it is, dev is the
  branch's preview deployment. When dev cannot show it (an asset, a channel, or a link target is
  missing), how dev will show it is a decision that blocks the feature.
- **Promotable.** A merge deploys production, so the feature goes live on its own at merge and
  leaves nothing half-built on the page: no placeholder section, dead link, or claim that waits for
  a later feature. Its promotion notes name any engine change or other feature that must be live
  first, and anything the owner must set at Vercel.
- **Reviewable in one round.** One idea a reviewer can hold at once. The first signal is the
  feature's shape: if its dev scenario could be cut into two that each end in a result someone can
  check in a browser, look for a seam there, a split into features that each keep their own dev
  scenario. Common seams:
  - one section apart from another: the replay demo apart from the shell;
  - a static version of a section before its interactive one, when the static version is worth
    shipping on its own;
  - one interaction of a widget apart from the next: replaying a published log before tampering
    with it.

  A seam is a reason to look, not to split: each extra feature costs its own dev check and
  review, so a small feature with two interactions can stay whole. Size is the backstop, counting
  production code and tests, not docs, lockfiles, generated files, or binary assets. Past about 5k
  lines, look for a seam, and when there is none, record why. Past about 10k, a PR is rarely one
  idea: split unless the user agrees there is no seam. Never split by layer.
- **Thin first.** A new section starts with a walking skeleton: the narrowest path through its
  copy, logic, and component, running in dev. Later features widen it. Shared code (a hashing
  helper, the motion switch, a formatter) belongs to the first feature that needs it, not to a
  feature of its own.

## Readiness

A feature is **Ready** only when every decision its design depends on is made and recorded where
the team records decisions: the spec, or the decision issue that owns it — and, for engine
behaviour the copy follows, the engine's README or its decision issues. When two records disagree,
the newer record wins, and the plan lists each one it followed. While a decision is open, the whole
feature is **Not ready**: never build its defined parts early. They are quick to write and slow to
review, and the open decision can still reshape them. GitHub shows readiness with labels:
`ready-to-build`, or `pending-design` with the open decision issues linked as blockers.

- **What gates.**
  - A choice about what the site tells or asks of visitors — a claim about the engine, the risk
    notice, anything collected from them, a new external service or origin — blocks the build.
  - A value the owner supplies later (a channel link, a domain) blocks promotion, not the build:
    name it under the feature's promotion with its owning issue.
  - An internal interface or schema that only the feature uses is settled in its PR review.
- **Decisions and evidence** (legal text, vendor terms, accessibility audits) are their own issues,
  titled `Decision: …` or `Evidence: …`. Each has a proposed owner, sits in the milestone of the
  first feature it blocks, and blocks the features that need it through GitHub's blocked-by
  relationship (plus a `Blocked by #<n>` line in the blocked issue's body). A decision the engine
  owns stays in `monkey-trading/engine`; the blocked issue says
  `Blocked by monkey-trading/engine#<n>`.
- **Platform prerequisites** (the Vercel project and its Git connection, the domain and its DNS,
  a channel or contact the page links to), which the owner sets up, belong to the first feature
  that needs them, or form a feature of their own, with its own dev scenario, when several share
  them. They are never left for the end.
- **Conditional features,** which exist only if a decision goes one way, are listed in the plan as
  conditional and created when the decision lands.

## Issue structure

- **One issue per feature.** Its description holds, each item citing its source (spec link and §,
  or decision issue):
  - **Readiness:** the `ready-to-build` or `pending-design` label, with each open decision issue
    linked as a blocker.
  - **Acceptance criteria.** A criterion with no source is an assumption and says so.
  - **Dev scenario:** the steps in a browser and the result that prove the feature works in dev.
  - **Promotion:** what going live needs — anything the owner must set at Vercel, ordering
    against an engine change, rollback beyond a revert, and the features that must be live first.
  - **Size:** the rough size of its PR and, past about 5k lines, why it has no seam.
- **Implementation steps are a checklist in the feature issue,** not issues of their own. Separate
  issues for parts of one feature become separate PRs and separate reviews.
- **Milestones are shippable features in delivery order,** not technical layers. Each milestone ends
  with something a visitor can use.
- The feature's builder owns the feature issue; decision owners own decision issues.

## Re-planning an existing project

- Read every issue and its comments first; decisions often live there rather than in the spec.
- Give each issue one disposition: **host** (rewritten as a feature issue), **merged** (closed as a
  duplicate, its criteria copied into the host), **placed** (done work a feature consumes),
  **decision**, **evidence**, or **drop** with a reason. Rewrite an issue rather than closing it
  and creating another, so history and links survive.
- Code already merged as a layer stays. Place it in the first feature that consumes it, and check it
  against that feature's decisions as they land.

## Process

1. Read the spec end to end, then the engine README and decisions the copy depends on, and the
   components and `src/lib` modules the features would reuse, so gaps show up now rather than at
   merge.
2. Draft the feature list: title, the capability in one line, dev scenario, decisions needed,
   dependencies, and a rough size of its PR. Expect features, not tasks: a large spec yields tens
   of features, not one issue per module. Until the issues exist, number features in delivery
   order (F1, F2, …) and say the numbers become issue numbers on creation.
3. Walk each feature for what must exist before it works in dev and goes live — the engine facts
   it states and their sources, assets (images, fonts), the Vercel project and domain, environment
   variables, the channels and pages it links to, and the owner's approvals (privacy, external
   services). A need with no home is a gap; add it to a feature.
4. For a large spec, have the draft reviewed independently through
   [ask-agent](../ask-agent/SKILL.md), by the other model family from the one that drafted it, with
   read-only access. Give the reviewer the spec, the plan, the repo, and the decisions the plan
   takes from outside the spec. Ask for gaps, features that are not vertical, large features with
   a seam the plan missed, and Ready verdicts that rest on an open decision. Apply each finding or
   record in the plan why not; re-review only if the feature list changes.
5. Show the user a one-screen summary — features in order with readiness, the decisions on the
   critical path, the milestones — with the full plan and the exact issue text in files under the
   gitignored `agents/.processes/plans/<YYYY-MM-DD>-<kebab-slug>/`. Revise it
   with them until they approve, then write the approved plan to GitHub (issues, labels,
   milestones) in one batch. agent-build-feature builds from that approved plan, so afterwards
   change the issues and the plan together.

## Rules

- Never create, edit, or close a GitHub issue, label, or milestone without the user's explicit
  approval.
- Never mark a feature Ready so work can start sooner.
- Re-plan when a decision lands that changes a Ready feature; say which features it moved.
- Writing follows [writing-style](../../rules/writing-style.md).

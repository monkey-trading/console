# Development checklist

Load at the start of every coding task, before the first edit, and keep it applied until the work
is done; load it for every code review.

**Rule**: It lists what a change must not miss, and it governs every stage — not a final gate.

## How to use it

- **Before the first edit:** read the applicable sections; they shape the design and the plan.
  Design comes first.
- **While writing code:** apply each applicable item as you write. Accessibility, hydration,
  privacy, error handling, and tests are built in from the start, never bolted on at the end.
- **Before calling the work done or opening the PR:** self-review the final diff against every
  applicable section and fix what it finds.
- **Reviewing someone else's change:** walk the same sections over their diff.
- A section applies when the change touches what its **When** line names; sections without one
  always apply.
- Each item is a question. An unmet item the code, config, or tests can settle is a defect: fix it
  while developing, report it while reviewing. An item they cannot settle — one that needs a
  browser, a Lighthouse run, or the deployed site — is checked there or stated as unverified,
  never assumed.
- Weigh each item against what the code is for and where it runs. A test helper or a dev-only
  path does not owe production hardening: note an item that does not apply, with the reason,
  rather than adding machinery for it. Every guard you add names the concrete scenario on this
  site that needs it.

## 1. Intent and scope

- Does the change do what its issue or task asks, and is anything it requires missing?
- For a feature: is it complete — every acceptance criterion met, its dev scenario's browser check
  passing on a production build — and does any part of its design still wait on an open decision
  ([agent-plan-feature](../skills/agent-plan-feature/SKILL.md))?
- Does the change carry edits unrelated to that intent?
- Is the solution sized to the problem — no speculative abstraction, configurability, or
  abstraction with one caller ([minimal-change](minimal-change.md))?

## 2. Design and data flow

When: new modules or components, the server and client boundary, content or data sources, new or
updated dependencies.

- Which module owns each value and each claim? Is there one source of truth — the engine's rules
  and status in `src/lib/content.ts`, links and identity in `src/lib/site.ts`, rules mirrored from
  the engine in their `src/lib` module — or can two copies drift?
- Trace the data end to end: where it is defined, whether it is computed at build time or in the
  browser, and what crosses from server to client components as props.
- In the code the change touches, does each layer do only its own job? `src/lib` computes and holds
  content, with no React, DOM, or browser API; components render that state and wire events;
  `src/app` composes routes, metadata, and layout.
- What new dependencies — packages, services, origins — does it introduce, and what does a visitor
  see if each fails or is slow?
- Is each new library needed — nothing in the project, the platform, React, or Next.js already does
  it — and within the dependency rules of
  [web-implementation](../skills/web-implementation/SKILL.md)?
- Is each new dependency from its official registry or upstream repository, with its exact name and
  publisher verified against typosquatting?
- Does each dependency bump link its changelog or release notes and confirm that the resulting
  behavior is expected?
- Is it consistent with similar implementations in the repository, and is any departure
  justified?

## 3. TypeScript

When: any `.ts` or `.tsx` file, `tsconfig.json`.

- Do `strict` and `noUncheckedIndexedAccess` stay on, with nothing in `tsconfig.json` loosened?
- Is there no `any`, `@ts-ignore`, `@ts-expect-error`, or `eslint-disable` that the user did not
  approve, and does each approved one carry a comment saying why?
- Is there no non-null assertion (`!`)? A value that may be absent is narrowed, and an absence our
  own code cannot produce throws an `Error` that says what was missing.
- Is every type assertion (`as T`, other than `as const`) one the type system cannot follow, with
  a comment on why the type holds?
- Are states and kinds unions of literal types or discriminated unions rather than loose strings
  or boolean flags, and does every `switch` over one handle each member, with a `never` check?
- Does `npm run typecheck` pass?

## 4. React and Next.js

When: components, hooks, anything under `src/app/`, `next.config.ts`.

- Is each component a server component unless it needs state, effects, event handlers, or a
  browser API? Is `"use client"` on the smallest component that needs it, never on a page or
  layout, and are the props crossing that boundary plain serializable data?
- Does code that runs in the browser read no `process.env` value but a `NEXT_PUBLIC_*` one or
  `NODE_ENV`? Next.js inlines only those into client bundles from the environment, so any other
  read there is `undefined`: a function that reads one, such as `siteUrl()`, is called only from
  server files. Is `next.config.ts` free of an `env` key, which ships its values to the client
  whatever their names?
- Does the first client render match the server HTML? Nothing in render reads the clock,
  randomness, `window`, `document`, or locale- and timezone-dependent formatting; browser-only
  values arrive through `useSyncExternalStore` with a server snapshot. A hydration warning in the
  browser console is a defect.
- Does every effect survive StrictMode's development double run (setup, cleanup, setup) with no
  leaked timer, listener, observer, or subscription, and does its cleanup undo exactly what its
  setup did? Does async work started in an effect ignore its result after cleanup?
- Is each effect synchronizing with something outside React? A value derivable from props or state
  is computed in render, and a response to a visitor's action runs in the event handler.
- Are hook dependency lists complete, with no `react-hooks` rule silenced?
- Are list keys stable ids from the data, never the array index of a list that inserts, removes,
  or reorders?
- Is no `ref.current` read or written during render?
- Does every route stay prerendered at build time — `○ (Static)` in the `next build` route table,
  or `● (SSG)` with `dynamicParams = false` so no unlisted path renders on demand — with no
  request-time API (`cookies()`, `headers()`, `connection()`, `searchParams`, uncached `fetch`)
  and no `dynamic` export?
- Does the change add a route handler (`route.ts`), server action, `proxy.ts` (or the deprecated
  `middleware.ts`), or `next/script` tag? Each needs the owner's approval first: the site has no
  backend. Metadata routes (`robots.ts`, `sitemap.ts`, `manifest.ts`, image routes) are fine while
  they stay static.

## 5. Simulations and engine rules

When: `src/lib` simulations and demos, anything that mirrors an engine rule, anything rendered
during the build.

- Is every rule the page demonstrates (the index median, freshness and divergence checks,
  rounding, state roots) the engine's rule as its README or code states it, with its source cited
  in a comment?
- Are values that mirror engine state — prices, amounts, basis points — integers in a stated unit
  (cents, thousandths, basis points) with the engine's rounding (truncation toward zero), never
  floats? Floats are for layout, animation, and the seeded generator's draws, never for a value
  that mirrors engine state.
- Is every simulation seeded, with time taken from its tick count, never the wall clock, so the
  server-rendered first frame, the client's first frame, and the tests agree?
- Is hashing from `@noble/hashes`, never home-rolled?

## 6. Accessibility

When: anything rendered, styled, or animated. The bar is WCAG 2.2 AA.

- Contrast: does text reach 4.5:1 (3:1 at 24 px, or 18.66 px bold, and above), and do UI
  components, their states, and focus indicators reach 3:1, measured on the theme tokens actually
  paired?
- Keyboard: can everything be reached and operated with the keyboard alone, in an order that
  follows the reading order, with no trap, and does the skip link reach `main`?
- Focus: is focus visible on every interactive element and never hidden behind sticky content, and
  does an action that replaces content move focus somewhere deliberate?
- Landmarks and headings: is all content inside a landmark — `header`, `nav`, `main`, `footer` —
  with one `main`, a label on each `nav` when there are several, one `h1`, and no skipped heading
  level?
- Names and labels: does every control and input have an accessible name, a visible label where it
  takes input, and an `alt` on every meaningful image, with decorative SVG `aria-hidden`?
- Target size: is every pointer target at least 24 × 24 CSS px, or spaced or exempt (a link
  inside a sentence) as WCAG 2.5.8 allows?
- Motion: does everything that moves, blinks, or scrolls for more than five seconds have a pause
  control, does `prefers-reduced-motion` stop it until the visitor presses play, and does nothing
  flash more than three times a second?
- Changing content: are fast-changing figures `aria-hidden` behind a static description, and are
  results of a visitor's own action announced through a polite live region?
- Reflow and zoom: does the page work at 320 CSS px wide and at 200% text zoom with no horizontal
  scroll or lost content, and with WCAG text-spacing overrides applied?
- Does `npm run lint` (jsx-a11y strict) pass? Lint is not conformance: was the change checked with
  the keyboard and the accessibility tree in a browser, or stated unverified?

## 7. Performance

When: anything that changes what the page loads, renders, or animates — components, styles,
fonts, images, dependencies, `next.config.ts`.

- Does Lighthouse in its mobile configuration, against a production build, score 95 or more in
  each category: Performance, Accessibility, Best Practices, and SEO?
- The site collects no field data, so lab metrics are the measure: is LCP at most 2.5 s, CLS at most
  0.1, and Total Blocking Time (the lab stand-in for INP) at most 200 ms in that run?
- Does the change add client JavaScript — a new client component, a dependency a client component
  imports, code moved across the boundary — and is the growth needed and measured with
  `npx next analyze --output` before and after?
- Does every element reserve its space before it renders — images sized, fonts through `next/font`,
  simulated panels at their first frame — so nothing shifts the layout?
- Does every animation run on `transform` and `opacity` — paint-only properties such as
  `background-color` and `box-shadow` at most on small elements — never on layout properties, and
  does every timer or frame loop stop while paused, off screen, or in a hidden tab?
- Can anything grow without bound while the page stays open — a history, a log, a list of rows?

## 8. Security

When: `next.config.ts`, visitor input, links, environment variables, anything that injects markup.

- Are the security headers and the CSP in `next.config.ts` unchanged or tightened, with
  `'unsafe-eval'` in development only? Is any new source in the CSP approved by the owner first
  (section 9), and was the result read from the production build's response (`curl -sI`)?
- Is every secret kept out of source, `NEXT_PUBLIC_*` variables, the client bundle, and committed
  files? The site needs none.
- Is visitor input — shell commands, replay edits, the URL — parsed into typed values, rejected with
  a visible message when it does not parse, and rendered only as text? Nothing reaches `eval`,
  `new Function`, `innerHTML`, or `dangerouslySetInnerHTML`.
- Does every link that opens a new tab carry `rel="noopener noreferrer"`, is every link to another
  site `https:` (a `mailto:` link aside), and is there no `javascript:` URL anywhere?
- Is all crypto from vetted libraries, never home-rolled?

## 9. Privacy

When: anything that makes a request, stores data in the browser, or adds a script, font, image,
iframe, or embed.

- Does the change add analytics (Vercel Web Analytics and Speed Insights included), cookies,
  `localStorage`, `sessionStorage`, IndexedDB, trackers, fingerprinting, third-party scripts,
  fonts, images, or embeds? Each needs the owner's explicit approval first.
- Does the production build make any request to another origin while a visitor uses it? Check the
  browser's network panel: every request is same-origin, but for the engine node's origin once the
  owner has approved it ([AGENTS.md](../AGENTS.md)).
- Does anything a visitor types or does leave the browser? It must not, but for the orders,
  deposits, and withdrawals the app sends to the engine node.

## 10. Supply chain

When: `package.json`, `package-lock.json`, `.npmrc`, `.nvmrc`, `.github/workflows/`, and tools run
with `npx`.

- Is every dependency an exact version, with no `^`, `~`, tag, git, URL, or `file:` specifier?
- Is the lockfile written by npm, committed with the change, and installable by `npm ci`?
- Does `npm audit --audit-level=high` pass?
- Is every GitHub Action pinned to a full commit SHA with its version in a comment, with
  `permissions` no wider than the job needs and `persist-credentials: false` on checkout?
- Is a tool run with `npx` from outside the repository — Playwright, Lighthouse — pinned to an
  exact version of its official package?

## 11. SEO and metadata

When: `src/app/layout.tsx`, metadata files, `robots.ts`, `sitemap.ts`, the title or description.

- Do the title and description come from `src/lib/site.ts`, used the same way in `metadata`, Open
  Graph, and Twitter, with the meaning in their first words?
- Do `metadataBase`, the canonical URL, `robots.ts`, and `sitemap.ts` all resolve to the
  production origin through `siteUrl()`?
- Are the Open Graph and Twitter images 1200 × 630 with an `.alt.txt` each, and does their text
  match the page and follow section 12?
- Is the heading structure semantic, with link text that names its destination, `lang` set, and no
  `noindex` left behind?
- Is there no tool, generator, or AI attribution in metadata?

## 12. Public copy

When: any text a visitor or a crawler can read — the page, metadata, image text, alt text — and the
README.

- Does every claim about the engine — what it does, its rules, its status — match the engine's
  README on `main` in `monkey-trading/engine` and the decision issues there that settle it? Is
  anything not yet built marked as in build?
- Does `src/lib/content.ts` hold the engine's rules and status as the page lists them, and was
  every claim — there and in other copy — re-checked against the engine README when that changed?
- Does the copy state the project's status as the engine README does, implying nothing is live or
  holds real funds before it does?
- Does it name no competitor and no product the design is compared with or modelled on — brokers,
  trading apps, or protocols? Venues the index takes prices from and vendors the project uses may
  be named.
- Does it say nothing about internal build management: waves, milestones, the PR or review
  process, or AI agents and agent tooling?
- Is it sober: no price, return, yield, or investment claim about the protocol or any token, no
  promise of safety or profit, never an invitation to buy? Does every page that shows prices or takes
  an order carry a risk notice, in the root layout, saying that CFDs are complex and leveraged and
  losses can be rapid, that the software is pre-launch and nothing on the site is an offer, and
  where it is not available — with its substance changed only on the owner's instruction? (The
  placeholder page shows neither, so it carries none.)
- Are the only people, accounts, and contacts named those in `src/lib/site.ts` and the William
  Jevons persona, with no other person, account, or machine path?
- Is public prose written as prose, following [writing-style](writing-style.md)?

## 13. Rollout

When: routes, in-page anchors, `next.config.ts`, metadata, anything the owner must change at
Vercel.

- Is the change safe to deploy the moment it merges, and to roll back by reverting its PR?
- Do existing URLs and in-page anchors that others may have linked to still resolve?
- Does anything need an owner action at Vercel — an environment variable, a domain — and does the
  PR body say so as its own bullet? An agent makes that change only on the owner's explicit
  approval for it ([no-deploy](no-deploy.md)).

## 14. Errors

- Is every error handled or rethrown with context (`new Error("…", { cause })`), never swallowed
  by an empty `catch`?
- Is an expected outcome — a rejected command in the demo, a stale index — a value the UI renders,
  not an exception?
- Is every promise awaited, returned, or given a rejection handler?
- Is the shipped code free of `console` output?

## 15. Tests

- **They test what they claim.** A test's name matches its assertions, and each assertion would
  fail if the behavior broke. No tautologies, no asserting that a mock returned what it was told,
  no bare `toBeTruthy()` or `toBeDefined()` or no-throw check where the value matters.
- **Mutation-checked when the tests run anyway.** For a new or changed test, make one temporary
  edit to the code under test that breaks exactly what the test's name claims, and run it: that
  test must fail and nothing unrelated should. Undo the edit by hand, never with `git checkout` or
  `git restore`, which also discard uncommitted work. A test that stays green is a defect. Without
  a test run, ask: if this line were inverted, which assertion would fail?
- **They cover the changed branches.** The success path, every new or changed error path,
  boundaries (zero, empty, maximum, off-by-one), missing or `undefined` inputs, and every failure
  mode sections 2–14 found.
- **Right level.** Vitest unit tests for logic in `src/lib`; behavior that only a browser shows is
  checked on a production build through the dev scenario. End-to-end coverage is the operator's
  call.
- **Deterministic.** No sleeps or real timers; time and randomness come in as arguments or a seed;
  no network; no dependence on test order or on shared module state.
- **Regression.** A bug fix carries a test that fails without the fix.
- **Not weakened.** A deleted, skipped (`.skip`, `.todo`), or focused (`.only`) test, a loosened
  assertion, or a widened tolerance is a defect unless the PR justifies it.
- **Realistic data.** Values mirroring the engine use their stated units and the engine's
  rounding; fixtures match real shapes.
- **Actually runs.** The tests sit under `src/` as `*.test.ts`, the pattern `vitest.config.ts`
  includes and CI runs.

## 16. Code quality and domain skills

- Does the change follow every `*-implementation` skill for the files it touches — these, and any
  other the [AGENTS.md](../AGENTS.md) index lists?
  - [web-implementation](../skills/web-implementation/SKILL.md) — TypeScript, React, Next.js,
    Tailwind, and the site's configuration.
- Does it add mutable module-level state — a `let` or a mutable collection at module scope, a
  singleton? On the server it is shared by every render; in the browser by every component and
  every test in the file. web-implementation lists the exceptions.
- Clean and idiomatic, with no dead code, unused dependencies, or leftover debugging the change
  created.
- Names come from the design or issue vocabulary, spelled out (`divergenceBps`, not `d` or
  `data`). A constant or variable whose name no longer describes its use gets a new name, not a new
  use.
- Comments are terse and describe current behavior ([code-comments](code-comments.md)).

## 17. Docs and indexes

- Are the nearest `AGENTS.md` and the README updated for changed commands, paths, environment
  variables, or behavior ([keep-agents-index-in-sync](keep-agents-index-in-sync.md))?

## 18. Workspace rules

- Does the change follow every rule and skill [AGENTS.md](../AGENTS.md) selects for it?

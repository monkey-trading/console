---
name: web-implementation
description: Use when writing, editing, or reviewing the site's code or configuration in this repo — TypeScript, React, Next.js, Tailwind CSS, and their config files. Covers the version-matched Next.js docs, TypeScript, error handling, input-handling doctrine, determinism of the simulations, numbers that mirror the engine, React 19 server and client components, hydration, effects under StrictMode, module-level state, the App Router and static rendering, metadata and Open Graph images, security headers and CSP, configuration, Tailwind CSS 4, next/font, accessibility, animation and reduced motion, performance, privacy, public copy, dependencies, testing with vitest, file structure, the file line cap and module splits, the README, build configuration, and comments and TSDoc.
---

Load when implementing or modifying the site's code or configuration, or reviewing such a change.

## Framework reference

Next.js 16 ships documentation that matches the installed version in `node_modules/next/dist/docs/`
(present after `npm ci`). Training data and the public Next.js docs may describe another version.

- Before writing Next-specific code — file conventions, metadata, fonts, images, rendering,
  caching, `next.config.ts` — read the relevant guide there. The App Router docs are under
  `01-app/`; `02-pages/` covers the Pages Router, which this site does not use.
- Search the tree with `rg` and load only the guide the change needs, never the whole tree.
- Heed its deprecation notices. The repo conventions below and the rules win when they conflict
  with the docs' defaults; say so when they do.
- React has no bundled docs: use react.dev after checking that it documents the major version in
  `package.json`.
- `next.config.ts` keeps `agentRules: false`. Without it, `next dev` writes a managed block into
  `AGENTS.md`, which this repo curates by hand; never commit that block.

## General

- TypeScript for all source: `.ts`, or `.tsx` when the file holds JSX; `allowJs` stays off. Root
  config files may be `.mjs` where the tool expects it (`eslint.config.mjs`, `postcss.config.mjs`).
- Node.js from `.nvmrc`; npm only, with `package-lock.json` committed — no other package manager
  or lockfile.
- `strict` and `noUncheckedIndexedAccess` stay on; never loosen `tsconfig.json` to make code
  compile.
- Keep code simple and idiomatic — use current TypeScript and React features without
  overcomplicating.
- Avoid escape hatches: `any`, `@ts-ignore`, `@ts-expect-error`, and `eslint-disable`. If one is
  unavoidable, ask first, prefer `@ts-expect-error` (it fails once the error is gone), and
  document the line and the reasoning in a comment.
- No non-null assertions (`!`). Like an unchecked unwrap, a wrong assumption surfaces later as an
  unrelated `TypeError`. Narrow instead; where absence is an internal invariant, throw an `Error`
  that says what was missing.
- No type assertions (`as T`, `as unknown as T`) where narrowing works; `as const` is fine. One the
  type system cannot follow (`Object.fromEntries` over a fixed key list) gets a one-line comment on
  why the type holds. Check a constant table with `satisfies` rather than a cast.
- Lean on the type system: literal and discriminated unions for states and kinds
  (`status: "price" | "stale" | "divergent"`), `readonly` arrays and properties for content and
  constants, and an exhaustive `switch` that ends in a `never` check. Prefer clear domain types
  over loose strings and boolean flags.
- Named exports, except where Next.js or a tool requires a default export (`page.tsx`,
  `layout.tsx`, `robots.ts`, `sitemap.ts`, image routes, config files).
- `import type`, or an inline `type` specifier, for type-only imports.

## Iterators and loops

- Prefer array methods (`map`, `filter`, `reduce`, `flatMap`, `some`, `every`) where they read
  better; use `for … of` where it reads better or must stop early. Never `for … in` over an array.
- Avoid nested loops, and never mutate an array while iterating it.

## Error handling

- Throw `Error` objects, never strings or other values, with a message naming what failed; rethrow
  with context through `cause` (`new Error("…", { cause })`).
- No empty `catch`, and no `catch` that logs and carries on as if nothing happened.
- An expected outcome is a value, not an exception: a stale index is `{ status: "stale" }`, and a
  command the demo's rules refuse is a result the UI shows — as in the engine, where a rejection is
  an event in the log, not an error.
- Every promise is awaited, returned, or given a rejection handler.
- No `console` output in shipped code; the site has no logging or error-reporting service
  ([Privacy](#privacy)).

## Input-handling doctrine

The site takes input from visitors — the shell, the replay demo's edits, the URL — and from the
build environment (`SITE_URL` and the variables Vercel sets). Classify every failed check on such
input:

- **Detected error or inconsistent input → never act on it.** Show the visitor what was refused
  and why, change nothing else, and never "recover" by guessing what they meant. A simulation
  behaves as the engine does: a stale or divergent quote set means no price, not the last price.
- **Visitor input is untrusted.** Parse it into a typed value at the boundary — the shell turns a
  line into a known command or an error line — bound its length, and render it only as text through
  React. Never pass it to `eval`, `new Function`, `innerHTML`, or `dangerouslySetInnerHTML`, and
  never build a `RegExp` or a link target from it.
- **Bad build input fails the build.** A malformed environment value must stop `next build`
  (`new URL(siteUrl())` throws on a bad `SITE_URL`) rather than ship a wrong canonical URL.
- **Internal invariants — states our own code cannot produce without a bug → throw an `Error`.**
  Add a terse comment on why the state is (almost) impossible. Never `console.assert` or a silent
  fallback. A broken invariant then fails a unit test or the build, before it reaches a visitor.
- The same check applied to several inputs lives in one shared helper, not copies.

## Determinism (simulations)

The page's panels simulate the engine. The build renders their first frame on the server, the
browser carries on from it, and the tests replay them, so one seed must give the same frames
everywhere.

- No `Math.random()`, `crypto.getRandomValues()`, `Date.now()`, `new Date()`, or
  `performance.now()` in `src/lib` or in render. Randomness comes from the seeded generator in
  `src/lib/prng.ts`; time is the simulation's tick count.
- Every input a simulated decision depends on — quotes, ticks, parameters — is an argument or part
  of the seeded state, so a test can reproduce any frame.
- A value that is hashed is serialized canonically, with object keys sorted at every level and
  `undefined` dropped, as `canonicalJson` in `src/lib/replay.ts` does.
- Hashing uses `@noble/hashes` (keccak-256 for state roots, as the engine does).

## Numbers that mirror the engine

- Prices, amounts, quantities, and rates that mirror engine state are integers in a stated unit —
  cents, thousandths, basis points — never binary floats. Name the unit in the identifier or its
  TSDoc (`divergenceBps`, "a venue's latest mid, in cents").
- Integer division truncates toward zero (`Math.trunc`), matching the engine's fixed-point
  arithmetic; any other rounding is the engine's own rule for that value, cited in a comment.
- Values stay within `Number.MAX_SAFE_INTEGER`; one that could exceed it is a `bigint`.
- Display formatting goes through `src/lib/format.ts`, which formats without the visitor's locale,
  so the server and the browser render the same text. Floats are for layout, animation, and the
  seeded generator's draws, never for a value that mirrors engine state.

## React

- Server components by default. `"use client"` goes on the smallest component that needs state,
  effects, event handlers, or a browser API — never on a page or layout. Props from a server to a
  client component are plain serializable data: no functions, class instances, or symbols.
- **Hydration.** The first client render must equal the server HTML. Nothing in render reads the
  clock, randomness, `window`, `document`, `navigator`, `matchMedia`, or the visitor's locale or
  timezone. Browser-only state comes through `useSyncExternalStore` with a server snapshot, as
  `useMotion` does. `suppressHydrationWarning` never silences a mismatch.
- **Effects synchronize with systems outside React** — timers, observers, listeners,
  subscriptions — and nothing else. Compute derived values during render, respond to a visitor in
  the event handler, and never copy props into state through an effect.
- **StrictMode is on** (`reactStrictMode: true`), so in development every effect runs setup,
  cleanup, setup. Each cleanup undoes exactly what its setup did, and async work started in an
  effect ignores its result after cleanup (an `ignore` flag or an `AbortController`).
- Hooks follow the `react-hooks` lint rules with complete dependency lists. A callback an effect
  calls but must not re-run on is wrapped in `useEffectEvent`, never mirrored into a ref.
- Memoize (`useMemo`, `useCallback`, `memo`) only for a measured cost or an identity a dependency
  list needs.
- Keys are stable ids from the data (a sequence number, a venue), never the index of a list that
  inserts, removes, or reorders.
- Refs are read and written in effects and handlers, never during render.
- Controls are native elements: `<button type="button">` for actions, `<a href>` for navigation,
  and a `<form>` with `onSubmit` for input that submits. No click handler on a `div` or `span`.
- Ids that tie labels, descriptions, and controls together come from `useId`, never hand-built
  strings that collide when a component renders twice.

## Module-level state

No mutable module-level state. A `let` or a mutable collection at module scope is shared by every
render of the build on the server, by every component instance in the browser, and by every test
in a test file: a test cannot reset it, and a second instance of a component cannot have its own.

- **Keep state in components and pass it down,** or derive it.
- **Allowed:** immutable values that depend on nothing at runtime (`readonly` tables, `as const`
  content, compiled regular expressions); and one browser-only external store per concern, read
  through `useSyncExternalStore` with a server snapshot and written only from event handlers, like
  the pause switch in `src/components/motion.tsx`.
- Never write module-level state during a server render.

## Next.js App Router

- The site is statically rendered: every route prerenders at build time, and `next build` marks it
  `○ (Static)`, or `● (SSG)` for a dynamic segment whose `generateStaticParams` lists every path
  and whose `dynamicParams = false` stops any other from rendering on demand. Never use a
  request-time API — `cookies()`, `headers()`, `connection()`, `draftMode()`, a page's
  `searchParams` — an uncached `fetch`, or a `dynamic` export. Read the route table after every
  change under `src/app/`.
- Keep the default build output, never `output: "export"`: a static export drops the `headers()`
  that carry the security headers.
- No backend: no route handler (`route.ts`), server action (`"use server"`), `proxy.ts` (or the
  deprecated `middleware.ts`), or runtime data fetching without the owner's approval. Metadata
  routes (`robots.ts`, `sitemap.ts`, `manifest.ts`, image routes) are special route handlers that
  Next.js prerenders; they are fine while the build marks them prerendered.
- Route files follow the App Router file conventions in `src/app/`: `layout.tsx`, `page.tsx`, and
  the metadata files (`icon.svg`, `apple-icon.png`, `opengraph-image.png` and `twitter-image.png`
  with their `.alt.txt`, `robots.ts`, `sitemap.ts`).
- `next/link` for links between routes, a plain `<a href="#id">` for in-page anchors, and a plain
  `<a>` with `target="_blank"` and `rel="noopener noreferrer"` for external links.
- Raster images go through `next/image` with a static import or an explicit `width` and `height`,
  and an `alt`. Decorative inline SVG carries `aria-hidden="true"`.
- No `next/script` and no third-party script without the owner's approval
  ([Privacy](#privacy)).

## Metadata and Open Graph images

- `src/app/layout.tsx` exports `metadata` and `viewport`. `metadataBase` comes from `siteUrl()`,
  the canonical URL is `/`, and the title and description are the constants in `src/lib/site.ts`,
  shared by `metadata`, `openGraph`, and `twitter`.
- `themeColor` and `colorScheme` belong to the `viewport` export, never `metadata`.
- Open Graph and Twitter images are 1200 × 630 PNGs beside the route (`opengraph-image.png`,
  `twitter-image.png`), each with an `.alt.txt` that describes it. Text in an image follows the
  copy rules and matches the page. An image generated in code (`opengraph-image.tsx` with
  `ImageResponse`) prerenders at build time from fonts in the repository, with no network fetch.
- `robots.ts` and `sitemap.ts` build absolute URLs from `siteUrl()`.
- No `generator`, tool, or AI attribution anywhere in metadata.

## Security headers and CSP

`next.config.ts` sets the headers on every path (`source: "/:path*"`). Keep each:

- `Content-Security-Policy`: `default-src 'self'`; `script-src 'self' 'unsafe-inline'`, plus
  `'wasm-unsafe-eval'` in a live build (the engine's verifier is WebAssembly) and
  `'unsafe-eval'` in development only; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data:`;
  `font-src 'self'`; `connect-src 'self'`, plus the approved engine node's `https:` and `wss:` host once there is one;
  `object-src 'none'`; `base-uri 'self'`;
  `form-action 'self'`; `frame-ancestors 'none'`. A statically rendered page is built once for
  every visitor, so its inline bootstrap scripts cannot carry a per-request nonce;
  `'unsafe-inline'` covers them, and the policy allows nothing from another origin but the approved engine node's
  and, in a build with a WalletConnect project id, WalletConnect's relay (`wss://relay.walletconnect.org`,
  approved in monkey-trading/console#7) in `connect-src`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, and a `Permissions-Policy`
  that turns off `camera`, `microphone`, `geolocation`, `payment`, `usb`, and `browsing-topics`.
  Add a feature to that list only once browsers recognise it, since an unknown one logs a console
  error.
- `poweredByHeader: false`.
- Never widen the CSP with a wildcard, a scheme source such as `https:`, or another origin
  without the owner's approval; the engine node's origin is the one expected. A new origin is a
  privacy change and needs that approval first ([Privacy](#privacy)).
- Read the headers from the production build, not only the config: `npm run build`, then
  `npm start -- --port <port>` on a free port (`next start` exits rather than move when the port
  is taken), then `curl -sI http://localhost:<port>/` once its log says it listens there. On a
  deployment, read the deployed response too; the host can add headers of its own.
- `dangerouslySetInnerHTML` only for JSON-LD built from constants at build time, with every `<`
  escaped as `\u003c` (`JSON.stringify(data).replace(/</g, "\\u003c")`), so no value can close
  the script element; never for anything a visitor or the environment supplies.

## Configuration and environment

- The site needs no secret and no runtime environment variable. Two are read at build time, both
  in `siteUrl()` in `src/lib/site.ts` and nowhere else (apart from the `NEXT_PUBLIC_ENGINE_*` values
  `src/lib/engine/deploy.ts` reads, which pin the live node a build talks to): `SITE_URL`, an optional override of the
  canonical origin, and `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets.
- A new variable needs a safe default or a build that fails without it, a line in the README's
  deployment section, and the owner to set it at Vercel; an agent sets it only on the owner's
  explicit approval for that action ([no-deploy](../../rules/no-deploy.md)).
- From the environment, only `NEXT_PUBLIC_*` variables and `NODE_ENV` reach the browser, and
  everything in them is public; never put anything secret in one. `next.config.ts` has no `env`
  key: values set there ship to the client whatever their names.
- No `.env` file is committed (`.env*` is gitignored), and none is needed to build or run the site.
- **Classify every new constant.** Claims about the engine go in `src/lib/content.ts`; links,
  contact, and site identity in `src/lib/site.ts`; a simulation's parameters beside that
  simulation in `src/lib`; colours, type sizes, and animations in the `@theme` tokens of
  `src/app/globals.css`.

## Tailwind CSS and styles

- Tailwind CSS 4, configured in CSS: `src/app/globals.css` imports `tailwindcss` and declares the
  design tokens in `@theme`, and PostCSS runs `@tailwindcss/postcss`. There is no
  `tailwind.config.*` file.
- Class detection is limited to `src/`: `globals.css` imports Tailwind as
  `@import "tailwindcss" source("..");`, a path relative to the stylesheet. Without the limit,
  Tailwind scans every file git does not ignore, so words and example classes in `agents/` or the
  README would add rules to the stylesheet every visitor downloads.
- Colours come only from theme tokens (`text-fg-2`, `border-line-2`, `bg-glow`). A raw colour in a
  class (`bg-[#8affc0]`) or a `style` is a defect: contrast is checked per token pair, and an
  off-token colour escapes that check. A new colour is a new `--color-*` token, checked against
  every background it sits on.
- Arbitrary values (`text-[0.6875rem]`) are for one-off adjustments. A value repeated across files
  is a design decision: it becomes a `@theme` token (`--text-*`, `--tracking-*`) used by name.
- Style in the markup with utility classes. `globals.css` holds only the tokens, keyframes, base
  element styles, shared classes no utility expresses, and the reduced-motion rule. No CSS modules
  or CSS-in-JS.
- Mobile first: unprefixed classes style the narrowest screen, 320 CSS px, and `sm:`, `md:`, and
  `lg:` add to it. Nothing scrolls horizontally at 320 px.
- Compose conditional classes with template literals; a class-merging package is a dependency
  decision ([Dependencies](#dependencies)).
- No `!important` outside the reduced-motion rule.

## Fonts

- Fonts load through `next/font` only: `next/font/google` downloads them at build time and serves
  them from the site's own origin, and `next/font/local` serves files committed to the repository.
  Never a `<link>` or `@import` to a font host: `font-src 'self'` blocks it, and it would send every
  visitor's address to a third party.
- Each font sets `variable` (read by a `--font-*` token in `@theme`) and `display: "swap"`, and
  loads only the weights and styles the page uses; a `next/font/google` font also sets
  `subsets: ["latin"]` (`next/font/local` has no such option). A font used once or below the fold
  sets `preload: false`.

## Accessibility

The bar is WCAG 2.2 AA; the [development checklist](../../rules/development-checklist.md)
(Accessibility) asks the questions. Implementation conventions:

- The page is framed by `<header>`, `<main id="main">`, and `<footer>`. The first focusable element
  is a skip link to `#main`, and `main` takes `tabIndex={-1}` so the link can move focus to it.
- One `h1`; each section has a heading, and headings nest without skipping a level.
- Focus is visible on every interactive element through a `focus-visible:` style. An outline is
  removed only where a replacement indicator shows, or on a programmatic focus target
  (`tabIndex={-1}`) that is not interactive, such as `main` and the sections the header links to.
- Every input has a `<label>`. A control whose visible text does not say what it does gets an
  `aria-label` that starts with that visible text (WCAG 2.5.3).
- Text that changes many times a second — prices, roots, the tape — is `aria-hidden`, beside a
  static description of what it shows. A result the visitor caused, such as a replay verdict or a
  shell response, is announced through an `aria-live="polite"` region that exists before it
  changes.
- Text for screen readers only uses `sr-only`, as the pause control's " animations" does.
- `lang="en"` on `html`.
- `eslint-plugin-jsx-a11y` runs its strict config at error. Lint is not conformance: check a change
  in a browser with the keyboard alone, the accessibility tree (Playwright's `getByRole`, or the
  browser's accessibility panel), 200% zoom, and a 320 px viewport.

## Animation and reduced motion

- Every animated panel uses `src/components/motion.tsx`: `useMotion` is the one pause / play switch
  for every animation, off under `prefers-reduced-motion` until the visitor presses play and off
  during the server render; `useTicker` drives a panel's ticks and stops while the panel is off
  screen or the tab is hidden; `MotionToggle` is the pause control each animated panel shows.
- CSS animations are `--animate-*` tokens with their `@keyframes` in `@theme`. Animate `transform`
  and `opacity`. Never animate layout properties (`width`, `height`, `top`, `left`, `margin`,
  `padding`, `font-size`), which lay the page out again every frame; animate paint-only properties
  (`background-color`, `box-shadow`) only on small elements.
- The `prefers-reduced-motion: reduce` rule in `globals.css` stops every CSS animation and
  transition; never override it.
- No timer or `requestAnimationFrame` loop runs while paused, off screen, or in a hidden tab.
- No animation library without the owner's approval ([Dependencies](#dependencies)).
- Nothing flashes more than three times a second.

## Performance

- Budgets, on a production build: Lighthouse in its mobile configuration scores 95 or more in
  Performance, Accessibility, Best Practices, and SEO, with LCP at most 2.5 s, CLS at most 0.1, and
  Total Blocking Time at most 200 ms. Run Lighthouse from outside the repository at an exact
  version (`npm view lighthouse version`) against a local production build, on the port
  `npm start` reports — never a preview deployment, whose hosting settings are not production's —
  and keep its JSON report in a gitignored run directory under `agents/.processes/dev-runs/`.
- Client components stay small: logic lives in `src/lib`, server components render everything
  static, and a client component holds only what changes.
- Import a package's specific entry point (`@noble/hashes/sha3.js`, not the package root), so the
  bundle carries only what the page uses.
- Measure client JavaScript with `npx next analyze --output`, which writes
  `.next/diagnostics/analyze`: copy that report into a run directory under
  `agents/.processes/dev-runs/` before and after a change that adds a client component or a
  dependency, and compare.
- Reserve the space of everything that renders late; the simulated panels render their first
  frame on the server at their final size.

## Privacy

- No analytics (Vercel Web Analytics and Speed Insights included), cookies, `localStorage`,
  `sessionStorage`, IndexedDB, trackers, fingerprinting, third-party scripts, fonts, images,
  iframes, or embeds without the owner's explicit approval. A visitor's choices, such as the pause
  switch, live in memory and end with the tab.
- Every request the page makes is same-origin, but for the engine node's origin once the owner has
  approved it, and WalletConnect's relay while a user pairs or uses a wallet app over it (approved in
  monkey-trading/console#7): the site serves its own fonts, images, and scripts. Check the production build's
  network panel after any change to what the page loads.
- Links to other sites are plain links; nothing is fetched from them.
- Nothing a visitor types leaves the browser, but for what the app sends to the engine node: the
  mock engine and any local demo run in the browser.

## Public copy

The [development checklist](../../rules/development-checklist.md) (Public copy) holds the copy
rules; these are the conventions that keep copy checkable.

- `src/lib/content.ts` holds the engine's rules and status as the page lists them, so one file is
  checked against the engine's README on `main` in `monkey-trading/engine` and the decision
  issues there. Prose elsewhere that describes the engine is checked the same way.
- A rule the page demonstrates in code (the index median, the state roots) cites the engine source
  it mirrors in a comment.
- Something the engine has not built is marked as in build — `building: true` on a rule,
  `state: "building"` on a status item — and both marks for the same piece change together, only
  when the engine README says it is built.
- When the engine README changes, re-check `content.ts` and the page's prose against it.

## Dependencies

- Reuse before adding: the platform, React, and Next.js before a package.
- Ask before adding a runtime dependency (`dependencies`): it ships to every visitor. A development
  dependency may be added for tooling with a stated reason. Both follow the rules below.
- Exact versions only (`.npmrc` sets `save-exact=true`): no `^`, `~`, tag, git, URL, or `file:`
  specifier.
- Official packages only: verify the exact name, publisher, and repository on the registry
  (`npm view <package> name repository.url maintainers`) against typosquatting.
- `npm audit --audit-level=high` passes with every change, as CI enforces. Adopting
  `eslint-config-next` needs a clean audit with it first; until then `eslint.config.mjs` composes
  `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, and `eslint-plugin-jsx-a11y`
  directly.
- A bump links the release notes and confirms the behavior change is expected. A major bump of
  Next.js, React, Tailwind CSS, TypeScript, ESLint, or vitest is its own PR.
- The lockfile is written only by npm, never by hand, and committed with the `package.json` change
  that caused it.
- Licences: a dependency is under an open-source licence that allows the console's Apache-2.0
  distribution (MIT, ISC, BSD, Apache-2.0 and the like); check it with `npm view <package> license`.
  The one exception, approved by the owner in monkey-trading/console#7 (2026-10-29), is the
  WalletConnect SDK (`@walletconnect/universal-provider`, `sign-client`, `core`, `types` and `utils`)
  under the WalletConnect Community License Agreement. Under it the console uses those packages
  unmodified, since Reown owns any modification; ships the notice "Portions © 2025 Reown, Inc. All
  Rights Reserved" and a copy of the licence (`public/walletconnect/LICENSE.txt`, both on `/notices`);
  shows WalletConnect's logo wherever it offers WalletConnect; and needs a paid licence from Reown
  above 500 monthly active users. A bump of those packages compares their `LICENSE.md` with that copy.
- Hashing comes from `@noble/hashes`; never another hashing package, never home-rolled.
- Tools outside the build — Playwright, Lighthouse — are not dependencies of this repository: run
  them from a scratch directory outside it, at an exact version of the official package.
- In use (non-exhaustive): `next`, `react`, `react-dom`, and `lightweight-charts` (TradingView, Apache-2.0,
  the owner-approved charting library; its `fancy-canvas` dependency is MIT), `viem` (MIT, typed data,
  ABI encoding and signature recovery for the wallet), `@walletconnect/universal-provider` (the
  licence exception above, loaded only when the user picks WalletConnect) and `uqr` (MIT, the pairing
  QR code) at runtime;
  `typescript`, `@types/*`, `eslint`, `@eslint/js`, `typescript-eslint`,
  `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, `tailwindcss`, `@tailwindcss/postcss`,
  `vitest`, and `vite` in development.

## Project layout

- One package at the repository root. `@/*` maps to `src/*`: import across directories with `@/`
  (`@/lib/site`), and within a directory with `./` (`./motion`).
- `src/app/` holds routes and their metadata only; `src/components/` holds React components;
  `src/lib/` holds pure TypeScript with no React, DOM, or browser API.
- Logic a component needs lives in `src/lib` as a pure function with tests, and the component
  calls it.

## Testing

- Vitest runs every `src/**/*.test.ts` in the Node environment (`vitest.config.ts`). Each `src/lib`
  module with logic has its tests beside it as `<module>.test.ts`; a module that only holds data,
  such as `content.ts`, needs none.
- Test the logic, not the framework: components stay thin, so their logic sits in `src/lib` and is
  tested there. There are no DOM or component tests; adding them is a dependency decision.
  Behavior only a browser shows is checked on a production build through the dev scenario
  ([agent-build-feature](../agent-build-feature/SKILL.md)).
- One `describe` per function or behavior area; each `it` names the behavior it pins ("counts a
  quote exactly max-age old as fresh, and one a millisecond older as stale").
- Assert whole values (`toEqual` on the full result) over fragments, and exact numbers over ranges.
- Time and randomness come in as arguments or a seed; no fake or real timers where a tick count
  will do.
- Run one file with `npm test -- src/lib/<module>.test.ts`.

## File structure and layout

Each source file is laid out in this order:

1. The `"use client"` directive, when the file needs it
2. External imports (`node:` built-ins, `react`, `next`, packages)
3. `@/` imports
4. Relative imports, then stylesheets
5. Types and interfaces
6. Constants and module-level values
7. Components and functions

Import groups appear in this order, separated by a blank line.

- Import only what you use, by name.
- `src/components/` holds one exported component per file, named like the file in PascalCase
  (`IndexPanel.tsx` exports `IndexPanel`). A small component used only by that file may sit below
  its export, such as a `Section` helper in `page.tsx`. Hooks shared across components live in a
  lowercase module, which may also export the control those hooks drive, as `motion.tsx` does with
  `MotionToggle`.
- `src/lib` modules are kebab-case (`price-index.ts`, `replay-log.ts`), with tests beside them as
  `<module>.test.ts`.
- `.tsx` only for files that hold JSX.

## File line cap and module splits

Source files (`.ts`, `.tsx`, `.mjs`), tests included, are capped at 300 lines, enforced by ESLint's
core `max-lines` rule (`"max-lines": ["error", 300]`, which counts blank lines and comments) in
`eslint.config.mjs`, which `npm run lint` and CI run. Prefer splitting over exempting: an
`eslint-disable` for `max-lines` needs the owner's approval.

### How to split

Extract cohesive units — never arbitrary halves:

- A page section becomes its own component in `src/components/`; `page.tsx` keeps the
  composition.
- A component's logic becomes a pure function in `src/lib`, with its own tests.
- A large `src/lib` module splits by area into sibling modules, as `replay.ts` (the state machine)
  and `replay-log.ts` (the published log and its tampers) do.
- A test file splits by behavior area into `<module>.<area>.test.ts`; fixtures they share go in a
  sibling module the tests import.

Moves are verbatim: no logic, comment, or naming edits ride along — only imports and exports
change. Keep each new file's import grouping.

### Exports after a split

- Export only what another file uses; a helper only the moved code uses stays unexported in its
  new file.
- The original module may re-export what moved (`export { tamperLog } from "./replay-log"`) so its
  callers keep their imports. Re-exports are avoided everywhere else, with no barrel `index.ts`.
- Remove the imports the original no longer uses (`npm run lint` fails on leftovers).

### Docs and verification

- Sync the [agents/AGENTS.md](../../AGENTS.md) Structure bullets to the new paths; describe each
  file exactly once.
- Before pushing: `npm run lint` passes, so every file is under the cap, and the split was pure
  motion — diff the removed against the re-added lines; residuals are only imports, exports, and
  rewrapping.

## README

The root `README.md` is the public introduction, in prose: what the site is and shows, how to run
it locally (Node.js from `.nvmrc`, `npm ci`, `npm run dev`, and the checks CI runs), how it deploys
and which environment variables it reads, and a `## License` section with the single line:
Licensed under the Apache License, Version 2.0; see `LICENSE`. It follows the public-copy rules,
so it says nothing about internal build management. Keep its commands in step with `package.json`
and its deployment notes with `siteUrl()`.

## Build configuration

- `next.config.ts` keeps `reactStrictMode: true`, so development runs every effect twice and
  surfaces a missing cleanup; `poweredByHeader: false`; `agentRules: false`
  ([Framework reference](#framework-reference)); and the security headers
  ([Security headers and CSP](#security-headers-and-csp)).
- The build uses Turbopack, the default bundler; no `webpack` customization.
- `tsconfig.json` keeps `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `noEmit`, the
  `@/*` path, and the `next` plugin.

## Comments and TSDoc

- Use TSDoc (`/** … */`) on every top-level function, component, and hook, exported or not, and a
  file comment at the top of every module saying what it holds; closures inside them need none.
  Tests need less function-level doc but more line-by-line commentary.
- For a function that throws, describe the error cases in this exact form:

  ```text
  /**
   * {brief description of function}
   * Error cases:
   * - foo
   * - bar
   */
  ```

- Document a component's props on its props type, one line per prop whose name does not say
  everything.

General comment terseness applies too — see [../../rules/code-comments.md](../../rules/code-comments.md).

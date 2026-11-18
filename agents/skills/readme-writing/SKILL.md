---
name: readme-writing
description: >
  Use before writing, rewriting, or editing any README.md: the repository's root README or a
  directory's. Covers who a README is for, the order of its sections, what belongs in one and what
  never does (version history, file inventories, issue numbers, agent workflow), the root and
  directory templates, how to state status and warnings, the prose and command rules, and the check
  before a README lands. Modelled on go-ethereum's README. Overrides any older README template in
  another skill.
---

# Writing a README

A README is the front door. It answers, in order, the questions of a stranger who has just
landed on the repository: what is this, how do I get it, what do I get, how do I run it for my
case, how do I talk to it, how do I help, and under what licence. It answers them for the code as
it is today, in as few words as answer them, and links out for everything else.

The model is [go-ethereum's README](https://github.com/ethereum/go-ethereum#readme). Read it before
writing one. Note what it does:

- **One line of identity** under the title: "Golang execution layer implementation of the Ethereum
  protocol." No adjectives, no pitch.
- **Building** names the prerequisites with versions (Go 1.25 or later, a C compiler) and gives
  the one command, then the second one.
- **Executables** is one table: each binary and what it is for, with an example invocation.
- **Running** opens with concrete hardware requirements, then walks the common cases in order of
  how many people have them: a full node on mainnet, then on a test network, then configuration,
  Docker, the RPC interfaces, and a private network. Each case states the reader's goal, gives the
  exact command, then says what the command does and which defaults it sets.
- **Warnings** appear once, in bold, at the point where the reader could hurt themselves (exposing
  RPC to the internet), and say what the danger is.
- **Depth is linked, not copied:** the full flag list, the developer guide and the network setup
  each live on their own page.
- **Contribution** is short: fork, fix, open a PR against the main branch, talk to the maintainers
  first for large changes, follow the formatting and doc conventions, prefix commits with the
  packages they touch, with an example.
- **License** says exactly which code is under which licence and which file holds it.

## Who reads it

Write for two readers, in this order:

1. **Someone deciding whether this is for them.** They read the title line and the first
   paragraph, and maybe the status. Everything they need to decide is there.
2. **Someone trying to use it.** They skim headings to find their case, copy a command, and run
   it. Everything they need for their case is under one heading, in the order they will do it.

A maintainer who already knows the code is not the audience. Their reference is the code, its TSDoc
comments, and `agents/AGENTS.md`.

## What goes in a root README

In this order, leaving out a section that has nothing true to say:

1. **Title and one line.** The project's name and one sentence saying what it is, in the reader's
   terms. Then, at most, a short paragraph on what makes it different, stated as facts the code
   makes true.
2. **Status.** One short paragraph or a small table: what runs for real, what runs against local
   stand-ins, what is not built yet, and whether it holds real funds. Present tense, no dates of
   past work, no list of everything that ever landed.
3. **How it works.** The model a user needs to predict the console's behaviour, in plain words:
   what it shows, what it verifies before it shows it, what it signs and with which key, what
   leaves the browser, and what is simulated. Use a table where the reader compares values (pages,
   build variables). Describe the console as it is today. Link the engine's documentation or the
   code for the detail.
4. **Getting it.** Prerequisites with exact versions, then the install command.
5. **What you get.** A table of the `npm` scripts and the scripts in `scripts/` that a reader runs,
   one line each, like go-ethereum's Executables table.
6. **Running it.** The common cases, most common first, each under its own heading:
   - the reader's goal, in a sentence;
   - the exact command, in a fenced `shell` block that copies and runs from a fresh checkout;
   - what the command does and the defaults it sets, in a few bullets (ports, data directory,
     which parts are mocked);
   - how to tell it worked.
7. **Talking to it.** The interfaces a program uses (API, stream, CLI), with the options that turn
   them on and their defaults, and a link to the full reference.
8. **Verifying it**, where the project makes trust claims: the exact commands a reader runs to check
   them, and what each check proves.
9. **Contributing.** How to send a change, the coding conventions in a few bullets, the commit and
   PR title format with an example, what CI checks, that a maintainer approves each PR before it
   merges, and where to ask first for a large change.
10. **Security.** One line pointing at `SECURITY.md` and how to report privately, once the
    repository has one.
11. **License.** Which code is under which licence, and the file that holds it.

Target length for a root README: what the sections above need, usually 150 to 300 lines. A README
that passes 400 lines is carrying something that belongs in a linked document.

When a topic needs more than about 100 lines (the local stack's walkthroughs, say), the README keeps
the model in a few paragraphs with the one or two tables a newcomer needs, and the rest goes in a
linked page under `docs/`, written to this skill's standard. The README stays the front door.
Formal sentences run longer than compressed ones; a README a little over 300 lines in that register
is better than a shorter one in shorthand.

## What goes in a directory README

A README in a subdirectory tells someone opening that directory what it holds and how to use and
test it. In this order:

1. **Title and one line:** the directory's name and what it holds.
2. **What it is for:** a short paragraph: its job, what depends on it, and the one or two
   properties it guarantees (for example, pure TypeScript with no React or DOM).
3. **Using it:** the entry points a caller uses (modules, functions, components), with a short
   example.
4. **Layout:** at most a table of its subdirectories or modules, one line each, saying what each
   one is responsible for. Never one row per file.
5. **Configuration:** environment variables it reads, with defaults. Leave the section out if there
   are none.
6. **Testing:** the commands that test it.
7. **License:** one line.

Target length: 40 to 150 lines. A directory whose README needs more is documenting its internals,
which belong in TSDoc comments next to the code they describe.

## What never goes in a README

- **History.** No "now", "no longer", "previously", "was changed to", "since #123". A README
  states the console as it is. History lives in git.
- **Accretion.** A change never appends a sentence describing itself. It rewrites the passage it
  affects so the passage reads as if written today, from scratch, and deletes what is no longer
  true.
- **Inventories.** No list of every file, every test, every script, every alert or every config
  key. Name the few the reader needs and link the directory or the reference that has the rest.
- **Internal references.** No issue numbers, decision ids (D5, #12), PR numbers, branch names,
  review rounds, finding ids or audit labels. If a fact matters, state the fact.
- **How the project is run.** No waves, milestones, agent workflow, review loops or session notes.
  The few rules a contributor meets (CI must pass, a maintainer approves the merge) go in the
  contribution section in one sentence each; everything else stays in `agents/`.
- **Unbacked claims.** No "fast", "secure", "robust", "seamless", "battle-tested",
  "production-grade", "comprehensive", "powerful" or "simply". State the number or the mechanism,
  or leave it out.
- **Other organisations' names**, competitors, and reference products. Vendors the code actually
  uses are named where the reader needs them.
- **Legal analysis**, of any kind.
- **Decoration.** No emoji, no badge that is not true and useful (CI status, docs and chat are
  fine), no table of contents for a short README, no heading over a single sentence.

## Prose

Follow [writing-style](../../rules/writing-style.md), plus:

- **Second person and present tense:** "You can run a node against a local chain", "The engine
  refuses an order when…".
- **Short paragraphs,** three to five lines. A paragraph that lists more than three things is a
  list.
- **Lists** for flags, options, steps and requirements. **Tables** for anything the reader compares
  across rows. **Prose** for how things work and why.
- **Define a term once,** the first time it appears, in words a trader or developer outside the
  project knows. Prefer the industry's term to the code's when they differ, and give the code's
  name once in backticks if the reader will meet it in output. A README read by traders and
  developers defines each side's terms for the other: basis point, mark, notional and margin for
  developers; enclave, attestation and replay for traders. A term the reader will meet in commands
  or their output (enclave, attestation, checkpoint, node) is defined once and then used, not
  replaced with a friendlier word.
- **Values not yet confirmed** are stated with "proposed" inline, next to the value, never left
  out and never stated as settled.
- **Concrete over general:** versions, sizes, ports, defaults, times, limits, with units.
- **One warning per hazard,** in bold, where the reader would act on it, saying what goes wrong.
  Not a stack of notes at the top.
- **Wrap prose at 100 columns,** one space after a full stop, British or American spelling as the
  repository already uses. Tables, URLs, code spans and link text are never broken across lines;
  let those lines run long. Break a long command with `\` at an argument boundary.

## Sentences

A README is technical documentation for people, read top to bottom by someone who wants to
understand. It is not a dense summary for a machine to parse. Write it the way an experienced
engineer or a broker's documentation team writes: complete, formal sentences that flow, one idea
each, in the standard terms of the field. [interface-copy](../../rules/interface-copy.md) sets the
same standard for the console's own text, and the owner's examples there apply here.

- **Context first, then what happens, then its consequence for the reader.** Each in its own
  clause, usually its own sentence.
- **One condition per clause.** Never stack "while … while … or while …", or "once … then … unless
  …", in one sentence. Two conditions take two sentences, or a short list.
- **No compressed asides.** Write ", spread included,", ", gap included," and "(bps, hundredths of
  a percent)" out as clauses or as their own sentence: "including the spread", "even if the price
  gaps".
- **No colon chains.** A colon introduces a list or a table, not the second half of a compressed
  sentence.
- **No engine shorthand as nouns.** Not "a close", "an add", "a fill opens", "a reversal pays".
  Write "closing a position", "adding to a position", "the part of the trade that opens a
  position", and use the standard term (execution price, realised profit, working orders, margin,
  exposure, close-out level).
- **No comma-chained facts joined by "and … so …".** Three facts are three sentences.
- **Name every subject.** No "this", "it" or "that" for something the sentence has not named.
- **Formal register.** "Does not", "cannot", "you would", never "won't", "can't" or "you'd". Never
  "we" or "I".
- **Read it aloud.** A sentence you would not say to a colleague, or would have to say twice, is
  rewritten.

Before and after, from the first rewrite of this repository's README to this skill:

| Before | After |
|---|---|
| A build can instead talk to a real engine node: it checks the node's attestation, shows only answers the attested enclave signed for the request, and follows the node's signed stream, which starts at the live end of the log and reconnects there, marking the feed stale (and disabling order entry) when it stops. | A build configured for a live trading server talks to that server instead. The console reads the server's REST API, and follows its WebSocket stream from the live end of the log. When the stream stops, the console marks the prices as stale and disables order entry until the stream resumes. |
| Orders, cancels and the two batches sign with an in-browser session key the wallet authorizes with one signature, straight after a connect for a wallet that has declared and in the setup popup for one that has not, kept in the browser's storage until it expires; deposits, withdrawals and claims always use the wallet. | Deposits, withdrawals and MONKEY claims are always signed by the wallet. Orders, cancellations, Cancel all and Close all are signed by a session key: a key held in this browser that places orders without a wallet prompt. The wallet authorises the session key with one signature. |
| The block follows the visitor's IP address, so a VPN or proxy evades it, and it is not a compliance control on its own: enforcement belongs to the engine node, not to this block. | Because the block follows the IP address, a VPN or proxy bypasses it. The engine requires each account to sign an eligibility declaration before it credits a deposit or accepts an order. |
| A promotion needs those 200 seconds and two heartbeat slots more (the schedule's heartbeat interval, tolerance and misses set both), so when less than that is left of the turn and another member holds the next one, the command says so and waits for the next turn to begin, at most five minutes, then stops that turn's operator once its engine serves, so a stop never lands on an engine that has yet to take the keys. | A promotion needs those 200 seconds and two more heartbeat slots. When less time than that remains in the turn, and another member holds the next turn, the command says so and waits for the next turn to begin, which takes at most five minutes. It then stops that turn's operator once its engine is serving, so that a stop never lands on an engine that has not yet taken the keys. |

## Commands

- Every command block is copy-pasteable: no prompts, no placeholders the reader cannot fill, no
  elided output. Use `<angle-brackets>` only for values the reader must supply, and say what they
  are right under the block.
- Every command in a README has been run from a fresh clone at the commit that adds it, and its
  stated result observed. A fresh worktree at that commit counts as a fresh clone. If it needs a
  tool, the prerequisites list it with a version.
- Show a command with its real defaults (ports, paths) and name the setting or variable that
  overrides each. Verify it with overrides where a default is in use on your machine; never stop
  or disturb whatever holds the default.
- A README PR's body ends with one line per command it ran and the result, and names any command
  it could not run and why. That list is the evidence this skill's check asks for, and it is the
  one exception to `agent-create-pr`'s rule against a test plan in the body.
- Put the expected result after the command: what prints, which port listens, which file appears.
- Prefer the repository's `npm` scripts and the scripts in `scripts/` to long hand-written
  pipelines.

## Status and limits

State status as a short present-tense table or paragraph:

| Part | State |
|---|---|
| Simulated trading server | The default build, in the browser |
| Live trading server | Runs against a local development server and a local chain |
| Hardware attestation | No engine release pinned yet |

Say plainly what holds no real funds, what is simulated, and what is not built. Keep the limits a
user must know (order entry stops while prices are stale, a session key cannot move funds) in "How
it works", not in a disclaimer.

## When to update a README

- A change that alters a command, script, default, port, path, prerequisite, build variable or
  user-visible behaviour updates the README passage that states it, or the `docs/` page that does,
  in the same PR.
- A change that adds a feature updates "How it works" only if a user's prediction of the console's
  behaviour changes, and then rewrites that passage rather than adding a paragraph.
- A change to internals updates TSDoc comments, not the README.

## Check before it lands

- [ ] The first line says what this is, in words a stranger understands.
- [ ] A reader can find their case from the headings alone.
- [ ] Every command was run from a fresh clone, and its result is stated.
- [ ] No sentence narrates history, a version transition, or how the project is run.
- [ ] No issue, PR, decision or finding number appears.
- [ ] No list of every file, alert, key or test.
- [ ] Every number has a unit, and every claim is a mechanism or a measurement.
- [ ] Each warning is stated once, where it applies.
- [ ] Length is within the target, or the excess has moved to a linked document.
- [ ] No sentence stacks conditions, chains facts with "and … so …", or compresses a condition into
      an aside; no engine shorthand used as a noun; no contractions.
- [ ] Read it top to bottom as a stranger. Cut every sentence that reader would skip.

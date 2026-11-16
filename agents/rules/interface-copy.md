# Interface copy

Load before writing or reviewing any text a trader reads in the app: labels, tooltips, notices,
errors, empty states, buttons, page and section intros, and `aria-label`s. This covers text built in
code too, such as a message assembled from figures in `src/lib/`.

**Rule**: write the way a good broker's support desk talks to a customer: plainly, briefly, and
only about what matters to the trader.

The owner's standard:

> Before: "The profit fee rate a close of this position pays on a gain now. A realised gain pays
> 100.00% on a close within 10 s of the position's open, falling with the hold to 10.00% from
> 15 min on."
>
> After: "This is the fee rate paid on a winning trade. The fee decays over time, starting at 100% on
> a newly opened position and falling to 10% for positions held for 15 minutes or more."

## How to write it

- **Say what it is or what happened, then what to do.** Open a tooltip with what the thing is
  ("This is…"). Open an error with what went wrong, then the next step, if there is one.
- **Use everyday words, short sentences, and verbs.** Write "closing this position", not "a close of
  this position". Write "a winning trade", not "a realised gain". Keep to one idea per sentence and
  at most three sentences per tooltip.
- **Use trading words a retail trader already knows:** position, order, price, profit, loss, fee,
  margin, leverage, deposit, withdraw, balance.
- **Keep what changes a trader's decision, and drop the rest.** The owner's version keeps 100%, 10%
  and 15 minutes. It drops the 10-second detail, because no trader acts on it.
- **Write numbers in sentences as a person says them:** 100%, 10%, 15 minutes, 2 hours. Table
  cells and figures keep their own precision and formats.
- **Address the trader as "you".** Never speak as "we" or "I". The system has no single company
  voice, because its operators rotate.
- **Stay accurate.** Plain doesn't mean vague. Every figure and condition you keep must still come
  from the same source in code, and must still be true.

## Never show

- **Engine internals:** protocol versions (`V55`), seqs, stamps, stream frames, "reads", bounds,
  parameters, NAV formulas, "the node serves…", "in force", or a field name.
- **Chains of internal reasons.** Say "Prices are delayed, so trading is paused" rather than which
  check failed on which answer.
- **Legalistic or hedged phrasing:** "save that", "unless and until", "for the avoidance of doubt",
  or stacked conditions. Keep any required risk or status notice: shorten its wording, keep its
  meaning, and add no new legal text.

## Words to use

| Instead of | Write |
|---|---|
| the node, the node's | the server, or rephrase without it |
| enclave, attestation, attested | verified, verification ("the server's verification") |
| a close; realised gain or loss | closing a position; profit or loss, a winning or losing trade |
| the house cannot take more | this market is at its limit |
| epoch | staking period |
| period (MONKEY emissions) | reward period |
| signer, signer key | signing key |
| the vault | the vault (on first mention in a view: "the on-chain vault that holds deposits") |
| session key | session key (on first mention in a view: "a key in this browser that places orders without a wallet prompt") |

Product names stay as they are: MONKEY, USDC, Monkey Trading.

## Before and after, from this console

| Before | After |
|---|---|
| The enclave changed or an answer failed its check. Reads wait and signing is paused until it passes; the stream keeps showing the frames it has already verified. | The server couldn't be verified, so trading is paused until it is. Prices shown are the last verified ones. |
| This period allocated nothing to the account. A period allocates nothing when the loss was written off, when debt from an earlier write-off is being paid down first, or when the account's cash was negative at the period's close. | You earned no MONKEY this period. This happens when a loss was written off, when an earlier write-off is still being repaid, or when your balance was negative at the end of the period. |
| Withdrawals the vault could not pay at once wait here and are paid in the order they were asked, each up to the collateral the vault holds. | Withdrawals that can't be paid straight away wait here. They're paid in the order they were requested, as funds become available. |
| The node is still loading its record of your payouts after a restart. | Your payout history is still loading. |
| The house cannot take more in this market. Try a smaller size. | This market is at its limit. Try a smaller size. |

## Tests and issues

- A test that asserts copy asserts the new wording. Never keep old wording to keep a test passing.
- Wording quoted in an issue or acceptance criterion describes what the text must say. It is not
  the wording to ship. Write it to this rule.

Why: the console is the product's public face. Text written the way the engine's code reads makes
traders decode it, and makes the product look machine-written.

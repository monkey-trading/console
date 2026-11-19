# Interface copy

Load before writing or reviewing any text a trader reads in the app: labels, tooltips, notices,
errors, empty states, buttons, page and section intros, and `aria-label`s. This covers text built in
code too, such as a message assembled from figures in `src/lib/`.

**Rule**: write as an experienced broker writes help text for its clients. Explain in complete,
professional sentences, using the standard terms of trading.

## The owner's standard

> Before: "A market order won't fill if the price is worse than the one you saw by more than this.
> If a market's own limit is lower, that limit applies."
>
> After: "In a fast-moving market, the execution price of a market order may be worse than the price
> quoted on screen. Restricting the maximum slippage means orders that would fill at an adverse
> price are rejected."

> Before: "The profit fee rate a close of this position pays on a gain now. A realised gain pays
> 100.00% on a close within 10 s of the position's open, falling with the hold to 10.00% from
> 15 min on."
>
> After: "This is the fee rate paid on a winning trade. The fee decays over time, starting at 100%
> on a newly opened position and falling to 10% for positions held for 15 minutes or more."

## How to write it

- **Explanatory text** (tooltips, notices, errors, empty states, and the descriptive text under a
  setting or section) is written in full sentences that flow:
  - Give the context first, then what the setting, figure or event means, then its consequence for
    the trader.
  - Use the standard terms a trader expects: execution price, slippage, adverse price, spread,
    margin, equity, exposure, close-out level, working orders, realised and unrealised profit or
    loss.
  - Write formally: "does not", "cannot", "you would", never "won't", "can't" or "you'd".
  - Name things. Never write "this" for something the sentence has not named, and never write "the
    one you saw" or "by more than this".
  - Stay brief, within the limits under [Length](#length). Write what the reader needs, not padding.
- **Labels, titles, column headers, buttons and tight spaces** stay concise, as noun phrases or
  short imperatives ("Max slippage", "Close all", "Time held"). Use the same proper terms, never
  clipped engine shorthand.
- **Errors and refusals** say what happened, then why, then what to do, in that order, for example
  "Insufficient margin. This order requires {required} of margin, and your equity is {equity}."
- **Numbers in sentences** read as a person says them: 100%, 10%, 15 minutes, ten minutes. Table
  cells and figures keep their own precision and formats.
- **Address the trader as "you".** Never speak as "we" or "I".
- **Stay accurate.** Every figure and condition must still come from the same source in code and be
  true. Keep what changes a trader's decision, and drop internal detail that does not.

## Length

- **A tooltip** says one thing in at most two sentences and about 40 words.
- **A note under a control** is at most two sentences.
- **An error** says what happened, then why, then what to do, in at most three short sentences.
- **Where caveats go:** a caveat goes where it matters, in the refusal or notice at that moment, or in
  the trading rules. Never stack caveats in a tooltip.
- **The guard:** `src/help-text.test.ts` fails when a tooltip exceeds two sentences or 40 words, or a
  note exceeds two sentences. It reads every `tip` and `note`, as a JSX attribute or an object's
  property, and every constant named `…TIP`, `…TIPS`, `…HELP`, `…NOTE` or `…NOTES`, so name help text
  that way. Text built at run time is listed there with what it can say. Its list of help text
  already over the limits only shrinks: cut a listed string to the limits and take it off the list.

### Example: the take-profit and stop-loss tooltip

Before, eight sentences and 137 words:

> A take profit or stop loss closes your entire position when the price at which it would close
> reaches the level you set. That closing price is the bid for a long position and the offer for a
> short position, so a wider spread can trigger a level even when the market price has not moved. A
> stop loss is then executed at the next available closing price, which may be worse than your level
> if the market gaps or reopens after a closure. A take profit is executed at your level or at a
> better price. Both differ from a stop order, which opens or adds to a position when the market's
> reference price reaches its trigger price. The take profit and stop loss on a position together
> count as one working order towards your limit.

After, two sentences and 36 words:

> A take profit or stop loss closes your entire position when its closing price reaches the level you
> set. A stop loss may be executed at a worse price than your level if the market gaps.

The bid, offer and spread detail stays in the trading rules. The count towards the working order
limit stays in the refusal a trader sees when the limit is reached. The comparison with a stop order
is dropped.

## Never show

- **Engine internals:** protocol versions (`V55`), seqs, stamps, stream frames, "reads", bounds,
  parameters, NAV formulas, "the node serves…", "in force", or a field name.
- **Chains of internal reasons.** Say "Live prices are not currently updating, so trading has been
  suspended", not which check failed on which answer.
- **Clipped, telegraphic phrasing:** sentence fragments in explanatory text, stacked conditionals,
  or wording compressed to save words at the cost of reading well.
- **Legalistic phrasing.** Keep any required risk or status notice's meaning, and add no new legal
  text.

## Words to use

| Instead of | Write |
|---|---|
| the node, the node's | the server, the trading server |
| enclave, attestation, attested | verified, verification |
| a close; realised gain or loss | closing a position; realised profit or loss, a winning or losing trade |
| the house cannot take more | the house has reached its exposure limit in this market |
| resting orders | working orders |
| slippage bound | maximum slippage |
| epoch | staking period |
| period (MONKEY emissions) | reward period |
| signer, signer key | signing key |
| checkpoint | snapshot |
| session key | session key (on first mention in a view: "a key held in this browser that places orders without a wallet prompt") |

Product names stay as they are: MONKEY, USDC, Monkey Trading.

## Before and after, from this console

These rows show the voice. Where an After exceeds the limits under [Length](#length), the limits
apply.

| Before | After |
|---|---|
| The size the ticket starts with. Your last size is remembered for each market, and raised to the market's minimum if that has gone up. | The order size the deal ticket opens with. The ticket remembers the last size you traded in each market, and raises it to the market's minimum order size if that minimum has since increased. |
| When on, you press the button again within 3 seconds to confirm. When off, one press sends it. | When enabled, Cancel all and Close all must be pressed a second time within 3 seconds before the instruction is sent. When disabled, a single press sends it immediately. |
| Shows your entry price and open orders on the chart. The close-out price always shows. | Displays your entry price and the levels of your working orders on the chart. The close-out level is always displayed. |
| Saved in this browser only. They set how the deal ticket starts. Anything you've already chosen or typed on the ticket stays as it is. | These preferences are stored in this browser only and set the defaults of the deal ticket. Changing them does not alter an order you are already preparing. |
| This is your profit or loss if you close the whole position now, before the profit fee. It uses the price you'd close at (the bid for a long, the offer for a short), so the spread is already included. | The profit or loss you would realise by closing the entire position now, before the profit fee. It is calculated at the price at which the position would close (the bid for a long position, the offer for a short), so the spread is already taken into account. |
| This is how long you've held the position, which sets its profit fee. Adding to the position shortens this time, weighted by the size you add. | The length of time the position has been open, which determines its profit fee rate. Adding to a position reduces its holding time in proportion to the size added. Reducing a position leaves it unchanged. |
| This is the price at which your account would be closed out, with your other positions at their current prices. Margin is shared, and your largest losing position is closed first… | The price at which your account would be closed out, assuming your other positions remain at their current prices. Because margin is shared across your account, your largest losing position is closed first, and that may not be this one. |
| Not enough margin: your equity is {equity} and you need {required}. | Insufficient margin. This order requires {required} of margin, and your equity is {equity}. |
| This market is at its limit. Try a smaller size. | The house has reached its exposure limit in this market. Please try a smaller order size. |
| Prices aren't updating, so trading is paused. It resumes once the connection to the server recovers. | Live prices are not currently updating, so trading has been suspended. Trading will resume automatically once the price feed recovers. |
| You haven't earned any MONKEY yet. Every 10 minutes, a set amount of MONKEY is shared between the traders who made a loss, in proportion to their losses. | You have not yet earned any MONKEY. Every ten minutes, a fixed amount of MONKEY is distributed among the traders who realised a loss in that period, in proportion to the size of their losses. |

## Tests and issues

- A test that asserts copy asserts the new wording. Never keep old wording to keep a test passing.
- Wording quoted in an issue or acceptance criterion describes what the text must say. It is not
  the wording to ship. Write it to this rule.

Why: the console is the product's public face, read by traders who expect the clarity and register
of an established broker. Text written in the engine's vocabulary, or compressed into fragments,
reads as machine-written.

/** Tests for how a trial of the next server ends: not serving yet, a clock it disagrees with, and an unsigned answer a refusal wraps. */

import { describe, expect, it } from "vitest";

import { EngineError, type EngineClient } from "./client";
import { SignerFloorWatch } from "./operator-follow-floor";
import { TrialClient } from "./operator-follow-kit";
import { runTrial } from "./operator-follow-trial";
import { notReady, RefusedAnswer, UnsignedAnswer } from "./trust-errors";

const trial = (client: TrialClient) => runTrial(client as unknown as EngineClient, null, new SignerFloorWatch(() => null), () => undefined); // the trial uses only what TrialClient has

describe("runTrial", () => {
  it("holds a next server whose signed time the device clock disagrees with as a clock failure, not a refusal to retry", async () => {
    const client = new TrialClient();
    client.verdict = { kind: "clock", skewMs: 60_000 };
    await expect(trial(client)).resolves.toEqual({ kind: "held", stage: "clock", reason: null });
  });

  it("calls a node not serving yet only that, an unsigned answer included, even when a refusal carries what it said last", async () => {
    const client = new TrialClient();
    client.signedRead = async () => { throw new RefusedAnswer("not signed", {} as never, { cause: new UnsignedAnswer("The server's response (HTTP 503) was not signed.") }); }; // the route's shape plays no part here
    await expect(trial(client)).resolves.toMatchObject({ kind: "failed", notReady: true });
    expect(notReady(new RefusedAnswer("refused", {} as never))).toBe(false); // a refusal of its own is no transient
    expect(notReady(new EngineError(503, "busy"))).toBe(true);
  });
});

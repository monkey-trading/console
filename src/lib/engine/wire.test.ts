/** Tests that pin the console to the wire formats engine-wire ships in its known-answer vectors. */

import { describe, expect, it } from "vitest";

import { isChallenge, newChallenge, parseFrameMessage, parseSignedFrame, CHALLENGE_HEADER, SEQ_HEADER, SIGNATURE_HEADER, TIME_HEADER } from "./wire";
import { VECTORS, vectorConnection, vectorResponse } from "./test-vectors";

describe("the header and challenge formats", () => {
  it("names the four headers the node sets and exposes", () => {
    expect([CHALLENGE_HEADER, SIGNATURE_HEADER, TIME_HEADER, SEQ_HEADER]).toEqual(["X-Engine-Challenge", "X-Engine-Signature", "X-Engine-Time", "X-Engine-Seq"]);
  });

  it("makes a challenge of 64 lowercase hex characters from 32 random bytes, as every vector's challenge is", () => {
    const challenge = newChallenge((bytes) => bytes.fill(0xab));
    expect(challenge).toBe("ab".repeat(32));
    expect(isChallenge(challenge)).toBe(true);
    for (const v of VECTORS.responses) expect(isChallenge(v.challenge)).toBe(true);
    expect(isChallenge("AB".repeat(32))).toBe(false);
    expect(isChallenge("ab".repeat(31))).toBe(false);
  });

  it("asks the browser for different challenges each time", () => {
    expect(newChallenge()).not.toBe(newChallenge());
  });

  it("matches the vectors' response shape: a 65-byte 0x signature and decimal time and head seq", () => {
    const markets = vectorResponse("markets");
    expect(markets.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(Number.isSafeInteger(markets.time_ms) && Number.isSafeInteger(markets.head_seq)).toBe(true);
  });
});

describe("the stream envelope", () => {
  const frames = vectorConnection("three frames").frames;

  it("reads every frame the vectors ship", () => {
    for (const connection of VECTORS.connections) {
      for (const frame of connection.frames) expect(parseSignedFrame(JSON.stringify(frame))).toEqual(frame);
    }
  });

  it("reads a heartbeat and a command from a frame's message, whose head and offset are strings", () => {
    expect(parseFrameMessage(frames[0]?.msg ?? "")).toEqual({ type: "heartbeat", head: "1204:0" });
    expect(parseFrameMessage(frames[1]?.msg ?? "")).toMatchObject({ type: "command", offset: "1205:0", seq: 1205, cmd: { type: "tick" } });
    expect(parseFrameMessage('{"type":"heartbeat","head":null}')).toEqual({ type: "heartbeat", head: null });
  });

  it("refuses anything that is not a signed envelope or a known message", () => {
    expect(parseSignedFrame("not json")).toBeNull();
    expect(parseSignedFrame("[]")).toBeNull();
    expect(parseSignedFrame(JSON.stringify({ ...frames[0], v: 2 }))).toBeNull();
    expect(parseSignedFrame(JSON.stringify({ ...frames[0], n: 1.5 }))).toBeNull();
    expect(parseSignedFrame(JSON.stringify({ ...frames[0], msg: { type: "heartbeat" } }))).toBeNull();
    expect(parseSignedFrame(JSON.stringify({ n: 0, time: 1, msg: "{}", sig: "0x" }))).toBeNull();
    expect(parseFrameMessage("nope")).toBeNull();
    expect(parseFrameMessage('{"type":"other"}')).toBeNull();
    expect(parseFrameMessage('{"type":"heartbeat","head":5}')).toBeNull();
  });
});

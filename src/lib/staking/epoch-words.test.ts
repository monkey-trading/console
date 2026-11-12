/** Tests for what the closed-epochs card says about the node's record and about a failed read. */

import { describe, expect, it } from "vitest";

import { formatStamp } from "../time";
import { close } from "./epoch-reads-kit";
import { coverText, problemText, unavailableText } from "./epoch-words";

describe("coverText", () => {
  const whole = { begins_ms: 0, from_genesis: true, truncated: false, retained_from_epoch: null };

  it("says nothing when the node holds every epoch", () => {
    expect(coverText(whole)).toBeNull();
  });

  it("names the oldest epoch held once the record dropped older ones, ahead of where it begins", () => {
    expect(coverText({ ...whole, from_genesis: false, begins_ms: 5_000, truncated: true, retained_from_epoch: 40 })).toBe("The node keeps the newest epochs only, from epoch 40 on.");
  });

  it("names when a record that starts after genesis begins", () => {
    expect(coverText({ ...whole, from_genesis: false, begins_ms: 1_793_000_000_000 })).toBe(`The node's record of closes begins at ${formatStamp(1_793_000_000_000)} UTC; earlier epochs are not listed.`);
    expect(coverText({ ...whole, from_genesis: false, begins_ms: null })).toBeNull();
  });
});

describe("problemText", () => {
  it("says nothing until the list is shown, whose own line says why", () => {
    expect(problemText({ status: "failed", error: "The node did not answer.", moreError: null })).toBe("");
  });

  it("says a failed check for new closes ahead of a failed Load more, without doubling the full stop", () => {
    expect(problemText({ status: "ready", error: "The node did not answer.", moreError: "gone" })).toBe("Could not check for newly closed epochs: The node did not answer. The check is made again by itself.");
    expect(problemText({ status: "ready", error: null, moreError: "The node did not answer." })).toBe("Could not read older epochs: The node did not answer.");
    expect(problemText({ status: "ready", error: null, moreError: null })).toBe("");
  });
});

describe("unavailableText", () => {
  it("says the list is no longer updated only where the node stopped serving the route with epochs held", () => {
    const held = [close(2), close(1)];
    expect(unavailableText({ status: "unavailable", epochs: held })).toBe("This node no longer serves the closed epochs, so these are the ones read earlier and the list is not updated.");
    expect(unavailableText({ status: "unavailable", epochs: [] })).toBe("");
    expect(unavailableText({ status: "ready", epochs: held })).toBe("");
  });
});

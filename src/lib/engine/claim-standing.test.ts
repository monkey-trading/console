import { describe, expect, it } from "vitest";

import { accruedOf, carryAccrued } from "./claim-standing";

const answer = (entitled: string, extra: { newest_entitled?: string; account?: string } = {}) => ({ account: extra.account ?? "0x00A1", entitled, ...(extra.newest_entitled === undefined ? {} : { newest_entitled: extra.newest_entitled }) });

describe("accruedOf", () => {
  it("is the newest checkpoint's amount when the node says it", () => {
    expect(accruedOf(answer("500", { newest_entitled: "900" }))).toBe(900n);
  });

  it("is the proof's own amount from a node that predates the field", () => {
    expect(accruedOf(answer("500"))).toBe(500n);
  });

  it("is never below the proof's amount, and ignores a field that is not a decimal count", () => {
    expect(accruedOf(answer("500", { newest_entitled: "400" }))).toBe(500n);
    expect(accruedOf(answer("500", { newest_entitled: "9e3" }))).toBe(500n);
    expect(accruedOf(answer("500", { newest_entitled: "-1" }))).toBe(500n);
  });
});

describe("carryAccrued", () => {
  it("keeps the higher earned figure when a later answer names an older checkpoint, and the later answer's own proof", () => {
    const newer = answer("900", { newest_entitled: "900" });
    const older = { ...answer("500", { newest_entitled: "500" }), seq: 10 };
    const carried = carryAccrued(newer, older);
    expect(accruedOf(carried)).toBe(900n);
    expect(carried.entitled).toBe("500");
    expect(carried.seq).toBe(10);
  });

  it("takes a later answer that has earned more as it is", () => {
    const next = answer("900", { newest_entitled: "1200" });
    expect(carryAccrued(answer("500", { newest_entitled: "900" }), next)).toBe(next);
  });

  it("carries nothing from no answer, another account's answer, or into an answer from a node without the field", () => {
    const next = answer("500", { newest_entitled: "500" });
    expect(carryAccrued(null, next)).toBe(next);
    expect(carryAccrued(answer("900", { account: "0x00b2" }), next)).toBe(next);
    // A held answer from a node without the field still holds what its proof named.
    expect(accruedOf(carryAccrued(answer("900"), answer("500")))).toBe(900n);
  });

  it("compares accounts without regard to case", () => {
    expect(accruedOf(carryAccrued(answer("900", { account: "0x00ABc" }), answer("500", { account: "0x00abC" })))).toBe(900n);
  });
});

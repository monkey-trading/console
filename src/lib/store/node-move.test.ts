/** The move notice: announced once per move, dismissed for that move alone (monkey-trading/console#272). */

import { describe, expect, it } from "vitest";

import { moveNotice, MoveAnnouncer } from "./node-move";

describe("MoveAnnouncer", () => {
  it("announces a move once, however often the effect runs for it", () => {
    const announcer = new MoveAnnouncer();
    expect(announcer.noticeFor(1, "127.0.0.1:8081")).toBe(moveNotice("127.0.0.1:8081"));
    expect(announcer.noticeFor(1, "127.0.0.1:8081")).toBeNull();
    expect(announcer.noticeFor(1, "127.0.0.1:8081")).toBeNull();
  });

  it("keeps a dismissed notice dismissed for that move, and announces the next move", () => {
    const announcer = new MoveAnnouncer();
    expect(announcer.noticeFor(1, "127.0.0.1:8081")).not.toBeNull();
    announcer.dismissShowing();
    expect(announcer.noticeFor(1, "127.0.0.1:8081")).toBeNull();
    expect(announcer.noticeFor(2, "127.0.0.1:8081")).not.toBeNull();
    expect(announcer.noticeFor(2, "127.0.0.1:8081")).toBeNull();
  });

  it("announces a move to another node even under the same count, and says the attestation verified", () => {
    const announcer = new MoveAnnouncer();
    expect(announcer.noticeFor(1, "127.0.0.1:8081")).toContain("verified its attestation");
    expect(announcer.noticeFor(1, "node.example")).toBe(moveNotice("node.example"));
  });

  it("dismisses nothing before a notice posted", () => {
    const announcer = new MoveAnnouncer();
    announcer.dismissShowing();
    expect(announcer.noticeFor(1, "127.0.0.1:8081")).not.toBeNull();
  });
});

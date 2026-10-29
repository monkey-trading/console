/** Tests that the verifier the app serves is the one the build pins. */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { loadVerifier } from "./load-verifier";
import pin from "./wasm-pin.json";
import { loadGlue, readWasm } from "./test-vectors";

const sha = async (file: string) => createHash("sha256").update(await readFile(new URL(`../../../public/engine-verify/${file}`, import.meta.url))).digest("hex");
const sums = async (): Promise<Record<string, string>> =>
  Object.fromEntries((await readFile(new URL("../../../public/engine-verify/SHA256SUMS", import.meta.url), "utf8")).trim().split("\n").map((line) => {
    const [hash = "", file = ""] = line.split("  ");
    return [file, hash];
  }));

describe("the pinned verifier", () => {
  it("is the .wasm the build pins, and the one the package's SHA256SUMS lists", async () => {
    expect(await sha("engine_verify_bg.wasm")).toBe(pin.sha256);
    expect((await sums())["engine_verify_bg.wasm"]).toBe(pin.sha256);
  });

  it("pins the glue it serves, and keeps the types it compiles against, under the package's sums", async () => {
    const listed = await sums();
    expect(await sha("engine_verify.js")).toBe(pin.glueSha256);
    expect(listed["engine_verify.js"]).toBe(pin.glueSha256);
    expect(await sha("engine_verify.d.ts")).toBe(listed["engine_verify.d.ts"]);
  });

  it("will not run a .wasm that is not the pinned one", async () => {
    const altered = new Uint8Array(await readWasm());
    altered[altered.length - 1] = (altered[altered.length - 1] ?? 0) ^ 1;
    await expect(loadVerifier({ allowMock: false, fetchWasm: async () => altered, loadGlue })).rejects.toThrow("does not match the build's pin");
  });
});

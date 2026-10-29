// Fails the build when the verifier's .wasm or glue is not the one `src/lib/engine/wasm-pin.json` pins.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const pin = JSON.parse(readFileSync(new URL("../src/lib/engine/wasm-pin.json", import.meta.url), "utf8"));
let failed = false;
for (const [file, pinned] of [["engine_verify_bg.wasm", pin.sha256], ["engine_verify.js", pin.glueSha256]]) {
  const actual = createHash("sha256").update(readFileSync(new URL(`../public/engine-verify/${file}`, import.meta.url))).digest("hex");
  if (actual !== pinned) {
    process.stderr.write(`public/engine-verify/${file} is ${actual}, but wasm-pin.json pins ${pinned}\n`);
    failed = true;
  }
}
if (failed) process.exit(1);

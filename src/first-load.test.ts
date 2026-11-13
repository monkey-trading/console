/**
 * Guards what the console's first load carries (monkey-trading/console#338): the connectors, the wallet's
 * chain code, the verifier's trust check and the session key's curves are chunks the page loads after its
 * first paint, so nothing a screen imports statically may reach them. A static import of one, from any
 * module a console route loads, puts its viem code back in the first-load script and the mobile LCP back
 * where it was.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = normalize(join(process.cwd(), "src"));

/** The specifiers a module imports at load: `import … from` and `export … from`, but not type-only ones, and not `import()`. */
function staticImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of text.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?([^;"']*?\bfrom\s+)?["']([^"']+)["']/g)) {
    if (match[2] !== undefined) continue;
    if (match[1] === "export" && match[3] === undefined) continue;
    found.push(match[4] ?? "");
  }
  return found;
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
  if (base === null) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every module the console routes load at start, and the package each reaches it through. */
function reachable(): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const stack: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/^(page|layout)\.tsx$/.test(entry.name)) stack.push(path);
    }
  };
  walk(join(SRC, "app", "(console)"));
  while (stack.length > 0) {
    const file = stack.pop() ?? "";
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of staticImports(file)) {
      const next = resolve(file, spec);
      if (next === null) packages.add(spec);
      else if (!next.includes(".test.")) stack.push(next);
    }
  }
  return { files, packages };
}

describe("the console's first load", () => {
  const { files, packages } = reachable();
  const rel = new Set([...files].map((file) => file.slice(SRC.length + 1)));

  it("carries none of the live session's modules: its connectors, wallet chain code, follower or trust check", () => {
    for (const module of ["components/live-session-setup.ts", "lib/engine/live-session.ts", "lib/engine/provider-wallet.ts", "lib/engine/provider-exit.ts", "lib/engine/injected.ts", "lib/engine/walletconnect.ts", "lib/engine/operator-follow.ts", "lib/engine/trust.ts", "lib/engine/live.ts"]) {
      expect(rel.has(module), module).toBe(false);
    }
  });

  it("carries neither the session key's signer nor the faucet's transport, which load with the first login and the first funding", () => {
    expect(rel.has("lib/engine/session-key.ts")).toBe(false);
    expect(rel.has("lib/engine/faucet.ts")).toBe(false);
    expect(packages.has("viem/accounts")).toBe(false);
  });

  it("carries neither modal dialog of the shell, nor the QR encoder, which load after the page has painted", () => {
    for (const module of ["components/SetupDialog.tsx", "components/SetupSteps.tsx", "components/WalletConnectPairing.tsx", "lib/qr.ts"]) expect(rel.has(module), module).toBe(false);
    expect(packages.has("uqr")).toBe(false);
  });

  it("does carry the mock session, which the mock build starts from at once", () => {
    expect(rel.has("lib/mock/index.ts")).toBe(true);
    expect(rel.has("components/ConsoleProvider.tsx")).toBe(true);
  });
});

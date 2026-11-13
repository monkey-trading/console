/**
 * Tests that the provider builds a mock session at once, and for a build that pins a node builds the
 * live one apart from the page (monkey-trading/console#338): the server render and the first client
 * render of a live build show the same line, and no store exists until the live session's chunk
 * has loaded.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConsoleProvider, useSession } from "./ConsoleProvider";

const Child = () => {
  const { node, follower } = useSession();
  return createElement("p", null, `session ${node === null ? "live" : "mock"} ${follower === null ? "no follower" : "follower"}`);
};
const render = () => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Child)));

afterEach(() => vi.unstubAllEnvs());

describe("ConsoleProvider", () => {
  it("renders its screens at once over the in-browser node in a mock build", () => {
    vi.stubEnv("NEXT_PUBLIC_ENGINE_MODE", "mock");
    expect(render()).toBe("<p>session mock no follower</p>");
  });

  it("renders one status line, and no screen, in a build that pins a node until the live session is built", () => {
    vi.stubEnv("NEXT_PUBLIC_ENGINE_MODE", "live-dev");
    vi.stubEnv("NEXT_PUBLIC_ENGINE_ORIGIN", "https://127.0.0.1:8080");
    vi.stubEnv("NEXT_PUBLIC_ENGINE_DEV_ORIGINS", "https://127.0.0.1:8080");
    vi.stubEnv("NEXT_PUBLIC_ENGINE_CHAIN_ID", "31337");
    vi.stubEnv("NEXT_PUBLIC_ENGINE_VAULT", "0x0000000000000000000000000000000000000000");
    const html = render();
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading the console…");
    expect(html).not.toContain("session ");
  });
});

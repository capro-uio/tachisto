import { chromium, type Browser } from "playwright";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll } from "vitest";
import { serveDirectory, type StaticServer } from "./server.ts";

export const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

interface Served {
  /** The static server over the repository, once `beforeAll` has run. */
  readonly server: StaticServer;
  /** The browser the suite drives, once `beforeAll` has run. */
  readonly browser: Browser;
}

/**
 * Serves the repository and opens a browser for one end-to-end file, closing both afterwards.
 *
 * Called at the top level of a suite, so the hooks it registers belong to that file. The
 * properties are getters because they are only filled in once `beforeAll` has run. A file that
 * writes pages to serve keeps its own `beforeAll` for them; this owns the browser and the server
 * only, which is the part every file had in common and so the part that drifted.
 *
 * `args` are extra Chrome flags, for the suites that need a stand-in camera or an autoplay policy.
 */
export function servedWorkspace({ args }: { args?: string[] } = {}): Served {
  let browser: Browser;
  let server: StaticServer;

  beforeAll(async () => {
    server = await serveDirectory(workspaceRoot);
    browser = await chromium.launch({
      channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
      ...(args ? { args } : {}),
    });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  return {
    get server() {
      return server;
    },
    get browser() {
      return browser;
    },
  };
}

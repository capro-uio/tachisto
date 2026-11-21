import type { Browser } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll } from "vitest";
import { launchBrowser } from "./browser.ts";

interface RunningApp {
  /** Where the built app is served, once `beforeAll` has run. */
  readonly url: string;
  /** The browser the suite drives, once `beforeAll` has run. */
  readonly browser: Browser;
}

/**
 * Builds the app, serves it and opens a browser for one end-to-end file, closing both afterwards.
 *
 * Called at the top level of a suite, so that the hooks it registers belong to that file. The
 * properties are getters because they are only filled in once `beforeAll` has run.
 *
 * This exists because the same twenty lines were written in every e2e file, which is how one
 * wrong teardown timeout came to be fixed in fifteen of them and missed in nineteen, and how
 * fourteen files came to call `chromium.launch` directly and so ignore `PLAYWRIGHT_BROWSER`.
 */
export function runningApp(): RunningApp {
  let browser: Browser;
  let server: PreviewServer;
  let url: string;

  beforeAll(async () => {
    await build({ logLevel: "warn" });
    server = await preview({ preview: { port: 0 }, logLevel: "warn" });
    url = server.resolvedUrls!.local[0];
    browser = await launchBrowser();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  return {
    get url() {
      return url;
    },
    get browser() {
      return browser;
    },
  };
}

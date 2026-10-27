import { type Browser, type Page } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchBrowser } from "./browser.ts";

let browser: Browser;
let server: PreviewServer;
let appUrl: string;

const SPEC_URL = "https://osf.example/study.json";

const sent = {
  name: "sent-study",
  timeline: [
    {
      kind: "trial",
      plugin: "html-keyboard-response",
      params: { stimulus: "<p>from a colleague</p>" },
    },
  ],
};

/** Answers the address a link points at, so no test reaches the network. */
async function serveSpec(page: Page, body: string, status = 200) {
  await page.route(SPEC_URL, (route) =>
    route.fulfill({ status, contentType: "application/json", body }),
  );
}

beforeAll(async () => {
  await build({ logLevel: "warn" });
  server = await preview({ preview: { port: 0 }, logLevel: "warn" });
  appUrl = server.resolvedUrls!.local[0];
  browser = await launchBrowser();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe("opening a spec someone sent", () => {
  it("opens one pasted as JSON", async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    await page.getByTestId("paste-spec-start").click();
    await page.getByTestId("open-spec-text").fill(JSON.stringify(sent));
    await page.getByTestId("open-spec-confirm").click();

    await expect.poll(() => page.getByTestId("experiment-name").inputValue()).toBe("sent-study");
    expect(await page.getByTestId("open-spec").count()).toBe(0);
    await page.close();
  }, 120_000);

  it("says what is wrong with something that is not a spec, and keeps what was open", async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    await page.getByTestId("example-flanker").click();
    await expect
      .poll(() => page.getByTestId("experiment-name").inputValue())
      .toBe("flanker-practice");

    await page.getByTestId("header-menu").click();
    await page.getByTestId("paste-spec").click();
    await page.getByTestId("open-spec-text").fill("[1, 2, 3]");
    await page.getByTestId("open-spec-confirm").click();

    await expect.poll(() => page.getByTestId("open-spec-problem").count()).toBeGreaterThan(0);
    expect(await page.getByTestId("experiment-name").inputValue()).toBe("flanker-practice");
    await page.close();
  }, 120_000);

  // A modal dialog, so Escape closes it and tabbing cannot wander off behind it.
  it("closes on Escape, leaving what was open alone", async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    await page.getByTestId("paste-spec-start").click();
    await page.getByTestId("open-spec-text").fill(JSON.stringify(sent));
    await page.keyboard.press("Escape");

    await expect.poll(() => page.getByTestId("open-spec").count()).toBe(0);
    expect(await page.getByTestId("experiment-name").inputValue()).toBe("untitled-experiment");
    await page.close();
  }, 120_000);

  it("loads nothing when the dialog is cancelled while it is fetching", async () => {
    const page = await browser.newPage();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(SPEC_URL, async (route) => {
      await held;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sent),
      });
    });
    await page.goto(appUrl);
    await page.getByTestId("paste-spec-start").click();
    await page.getByTestId("open-spec-text").fill(SPEC_URL);
    await page.getByTestId("open-spec-confirm").click();
    // Cancel is refused while the answer is on its way, so Escape is the way out.
    expect(await page.getByTestId("open-spec-cancel").isDisabled()).toBe(true);
    await page.keyboard.press("Escape");
    const answered = page.waitForResponse(SPEC_URL);
    release?.();
    await answered;
    await page.waitForTimeout(250);

    expect(await page.getByTestId("open-spec").count()).toBe(0);
    expect(await page.getByTestId("experiment-name").inputValue()).toBe("untitled-experiment");
    await page.close();
  }, 120_000);

  it("fetches one pasted as an address", async () => {
    const page = await browser.newPage();
    await serveSpec(page, JSON.stringify(sent));
    await page.goto(appUrl);
    await page.getByTestId("paste-spec-start").click();
    await page.getByTestId("open-spec-text").fill(SPEC_URL);
    await page.getByTestId("open-spec-confirm").click();

    await expect.poll(() => page.getByTestId("experiment-name").inputValue()).toBe("sent-study");
    await page.close();
  }, 120_000);
});

describe("passing on a link to the spec that is open", () => {
  const grantClipboard = (page: Page) =>
    page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  it("offers a link once a spec came from an address, and copies it", async () => {
    const page = await browser.newPage();
    await grantClipboard(page);
    await serveSpec(page, JSON.stringify(sent));
    await page.goto(appUrl);
    await page.getByTestId("paste-spec-start").click();
    await page.getByTestId("open-spec-text").fill(SPEC_URL);
    await page.getByTestId("open-spec-confirm").click();
    await expect.poll(() => page.getByTestId("experiment-name").inputValue()).toBe("sent-study");

    await page.getByTestId("header-menu").click();
    await page.getByTestId("copy-spec-link").click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(`spec=${encodeURIComponent(SPEC_URL)}`);
    await page.close();
  }, 120_000);

  it("offers no link for a spec that came from nowhere, and stops offering one that is gone", async () => {
    const page = await browser.newPage();
    await serveSpec(page, JSON.stringify(sent));
    await page.goto(appUrl);
    await page.getByTestId("header-menu").click();
    expect(await page.getByTestId("copy-spec-link").count()).toBe(0);
    await page.keyboard.press("Escape");

    await page.getByTestId("paste-spec-start").click();
    await page.getByTestId("open-spec-text").fill(SPEC_URL);
    await page.getByTestId("open-spec-confirm").click();
    await expect.poll(() => page.getByTestId("experiment-name").inputValue()).toBe("sent-study");

    // Opening anything else means the link no longer describes what is open.
    await page.getByTestId("header-menu").click();
    await page.getByTestId("paste-spec").click();
    await page.getByTestId("open-spec-text").fill(JSON.stringify({ ...sent, name: "typed-in" }));
    await page.getByTestId("open-spec-confirm").click();
    await expect.poll(() => page.getByTestId("experiment-name").inputValue()).toBe("typed-in");

    await page.getByTestId("header-menu").click();
    expect(await page.getByTestId("copy-spec-link").count()).toBe(0);
    await page.close();
  }, 120_000);

  it("hands over the link itself when the clipboard refuses", async () => {
    const page = await browser.newPage();
    await serveSpec(page, JSON.stringify(sent));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(new Error("denied")) },
      });
    });
    await page.goto(appUrl);
    await page.getByTestId("paste-spec-start").click();
    await page.getByTestId("open-spec-text").fill(SPEC_URL);
    await page.getByTestId("open-spec-confirm").click();
    await expect.poll(() => page.getByTestId("experiment-name").inputValue()).toBe("sent-study");

    await page.getByTestId("header-menu").click();
    await page.getByTestId("copy-spec-link").click();
    await expect
      .poll(() => page.getByTestId("import-error").textContent())
      .toContain(encodeURIComponent(SPEC_URL));
    await page.close();
  }, 120_000);
});

describe("a link that carries a spec", () => {
  const linked = (base: string, url = SPEC_URL) => `${base}?spec=${encodeURIComponent(url)}`;

  // Nothing is fetched until someone says so: a spec runs code for every participant.
  it("asks before opening, naming where it comes from", async () => {
    const page = await browser.newPage();
    let asked = 0;
    await page.route(SPEC_URL, (route) => {
      asked += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sent),
      });
    });
    await page.goto(linked(appUrl));

    await expect.poll(() => page.getByTestId("invitation").textContent()).toContain("osf.example");
    expect(asked).toBe(0);

    await page.getByTestId("invitation-accept").click();
    await expect.poll(() => page.getByTestId("experiment-name").inputValue()).toBe("sent-study");
    expect(asked).toBe(1);
    await page.close();
  }, 120_000);

  it("opens nothing when the invitation is declined", async () => {
    const page = await browser.newPage();
    let asked = 0;
    await page.route(SPEC_URL, (route) => {
      asked += 1;
      return route.abort();
    });
    await page.goto(linked(appUrl));
    await page.getByTestId("invitation-decline").click();

    expect(await page.getByTestId("invitation").count()).toBe(0);
    expect(asked).toBe(0);
    expect(await page.getByTestId("experiment-name").inputValue()).toBe("untitled-experiment");
    await page.close();
  }, 120_000);

  // The asking is the whole point of the flow, so it has to hold even once "Open it" is clicked.
  it("opens nothing when the invitation is declined while it is being fetched", async () => {
    const page = await browser.newPage();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(SPEC_URL, async (route) => {
      await held;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sent),
      });
    });
    await page.goto(linked(appUrl));
    await page.getByTestId("invitation-accept").click();
    await page.getByTestId("invitation-decline").click();
    const answered = page.waitForResponse(SPEC_URL);
    release?.();
    // Wait for the answer to actually arrive: without that, this passes whether or not the spec
    // is loaded afterwards, which is the one thing it is here to check.
    await answered;
    await page.waitForTimeout(250);

    expect(await page.getByTestId("invitation").count()).toBe(0);
    expect(await page.getByTestId("experiment-name").inputValue()).toBe("untitled-experiment");
    await page.close();
  }, 120_000);

  it("keeps the invitation when the spec cannot be reached, so it can be tried again", async () => {
    const page = await browser.newPage();
    await serveSpec(page, "", 500);
    await page.goto(linked(appUrl));
    await page.getByTestId("invitation-accept").click();
    await expect
      .poll(() => page.getByTestId("import-error").textContent())
      .toContain("answered 500");
    expect(await page.getByTestId("invitation").count()).toBe(1);
    await page.close();
  }, 120_000);

  it("refuses a link that does not point at https", async () => {
    const page = await browser.newPage();
    await page.goto(linked(appUrl, "http://osf.example/study.json"));
    await expect
      .poll(() => page.getByTestId("import-error").textContent())
      .toContain("http: addresses are not opened");
    expect(await page.getByTestId("invitation").count()).toBe(0);
    await page.close();
  }, 120_000);

  it("says so when the spec a link points at is not there", async () => {
    const page = await browser.newPage();
    await serveSpec(page, "", 404);
    await page.goto(linked(appUrl));
    await page.getByTestId("invitation-accept").click();
    await expect
      .poll(() => page.getByTestId("import-error").textContent())
      .toContain("answered 404");
    await page.close();
  }, 120_000);
});

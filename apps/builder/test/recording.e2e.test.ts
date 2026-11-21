import { describe, expect, it } from "vitest";
import { runningApp } from "./app.ts";

const app = runningApp();

describe("a step that uses the camera or microphone", () => {
  it("is said to be out of the preview's reach", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await page.getByTestId("slot-0").click();
    await page.getByTestId("slot-0-trial").click();
    expect(await page.getByTestId("device-note").count()).toBe(0);

    await page.getByTestId("trial-plugin").selectOption("initialize-microphone");
    expect(await page.getByTestId("device-note").innerText()).toContain(
      "cannot reach a camera or microphone",
    );
    await page.close();
  }, 120_000);
});

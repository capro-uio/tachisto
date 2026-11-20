import { describe, expect, it, vi } from "vitest";
import { cdnUrl, filesOfPackages } from "tachisto-compiler";
import { fetchPackageSources } from "../src/lib/package-sources.ts";
import { schemas } from "../src/lib/schemas.ts";
import { installedCopy } from "./installed.ts";

const respond = (body: Uint8Array<ArrayBuffer> | null, status = 200) =>
  Promise.resolve(new Response(body, { status }));

const jspsych = filesOfPackages(schemas, [{ name: "jspsych", version: schemas.jspsych }]);
const css = jspsych.find((file) => file.path.endsWith(".css"))!;

describe("fetchPackageSources", () => {
  it("fetches each file from unpkg at its version and keeps the copy that matches", async () => {
    const fetcher = vi.fn((url: string) => respond(installedCopy(url)));
    const copies = await fetchPackageSources([css], fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(cdnUrl(css), expect.anything());
    expect(new TextDecoder().decode(copies["jspsych/css/jspsych.css"])).toContain(
      ".jspsych-display-element",
    );
  });

  it("refuses a copy that is not the file Tachisto checked", async () => {
    const fetcher = () => respond(new TextEncoder().encode("body { display: none }"));
    await expect(fetchPackageSources([css], fetcher as unknown as typeof fetch)).rejects.toThrow(
      /jspsych\/css\/jspsych\.css from unpkg is not the file Tachisto checked/,
    );
  });

  it("says which file it could not fetch, and how to download without fetching", async () => {
    const missing = () => respond(null, 404);
    await expect(fetchPackageSources([css], missing as unknown as typeof fetch)).rejects.toThrow(
      /could not fetch jspsych\/css\/jspsych\.css \(404\); .*turn off Self-contained/,
    );
    const offline = () => Promise.reject(new TypeError("Failed to fetch"));
    await expect(fetchPackageSources([css], offline as unknown as typeof fetch)).rejects.toThrow(
      /could not fetch jspsych\/css\/jspsych\.css \(Failed to fetch\); .*turn off Self-contained/,
    );
  });

  it("stops fetching the rest once one file fails", async () => {
    let signal: AbortSignal | undefined;
    const fetcher = (url: string, init?: RequestInit) => {
      if (url.endsWith(".css")) return respond(null, 500);
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    };
    await expect(fetchPackageSources(jspsych, fetcher as unknown as typeof fetch)).rejects.toThrow(
      /500/,
    );
    expect(signal?.aborted).toBe(true);
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assemblePages, repositoryLayout, type PagesSources } from "../scripts/pages.ts";

describe("assemblePages", () => {
  let dir: string;
  let sources: PagesSources;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tachisto-pages-"));
    sources = {
      site: join(dir, "site"),
      builder: join(dir, "builder"),
      specSchema: join(dir, "spec-schema.json"),
      llms: join(dir, "llms.txt"),
    };
    mkdirSync(sources.site);
    mkdirSync(sources.builder);
    writeFileSync(join(sources.site, "index.html"), "site");
    writeFileSync(join(sources.builder, "index.html"), "builder");
    writeFileSync(sources.specSchema, "{}");
    writeFileSync(sources.llms, "# Tachisto\n");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("puts the site at the root, the builder under app/ and the schema beside the site", () => {
    const out = join(dir, "out");
    assemblePages(sources, out);
    expect(readFileSync(join(out, "index.html"), "utf8")).toBe("site");
    expect(readFileSync(join(out, "app", "index.html"), "utf8")).toBe("builder");
    expect(readFileSync(join(out, "spec-schema.json"), "utf8")).toBe("{}");
    // Where an agent looks, and where a spec's `$schema` points: both at the root.
    expect(readFileSync(join(out, "llms.txt"), "utf8")).toBe("# Tachisto\n");
  });

  it("starts from an empty folder, so nothing from an earlier build is served", () => {
    const out = join(dir, "out");
    mkdirSync(out);
    writeFileSync(join(out, "stale.html"), "old");
    assemblePages(sources, out);
    expect(existsSync(join(out, "stale.html"))).toBe(false);
  });

  it("says which build is missing rather than publishing half a site", () => {
    const out = join(dir, "out");
    expect(() => assemblePages({ ...sources, builder: join(dir, "nope") }, out)).toThrow(
      /builder not found/,
    );
  });
});

describe("repositoryLayout", () => {
  it("names builds that exist in this repository", () => {
    const { sources } = repositoryLayout(join(import.meta.dirname, "../../.."));
    expect(existsSync(sources.specSchema)).toBe(true);
    expect(existsSync(sources.llms)).toBe(true);
    expect(sources.site).toMatch(/apps[\\/]site[\\/]dist$/);
    expect(sources.builder).toMatch(/apps[\\/]builder[\\/]dist$/);
  });
});

describe("the website", () => {
  const html = readFileSync(join(import.meta.dirname, "..", "index.html"), "utf8");

  it("links to the builder where the pages put it", () => {
    expect(html).toContain('href="./app/"');
  });

  it("uses paths relative to itself, since it is served from a subfolder", () => {
    expect(html).not.toMatch(/(?:href|src)="\/[^/]/);
  });
});

describe("the link preview", () => {
  const html = readFileSync(join(import.meta.dirname, "..", "index.html"), "utf8");
  const meta = (property: string) =>
    new RegExp(`<meta\\s+(?:property|name)="${property}"\\s+content="([^"]*)"`).exec(html)?.[1];
  const home = "https://www.capro.dev/tachisto/";

  it("names the address the site is served from", () => {
    expect(meta("og:url")).toBe(home);
    expect(html).toContain(`<link rel="canonical" href="${home}" />`);
  });

  it("points at an image on the site by its full address, since crawlers do not resolve paths", () => {
    const image = meta("og:image");
    expect(image?.startsWith(home)).toBe(true);
    const file = fileURLToPath(
      import.meta.resolve(`@tachisto/brand/logos/${image!.slice(home.length)}`),
    );
    const header = readFileSync(file).subarray(0, 24);
    expect(header.readUInt32BE(16)).toBe(Number(meta("og:image:width")));
    expect(header.readUInt32BE(20)).toBe(Number(meta("og:image:height")));
  });

  it("describes the image and asks for the large card", () => {
    expect(meta("og:image:alt")).toBeTruthy();
    expect(meta("twitter:card")).toBe("summary_large_image");
  });
});

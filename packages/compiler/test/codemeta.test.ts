import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import bundle from "tachisto-schemas/plugin-schemas.json" with { type: "json" };
import manifest from "../package.json" with { type: "json" };
import { updateCodemeta } from "../src/codemeta.ts";
import { GENERATOR_URL } from "../src/metadata.ts";

interface CommittedCodemeta {
  version: string;
  description: string;
  codeRepository: string;
  softwareRequirements: { version: string }[];
}

const readRoot = <T>(file: string) =>
  JSON.parse(readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8")) as T;

const handWritten = {
  "@context": "https://w3id.org/codemeta/3.0",
  name: "Tachisto",
  author: [{ "@type": "Person", familyName: "Mowinckel" }],
};

const packageJson = {
  description: "A builder.",
  license: "MIT",
  homepage: "https://www.capro.dev/tachisto/",
  keywords: ["jsPsych"],
  repository: { type: "git", url: "git+https://github.com/capro-uio/tachisto.git" },
  bugs: { url: "https://github.com/capro-uio/tachisto/issues" },
};

const release = { version: "0.0.2", jspsych: "8.3.0", date: "2026-11-01" };

describe("codemeta for a release", () => {
  it("takes what package.json already says from there", () => {
    expect(updateCodemeta(handWritten, packageJson, release)).toMatchObject({
      description: "A builder.",
      codeRepository: "https://github.com/capro-uio/tachisto",
      issueTracker: "https://github.com/capro-uio/tachisto/issues",
      url: "https://www.capro.dev/tachisto/",
      license: "https://spdx.org/licenses/MIT",
      keywords: ["jsPsych"],
    });
  });

  it("leaves out what package.json does not say", () => {
    const updated = updateCodemeta(handWritten, { repository: "https://example.org/r" }, release);
    expect(updated).not.toHaveProperty("license");
    expect(updated).not.toHaveProperty("description");
    expect(updated.codeRepository).toBe("https://example.org/r");
  });

  it("records the version, where to get it, and the jsPsych it builds for", () => {
    expect(updateCodemeta(handWritten, packageJson, release)).toMatchObject({
      version: "0.0.2",
      dateModified: "2026-11-01",
      downloadUrl: "https://github.com/capro-uio/tachisto/releases/tag/v0.0.2",
      softwareRequirements: [{ name: "jsPsych", version: "8.3.0" }],
    });
    expect(updateCodemeta(handWritten, {}, release)).not.toHaveProperty("downloadUrl");
  });

  it("keeps what was written by hand, in place", () => {
    const updated = updateCodemeta(handWritten, packageJson, release);
    expect(Object.keys(updated).slice(0, 3)).toEqual(["@context", "name", "author"]);
    expect(updated.author).toEqual(handWritten.author);
  });

  // The date would otherwise change every day, and the check that codemeta.json is current with it.
  it("moves the date only when the version changes", () => {
    const released = updateCodemeta(handWritten, packageJson, release);
    const later = { ...release, date: "2027-01-01" };
    expect(updateCodemeta(released, packageJson, later).dateModified).toBe("2026-11-01");
    expect(updateCodemeta(released, packageJson, { ...later, version: "0.0.3" }).dateModified).toBe(
      "2027-01-01",
    );
  });

  it("is current with this build in the committed file", () => {
    const committed = readRoot<CommittedCodemeta>("codemeta.json");
    expect(committed.version).toBe(manifest.version);
    expect(committed.softwareRequirements[0].version).toBe(bundle.jspsych);
    expect(committed.description).toBe(
      readRoot<{ description: string }>("package.json").description,
    );
  });

  // Exports link to the generator by this address, so it has to be the repository's own.
  it("names the same repository that exports link to", () => {
    expect(readRoot<CommittedCodemeta>("codemeta.json").codeRepository).toBe(GENERATOR_URL);
  });
});

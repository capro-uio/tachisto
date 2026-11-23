import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { citationCff, toYaml, zenodoMetadata } from "../src/citation.ts";
import { GENERATOR_DOI, datasetDescription, sourceHeader } from "../src/metadata.ts";
import type { Spec } from "../src/types.ts";
import type { Codemeta } from "../src/codemeta.ts";

const readRoot = (file: string) =>
  readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");

const codemeta: Codemeta = {
  name: "Tachisto",
  identifier: "https://doi.org/10.5281/zenodo.23669791",
  description: "A builder.",
  codeRepository: "https://github.com/capro-uio/tachisto",
  url: "https://www.capro.dev/tachisto/",
  license: "https://spdx.org/licenses/MIT",
  keywords: ["jsPsych", "no-code"],
  author: [
    {
      "@type": "Person",
      "@id": "https://orcid.org/0000-0002-5756-0223",
      givenName: "Athanasia Mo",
      familyName: "Mowinckel",
      affiliation: { "@type": "Organization", name: "University of Oslo" },
    },
    { "@type": "Person", givenName: "Ada", familyName: "Lovelace" },
    { "@type": "Organization", name: "CAPRO" },
  ],
  version: "0.0.2",
  dateModified: "2026-11-01",
  softwareRequirements: [
    { "@type": "SoftwareApplication", name: "jsPsych", url: "https://www.jspsych.org/" },
  ],
};

describe("CITATION.cff from codemeta", () => {
  it("names each author as codemeta does, with an ORCID and affiliation only where there is one", () => {
    expect(citationCff(codemeta).authors).toEqual([
      {
        "given-names": "Athanasia Mo",
        "family-names": "Mowinckel",
        orcid: "https://orcid.org/0000-0002-5756-0223",
        affiliation: "University of Oslo",
      },
      { "given-names": "Ada", "family-names": "Lovelace" },
      { name: "CAPRO" },
    ]);
  });

  it("carries the version, its date, the licence as an SPDX id, and the keywords", () => {
    expect(citationCff(codemeta)).toMatchObject({
      "cff-version": "1.2.0",
      type: "software",
      title: "Tachisto",
      abstract: "A builder.",
      doi: "10.5281/zenodo.23669791",
      version: "0.0.2",
      "date-released": "2026-11-01",
      license: "MIT",
      keywords: ["jsPsych", "no-code"],
      "repository-code": "https://github.com/capro-uio/tachisto",
      url: "https://www.capro.dev/tachisto/",
    });
  });

  it("leaves out what codemeta does not say", () => {
    const cff = citationCff({ name: "Tachisto", author: [] });
    expect(Object.keys(cff)).toEqual(["cff-version", "message", "type", "title", "authors"]);
  });
});

describe("the DOI in CITATION.cff", () => {
  it("is the bare DOI the codemeta identifier names", () => {
    expect(citationCff(codemeta).doi).toBe("10.5281/zenodo.23669791");
  });

  it("is left out when codemeta names no DOI", () => {
    expect(citationCff({ name: "Tachisto", author: [] })).not.toHaveProperty("doi");
  });

  it("is left out when the identifier is not a DOI", () => {
    const other = { ...codemeta, identifier: "https://example.org/tachisto" };
    expect(citationCff(other)).not.toHaveProperty("doi");
  });

  it("stays out of .zenodo.json, which Zenodo mints a DOI for itself", () => {
    expect(zenodoMetadata(codemeta)).not.toHaveProperty("doi");
  });
});

describe("Zenodo metadata from codemeta", () => {
  it("names creators as family, given, with a bare ORCID and affiliation only where there is one", () => {
    expect(zenodoMetadata(codemeta).creators).toEqual([
      {
        name: "Mowinckel, Athanasia Mo",
        orcid: "0000-0002-5756-0223",
        affiliation: "University of Oslo",
      },
      { name: "Lovelace, Ada" },
      { name: "CAPRO" },
    ]);
  });

  it("describes open software with its version, licence and keywords", () => {
    expect(zenodoMetadata(codemeta)).toMatchObject({
      upload_type: "software",
      access_right: "open",
      title: "Tachisto",
      description: "A builder.",
      version: "0.0.2",
      license: "mit",
      keywords: ["jsPsych", "no-code"],
    });
  });

  it("points to the website that documents it and the jsPsych it requires", () => {
    expect(zenodoMetadata(codemeta).related_identifiers).toEqual([
      { identifier: "https://www.capro.dev/tachisto/", relation: "isDocumentedBy", scheme: "url" },
      {
        identifier: "https://www.jspsych.org/",
        relation: "requires",
        scheme: "url",
        resource_type: "software",
      },
    ]);
  });

  it("relates nothing it has no address for", () => {
    const zenodo = zenodoMetadata({ name: "Tachisto", softwareRequirements: [{ name: "x" }] });
    expect(zenodo.related_identifiers).toEqual([]);
    expect(zenodo).not.toHaveProperty("license");
  });
});

describe("YAML for CITATION.cff", () => {
  it("writes lists of mappings, and quotes every string so none reads as another type", () => {
    expect(toYaml({ version: "1.0", authors: [{ name: "A", orcid: "o" }], keywords: [] })).toBe(
      'version: "1.0"\nauthors:\n  - name: "A"\n    orcid: "o"\nkeywords: []\n',
    );
  });
});

describe("the committed citation files", () => {
  it("say what the committed codemeta.json says", () => {
    const committed = JSON.parse(readRoot("codemeta.json")) as Codemeta;
    expect(JSON.parse(readRoot(".zenodo.json"))).toEqual(zenodoMetadata(committed));
    expect(readRoot("CITATION.cff")).toBe(toYaml(citationCff(committed)));
  });
});

describe("the DOI a generated study cites", () => {
  const spec: Spec = { name: "a study", timeline: [] };
  const options = { jspsych: "8.2.1", tachisto: "0.0.3", generatedAt: "2026-11-23" };

  // The DOI is written into the compiler because an installed copy has no repository to read it
  // from. That is only safe while it still matches the one the repository publishes.
  it("is the one codemeta.json gives, so the two cannot drift apart", () => {
    const committed = JSON.parse(readRoot("codemeta.json")) as { identifier: string };
    expect(GENERATOR_DOI).toBe(committed.identifier);
  });

  it("reaches the dataset's provenance, beside the version it belongs to", () => {
    const [tachisto] = datasetDescription(spec, ["rt"], options).isBasedOn;
    expect(tachisto).toMatchObject({
      name: "Tachisto",
      identifier: GENERATOR_DOI,
      softwareVersion: "0.0.3",
    });
  });

  it("reaches the top of the generated experiment, where someone reading it will look", () => {
    expect(sourceHeader(spec, options)).toContain(GENERATOR_DOI);
  });
});

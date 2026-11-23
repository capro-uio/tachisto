import { describe, expect, it, vi } from "vitest";
import { GENERATOR_DOI } from "../src/metadata.ts";
import manifest from "../package.json" with { type: "json" };
import { dataPipeSetupMarkdown } from "../src/datapipe-setup.ts";
import type { DatasetDescription } from "../src/metadata.ts";
import { projectFiles, type ProjectFile } from "../src/targets/project.ts";
import type { Spec } from "../src/types.ts";
import { schemas } from "./schemas.ts";

// A one-pixel PNG, as the builder would hold it after someone added a file.
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Producer is checked for absence: tools belong under isBasedOn, never as the producer.
const describedDataset = (files: Record<string, ProjectFile>) =>
  JSON.parse(files["dataset_description.json"] as string) as DatasetDescription & {
    producer?: unknown;
  };

const spec: Spec = {
  name: "picture-study",
  data: { save: "post", experiment_id: "abc123DEF456" },
  assets: [{ name: "face.png", url: PIXEL }],
  timeline: [
    {
      kind: "trial",
      plugin: "image-keyboard-response",
      params: { stimulus: "face.png" },
    },
  ],
};

describe("downloading the whole project", () => {
  it("includes the page, the experiment, the project file and a readme", async () => {
    const files = await projectFiles(spec, schemas);
    expect(Object.keys(files).sort()).toEqual([
      "DATAPIPE-SETUP.md",
      "README.md",
      "assets/face.png",
      "dataset_description.json",
      "experiment.js",
      "experiment.json",
      "index.html",
    ]);
  });

  it("writes media as real files rather than embedding them", async () => {
    const files = await projectFiles(spec, schemas);
    const picture = files["assets/face.png"] as Uint8Array;

    expect(picture).toBeInstanceOf(Uint8Array);
    // A PNG, byte for byte, rather than text that looks like one.
    expect([...picture.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(files["experiment.js"]).toContain('"face.png": "assets/face.png"');
    expect(files["experiment.js"]).not.toContain("base64");
  });

  it("keeps the experiment in its own file, loaded by the page", async () => {
    const files = await projectFiles(spec, schemas);
    expect(files["index.html"]).toContain('<script src="experiment.js">');
    expect(files["index.html"]).not.toContain("jsPsych.run");
    expect(files["experiment.js"]).toContain("jsPsych.run");
  });

  it("saves the figures it is given under figures/ and lists them in the readme", async () => {
    const flow = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const files = await projectFiles(spec, schemas, { figures: { "flow.svg": flow } });
    expect(files["figures/flow.svg"]).toBe(flow);
    expect(files["README.md"]).toContain(
      "- `figures/` — figures of the study for a paper or poster: `flow.svg`",
    );
  });

  it("has no figures folder when it is given none", async () => {
    const files = await projectFiles(spec, schemas);
    expect(Object.keys(files).some((path) => path.startsWith("figures/"))).toBe(false);
    expect(files["README.md"]).not.toContain("figures/");
  });

  it("can be opened again in the builder", async () => {
    const files = await projectFiles(spec, schemas);
    const reopened = JSON.parse(files["experiment.json"] as string) as Spec;
    expect(reopened).toEqual(spec);
  });

  it("says where the data goes", async () => {
    const uploading = await projectFiles(spec, schemas);
    expect(uploading["README.md"]).toContain("abc123DEF456");
    expect(uploading["README.md"]).toContain("Results are uploaded to DataPipe under");
    const emptyAddress = await projectFiles(
      { ...spec, data: { save: "post", experiment_id: "abc123DEF456", endpoint: "" } },
      schemas,
    );
    expect(emptyAddress["README.md"]).toContain("Results are uploaded to DataPipe under");
    const ownPipe = await projectFiles(
      {
        ...spec,
        data: {
          save: "post",
          experiment_id: "abc123DEF456",
          endpoint: "https://example.org/datapipe/",
        },
      },
      schemas,
    );
    expect(ownPipe["README.md"]).toContain(
      "Results are uploaded to https://example.org/datapipe under",
    );

    const nowhere = await projectFiles({ ...spec, data: undefined }, schemas);
    expect(nowhere["README.md"]).toContain("does not keep its results");
  });

  it("carries a DataPipe setup checklist, linked from the readme, only when it uploads", async () => {
    const uploading = await projectFiles(spec, schemas);
    expect(uploading["DATAPIPE-SETUP.md"]).toBe(dataPipeSetupMarkdown(spec));
    expect(uploading["README.md"]).toContain("[`DATAPIPE-SETUP.md`](DATAPIPE-SETUP.md)");

    for (const data of [undefined, { save: "download" as const }]) {
      const files = await projectFiles({ ...spec, data }, schemas);
      expect(files["DATAPIPE-SETUP.md"]).toBeUndefined();
      expect(files["README.md"]).not.toContain("DATAPIPE-SETUP.md");
    }
  });

  it("describes the data it will produce, in Psych-DS form", async () => {
    const files = await projectFiles(spec, schemas, { generatedAt: "2026-10-16" });
    const metadata = describedDataset(files);

    expect(metadata["@context"]).toBe("https://schema.org/");
    expect(metadata["@type"]).toBe("Dataset");
    expect(metadata.name).toBe("picture-study");
    expect(metadata.dateCreated).toBe("2026-10-16");
    // The tools are what the data is based on; they are not authors. jsPsych is named in its own
    // right, with its version, because it is what wrote the rows.
    expect(metadata.isBasedOn).toMatchObject([
      { "@type": "SoftwareApplication", name: "Tachisto" },
      { "@type": "SoftwareApplication", name: "jsPsych" },
    ]);
    expect(metadata.isBasedOn[1].softwareVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(metadata.producer).toBeUndefined();
    expect(metadata.author).toBeUndefined();

    // The columns this experiment actually writes, not a generic list.
    expect(metadata.variableMeasured).toContain("participant_id");
    expect(metadata.variableMeasured).toContain("rt");
    expect(metadata.variableMeasured).toContain("trial_type");
    // Each plugin's own columns, the preload step's among them, and none from plugins not run.
    expect(metadata.variableMeasured).toEqual(
      expect.arrayContaining(["stimulus", "rt_key_duration", "success", "failed_images"]),
    );
    expect(metadata.variableMeasured).not.toContain("slider_start");
  });

  it("says in the experiment file where it came from and how to keep editing", async () => {
    const files = await projectFiles(spec, schemas, { generatedAt: "2026-10-16" });
    const source = files["experiment.js"] as string;

    expect(source.startsWith("/*")).toBe(true);
    expect(source).toContain(`Built with Tachisto ${manifest.version} on 2026-10-16`);
    expect(source).toContain("generated from experiment.json");
    expect(files["index.html"]).toContain(
      `<meta name="generator" content="Tachisto ${manifest.version}" />`,
    );
  });

  it("names the Tachisto version that built it", async () => {
    const files = await projectFiles(spec, schemas);
    const metadata = describedDataset(files);

    expect(metadata.isBasedOn[0].softwareVersion).toBe(manifest.version);
    expect(metadata.isBasedOn[1].softwareVersion).toEqual(expect.any(String));
  });

  it("leaves the Tachisto version out of an unreleased build", async () => {
    // A dataset built by "Tachisto 0.0.0" names a build nobody can obtain.
    vi.resetModules();
    vi.doMock("../package.json", () => ({ default: { ...manifest, version: "0.0.0" } }));
    try {
      const unreleased = await import("../src/targets/project.ts");
      const files = await unreleased.projectFiles(spec, schemas, { generatedAt: "2026-10-16" });
      const metadata = describedDataset(files);

      expect(metadata.isBasedOn[0].softwareVersion).toBeUndefined();
      expect(files["experiment.js"]).toContain("Built with Tachisto on 2026-10-16");
      expect(files["index.html"]).toContain('<meta name="generator" content="Tachisto" />');
      expect(files["README.md"]).toContain("Built with Tachisto.");
    } finally {
      vi.doUnmock("../package.json");
      vi.resetModules();
    }
  });

  it("says which Tachisto built it, once there is a version", async () => {
    const files = await projectFiles(spec, schemas, {
      generatedAt: "2026-10-16",
      tachisto: "1.2.0",
    });
    const metadata = describedDataset(files);

    expect(metadata.isBasedOn[0]).toMatchObject({
      name: "Tachisto",
      softwareVersion: "1.2.0",
    });
    expect(files["experiment.js"]).toContain("Built with Tachisto 1.2.0 on 2026-10-16");
    expect(files["index.html"]).toContain('<meta name="generator" content="Tachisto 1.2.0" />');
    expect(files["README.md"]).toContain("Built with Tachisto 1.2.0.");
    // Whoever writes the paper reads this file, so the tool's DOI belongs where they will find it.
    expect(files["README.md"]).toContain(GENERATOR_DOI);
  });

  it("lists the platform's id parameter among the columns", async () => {
    const files = await projectFiles(
      { ...spec, recruitment: { id_param: "PROLIFIC_PID" } },
      schemas,
    );
    const metadata = describedDataset(files);
    expect(metadata.variableMeasured).toContain("PROLIFIC_PID");
  });

  it("says in its readme how participants arrive and where they go back to", async () => {
    const url = "https://app.prolific.com/submissions/complete?cc=C1A2B3";
    const recruitment = { id_param: "PROLIFIC_PID", endings: { complete: { url } } };
    const files = await projectFiles({ ...spec, recruitment }, schemas);
    expect(files["README.md"]).toContain("## Recruiting");
    expect(files["README.md"]).toContain("`PROLIFIC_PID` parameter");
    expect(files["README.md"]).toContain(`sent to ${url}`);

    const plain = await projectFiles(spec, schemas);
    expect(plain["README.md"]).not.toContain("## Recruiting");
    expect(plain["README.md"]).not.toContain("end early");
  });

  it("says in its readme how many participants the study plans to recruit", async () => {
    const planned = (await projectFiles({ ...spec, sample_size: 80 }, schemas))["README.md"];
    expect(planned).toContain("## Recruiting");
    expect(planned).toContain("The study plans to recruit 80 participants.");
    expect(planned).not.toContain("parameter of the link");

    const one = (await projectFiles({ ...spec, sample_size: 1 }, schemas))["README.md"];
    expect(one).toContain("The study plans to recruit 1 participant.");

    const recruitment = { id_param: "PROLIFIC_PID" };
    const both = (await projectFiles({ ...spec, sample_size: 80, recruitment }, schemas))[
      "README.md"
    ];
    expect(both).toContain("80 participants.\n\nEach participant's id is read from");
  });

  it("leaves the planned sample size out of the Psych-DS metadata, which has no field for it", async () => {
    const options = { generatedAt: "2026-10-16" };
    const planned = await projectFiles({ ...spec, sample_size: 80 }, schemas, options);
    const unplanned = await projectFiles(spec, schemas, options);
    expect(describedDataset(planned)).toEqual(describedDataset(unplanned));
  });

  it("says in its readme what each early ending keeps", async () => {
    const message = "<p>Thank you.</p>";
    const recruitment = {
      endings: {
        no_consent: { message, keep: "nothing" as const },
        screened_out: { message, keep: "checkpoint" as const },
        dropped: { message },
      },
    };
    const readme = (await projectFiles({ ...spec, recruitment }, schemas))["README.md"];
    expect(readme).toContain("`ending` column");
    expect(readme).toContain("- `no_consent`: nothing is kept or sent");
    expect(readme).toContain("- `screened_out`: only that row is kept");
    expect(readme).toContain("- `dropped`: all their data is kept");
  });

  it("names the experiment on every row of the data", async () => {
    const files = await projectFiles(spec, schemas);
    expect(files["experiment.js"]).toContain('experiment: "picture-study"');
  });

  it("names the people who made it, when they have said who they are", async () => {
    const withAuthors = {
      ...spec,
      authors: [
        {
          name: "A Researcher",
          identifier: "https://orcid.org/0000-0002-1825-0097",
          affiliation: " University of Oslo ",
        },
        { name: "Another Researcher", affiliation: "   " },
      ],
    };
    const files = await projectFiles(withAuthors, schemas);
    const metadata = describedDataset(files);

    expect(metadata.author).toEqual([
      {
        "@type": "Person",
        name: "A Researcher",
        identifier: "https://orcid.org/0000-0002-1825-0097",
        affiliation: { "@type": "Organization", name: "University of Oslo" },
      },
      { "@type": "Person", name: "Another Researcher" },
    ]);
  });
});

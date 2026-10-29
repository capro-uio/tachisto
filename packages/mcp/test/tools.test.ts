import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  compileSpecSource,
  INLINE,
  linkToSpec,
  spoken,
  validateSpecSource,
  withinRoot,
} from "../src/tools.ts";

const workspace = mkdtempSync(join(tmpdir(), "tachisto-mcp-"));

// Whoever starts the server chooses where it may write; here that is this test.
beforeAll(() => {
  process.env.TACHISTO_MCP_ROOT = workspace;
});

const runnable = {
  name: "beep",
  timeline: [
    { kind: "trial", plugin: "html-keyboard-response", params: { stimulus: "<p>hi</p>" } },
  ],
};

const asText = (value: unknown) => JSON.stringify(value);

describe("validating a spec handed over in the call", () => {
  it("says a runnable study will run", () => {
    const answer = validateSpecSource({ spec: asText(runnable) });
    expect(answer.failed).toBe(false);
    expect(answer.text).toBe("beep is a study that will run.");
    expect(answer.payload).toMatchObject({ ok: true, name: "beep", problems: [] });
  });

  it("reports the problems with one that will not, and fails", () => {
    const answer = validateSpecSource({ spec: asText({ name: "empty", timeline: [] }) });
    expect(answer.failed).toBe(true);
    expect(answer.text).toContain("error: the timeline has no steps");
    expect(answer.payload.ok).toBe(false);
  });

  // "will not run" blames an experiment; there was never one to blame.
  it("tells a spec it could not read apart from one that will not run", () => {
    const unreadable = validateSpecSource({ path: "absent.json" });
    expect(unreadable.failed).toBe(true);
    expect(unreadable.text).toContain("There is no spec to check at absent.json");

    const invalid = validateSpecSource({ spec: asText({ name: "empty", timeline: [] }) });
    expect(invalid.text).toContain("will not run as it stands");
  });

  it("says nothing about a path for a spec that was never a file", () => {
    const answer = validateSpecSource({ spec: "{ not json" });
    expect(answer.failed).toBe(true);
    expect(answer.payload).not.toHaveProperty("spec");
    // The words still have to name something, and there is no path to name.
    expect(answer.text).toContain(INLINE);
  });

  it("reads a spec from a path when given one instead", () => {
    const path = join(workspace, "study.json");
    writeFileSync(path, asText(runnable));
    expect(validateSpecSource({ path }).payload).toMatchObject({ ok: true, spec: path });
  });
});

describe("how a spec has to be named", () => {
  it("refuses a call that gives both a spec and a path, or neither", () => {
    for (const source of [{ spec: asText(runnable), path: "study.json" }, {}]) {
      const answer = validateSpecSource(source);
      expect(answer.failed).toBe(true);
      expect(answer.text).toContain("Nothing was validated");
    }
    expect(validateSpecSource({}).payload.problems[0].message).toBe(
      "give a spec, or a path to one",
    );
    expect(validateSpecSource({ spec: "{}", path: "p.json" }).payload.problems[0].message).toBe(
      "give the spec or a path to it, not both",
    );
  });

  it("refuses the same way when compiling", async () => {
    const answer = await compileSpecSource({});
    expect(answer.failed).toBe(true);
    expect(answer.text).toContain("Nothing was compiled");
  });
});

describe("compiling a spec", () => {
  it("writes the study where it is told and says what it used", async () => {
    const out = join(workspace, "study.html");
    const answer = await compileSpecSource({ spec: asText(runnable) }, "study.html");
    expect(answer.failed).toBe(false);
    expect(answer.text).toContain("plugin(s)");
    expect(readFileSync(out, "utf8")).toContain("<html");
  });

  it("writes nothing and fails when the spec has errors", async () => {
    const out = join(workspace, "never.html");
    const answer = await compileSpecSource({ spec: asText({ name: "empty", timeline: [] }) }, out);
    expect(answer.failed).toBe(true);
    expect(() => readFileSync(out, "utf8")).toThrow();
  });
});

describe("where a study may be written", () => {
  // A spec can be written by anyone, so neither it nor the agent acting on it picks the path.
  it("refuses to write outside the directory the server was started in", async () => {
    const answer = await compileSpecSource({ spec: asText(runnable) }, "../escaped.html");
    expect(answer.failed).toBe(true);
    expect(answer.text).toContain("is outside");

    const absolute = await compileSpecSource({ spec: asText(runnable) }, "/tmp/escaped.html");
    expect(absolute.failed).toBe(true);
  });

  // Confinement alone would still let a study be written over a git hook or a shell profile.
  it("refuses a name that is not a study", async () => {
    const answer = await compileSpecSource({ spec: asText(runnable) }, "hooks/pre-commit");
    expect(answer.failed).toBe(true);
    expect(answer.text).toContain(".html");
  });

  it("takes a path inside the root, and refuses the root itself", () => {
    const inside = withinRoot("out/study.html");
    expect("path" in inside && inside.path).toContain(join("out", "study.html"));
    expect(withinRoot("..")).toHaveProperty("problem");
    expect(withinRoot(".")).toHaveProperty("problem");
  });

  // The escape this guard exists to stop: confinement that resolved only paths already there
  // would take a link standing over a file about to be written for a directory, and follow it.
  it("refuses to write through a link that leads out of the root", async () => {
    const outside = mkdtempSync(join(tmpdir(), "tachisto-mcp-outside-"));
    symlinkSync(outside, join(workspace, "away"), "dir");

    expect(withinRoot("away/study.html")).toHaveProperty("problem");
    const answer = await compileSpecSource({ spec: asText(runnable) }, "away/study.html");
    expect(answer.failed).toBe(true);
    expect(answer.text).toContain("leads outside");
    expect(existsSync(join(outside, "study.html"))).toBe(false);
  });

  it("refuses to read through one too", () => {
    const outside = mkdtempSync(join(tmpdir(), "tachisto-mcp-outside-"));
    writeFileSync(join(outside, "study.json"), asText(runnable));
    symlinkSync(join(outside, "study.json"), join(workspace, "linked.json"), "file");

    const answer = validateSpecSource({ path: "linked.json" });
    expect(answer.failed).toBe(true);
    expect(answer.text).toContain("There is no spec to check at linked.json");
    expect(spoken(answer.payload.problems)).toContain("leads outside");
  });

  it("falls back to a name of its own when none is given", async () => {
    const answer = await compileSpecSource({ spec: asText(runnable) });
    expect(answer.failed).toBe(false);
    expect(answer.payload.output).toContain("experiment.html");
    expect(readFileSync(join(workspace, "experiment.html"), "utf8")).toContain("<html");
  });
});

describe("linking a spec into the builder", () => {
  it("names the spec by its address", () => {
    expect(linkToSpec("https://osf.io/x/study.json")).toContain(
      "spec=https%3A%2F%2Fosf.io%2Fx%2Fstudy.json",
    );
  });
});

describe("refusing a link that cannot work", () => {
  it("takes nothing but an https address, which is all the builder opens", () => {
    expect(() => linkToSpec("http://osf.io/study.json")).toThrow(
      "the spec has to be published over https",
    );
    expect(() => linkToSpec("javascript:alert(1)")).toThrow(
      "the spec has to be published over https",
    );
    expect(() => linkToSpec("not an address")).toThrow("is not an address");
  });
});

describe("how problems are read aloud", () => {
  it("says where a problem is, in the words the command line uses", () => {
    expect(
      spoken([{ message: "no good", severity: "error", path: [1, 0], place: "step 2, otherwise" }]),
    ).toBe("error: no good (step 2, otherwise)");
    expect(spoken([{ message: "mind this", severity: "warning" }])).toBe("warning: mind this");
  });
});

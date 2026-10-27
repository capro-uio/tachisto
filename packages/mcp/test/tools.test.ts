import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileSpecSource, INLINE, linkToSpec, spoken, validateSpecSource } from "../src/tools.ts";

const workspace = mkdtempSync(join(tmpdir(), "tachisto-mcp-"));

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

  it("names the call rather than a file when the spec was never one", () => {
    const answer = validateSpecSource({ spec: "{ not json" });
    expect(answer.failed).toBe(true);
    expect(answer.payload.spec).toBe(INLINE);
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
    const answer = await compileSpecSource({ spec: asText(runnable) }, out);
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
  it("counts a step from one, as a person would", () => {
    expect(spoken([{ message: "no good", severity: "error", path: [1, 0] }])).toBe(
      "error: no good (step 2.1)",
    );
    expect(spoken([{ message: "mind this", severity: "warning" }])).toBe("warning: mind this");
  });
});

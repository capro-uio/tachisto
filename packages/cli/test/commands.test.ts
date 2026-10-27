import { describe, expect, it } from "vitest";
import { loadBundle } from "@tachisto/schemas/bundle";
import type { Spec } from "@tachisto/compiler";
import { compile, specSchemaDocument, validate, type Files } from "../src/commands.ts";

const bundle = loadBundle();

/** Files that live only in this test, so a command can be run without touching a disk. */
function fakeFiles(contents: Record<string, string>) {
  const written = new Map<string, string>();
  const files: Files = {
    read: (path) => {
      const text = contents[path];
      if (text === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      return text;
    },
    write: (path, text) => void written.set(path, text),
  };
  return { files, written };
}

const spec = (spec: Spec) => fakeFiles({ "study.json": JSON.stringify(spec) });

const sound: Spec = {
  name: "beep",
  timeline: [
    { kind: "trial", plugin: "html-keyboard-response", params: { stimulus: "<p>hi</p>" } },
  ],
};

describe("validating a spec", () => {
  it("reports nothing wrong with a spec that compiles", () => {
    const { files } = spec(sound);
    expect(validate("study.json", files, bundle)).toEqual({
      command: "validate",
      status: "ok",
      problems: [],
      spec: "study.json",
      name: "beep",
    });
  });

  it("reports a warning without calling the spec invalid", () => {
    const { files } = spec({
      name: "drawing",
      timeline: [{ kind: "trial", plugin: "sketchpad", params: { show_finished_button: false } }],
    });
    const outcome = validate("study.json", files, bundle);
    expect(outcome.status).toBe("ok");
    expect(outcome.problems).toHaveLength(1);
    expect(outcome.problems[0].severity).toBe("warning");
  });

  it("calls a spec with nothing in it invalid, and says why", () => {
    const { files } = spec({ name: "empty", timeline: [] });
    const outcome = validate("study.json", files, bundle);
    expect(outcome.status).toBe("invalid");
    expect(outcome.problems.map((problem) => problem.message)).toContain(
      "the timeline has no steps",
    );
  });

  it("tells a missing file, a file that is not JSON and a file that is not a spec apart", () => {
    const { files } = fakeFiles({ "notes.json": "{ oh no", "list.json": "[1, 2, 3]" });
    expect(validate("gone.json", files, bundle).problems[0].message).toMatch(/ENOENT/);
    expect(validate("notes.json", files, bundle).problems[0].message).toMatch(/^not JSON: /);
    expect(validate("list.json", files, bundle).problems[0].message).toBe(
      "not a spec: it needs a name and a timeline",
    );
    // Both halves of that: a name with no timeline must not reach the validator either.
    const nameless = fakeFiles({ "half.json": '{"name":"half"}' });
    expect(nameless.files && validate("half.json", nameless.files, bundle)).toMatchObject({
      status: "unreadable",
    });
    // None of these reached the validator, so none of them says the experiment is wrong.
    for (const path of ["gone.json", "notes.json", "list.json"]) {
      expect(validate(path, files, bundle).status).toBe("unreadable");
    }
  });
});

describe("compiling a spec", () => {
  it("writes the page beside whoever ran the command, not beside the spec", async () => {
    const { files, written } = fakeFiles({ "deep/in/a/tree/study.json": JSON.stringify(sound) });
    const outcome = await compile("deep/in/a/tree/study.json", {}, files, bundle);
    expect(outcome).toMatchObject({
      command: "compile",
      status: "ok",
      spec: "deep/in/a/tree/study.json",
      output: "study.html",
      plugins: ["html-keyboard-response"],
    });
    expect([...written.keys()]).toEqual(["study.html"]);
    expect(written.get("study.html")).toContain("<html");
  });

  it("writes where it is told to", async () => {
    const { files, written } = spec(sound);
    await compile("study.json", { out: "out/page.html" }, files, bundle);
    expect([...written.keys()]).toEqual(["out/page.html"]);
  });

  it("writes nothing when the spec has errors", async () => {
    const { files, written } = spec({ name: "empty", timeline: [] });
    const outcome = await compile("study.json", {}, files, bundle);
    expect(outcome.status).toBe("invalid");
    expect(written.size).toBe(0);
  });
});

describe("the spec schema the release was built against", () => {
  it("is the published schema, as a document", () => {
    const schema = JSON.parse(specSchemaDocument()) as { $id: string; definitions: object };
    expect(schema.$id).toBe("https://www.capro.dev/tachisto/spec-schema.json");
    expect(Object.keys(schema.definitions).length).toBeGreaterThan(0);
  });
});

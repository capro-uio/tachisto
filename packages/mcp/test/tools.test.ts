import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compileSpecSource,
  INLINE,
  linkToSpec,
  spoken,
  validateSpecSource,
  withinRoot,
} from "../src/tools.ts";

const trees: string[] = [];
const temporary = (name: string) => {
  const made = mkdtempSync(join(tmpdir(), name));
  trees.push(made);
  return made;
};

const workspace = temporary("tachisto-mcp-");

// Whoever starts the server chooses where it may write; here that is this test.
beforeAll(() => {
  process.env.TACHISTO_MCP_ROOT = workspace;
});

afterAll(() => {
  for (const tree of trees) rmSync(tree, { recursive: true, force: true });
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
    mkdirSync(join(workspace, "out"), { recursive: true });
    const inside = withinRoot("out/study.html");
    expect("path" in inside && inside.path).toContain(join("out", "study.html"));
    expect(withinRoot("..")).toHaveProperty("problem");
    expect(withinRoot(".")).toHaveProperty("problem");
  });

  // Only the directory meant to hold a study is resolved, so it has to be one that is there.
  it("refuses a place to put a study that is not there", async () => {
    const answer = await compileSpecSource({ spec: asText(runnable) }, "no-such-place/study.html");
    expect(answer.failed).toBe(true);
    expect(answer.text).toContain("there is no no-such-place");
  });

  // The escape this guard exists to stop: a directory leading out of the root, with a study
  // written through it into somewhere the server was never given.
  it("refuses to write through a directory link that leads out of the root", async () => {
    const outside = temporary("tachisto-mcp-outside-");
    symlinkSync(outside, join(workspace, "away"), "dir");

    expect(withinRoot("away/study.html")).toHaveProperty("problem");
    const answer = await compileSpecSource({ spec: asText(runnable) }, "away/study.html");
    expect(answer.failed).toBe(true);
    expect(answer.text).toContain("leads outside");
    expect(existsSync(join(outside, "study.html"))).toBe(false);
  });

  // A directory link that stays inside is a place in the root like any other, and asking the
  // holder where it really is tells the two apart without guessing where a name would lead.
  it("still writes through a directory link that stays inside the root", async () => {
    mkdirSync(join(workspace, "studies"), { recursive: true });
    symlinkSync(join(workspace, "studies"), join(workspace, "shortcut"), "dir");

    const answer = await compileSpecSource({ spec: asText(runnable) }, "shortcut/s.html");
    expect(answer.failed).toBe(false);
    expect(readFileSync(join(workspace, "studies", "s.html"), "utf8")).toContain("<html");
  });

  // A link at the end is refused wherever it leads. Following one writes somewhere other than
  // the name that was given, and telling inside from outside would mean predicting the kernel's
  // walk — which is the prediction every escape so far came from.
  it("refuses a link standing where the study would go, out of the root or in it", () => {
    const outside = temporary("tachisto-mcp-outside-");
    symlinkSync(join(outside, "taken.html"), join(workspace, "dangling.html"), "file");
    symlinkSync(join(workspace, "studies", "later.html"), join(workspace, "inside.html"), "file");
    symlinkSync(workspace, join(workspace, "self"), "dir");

    for (const name of ["dangling.html", "inside.html", "self"]) {
      const refusal = withinRoot(name);
      expect(refusal).toHaveProperty("problem");
      expect("problem" in refusal && refusal.problem).toContain("is a link");
    }
    expect(existsSync(join(outside, "taken.html"))).toBe(false);
    expect(existsSync(join(workspace, "studies", "later.html"))).toBe(false);
  });

  // A ring of links needed a budget to get out of while they were being followed. Nothing
  // follows one now, so there is nothing to get out of.
  it("refuses a ring of links without following it", () => {
    symlinkSync(join(workspace, "ring-b"), join(workspace, "ring-a"), "file");
    symlinkSync(join(workspace, "ring-a"), join(workspace, "ring-b"), "file");

    const ring = withinRoot("ring-a");
    expect(ring).toHaveProperty("problem");
    expect("problem" in ring && ring.problem).toContain("is a link");
  });

  // No path tells a hard link apart from the file it shares, so the name is replaced rather
  // than written through, and whatever else points at that file keeps it.
  it("leaves a file outside the root alone when a hard link to it stands in the way", async () => {
    const outside = temporary("tachisto-mcp-outside-");
    const kept = join(outside, "notes.txt");
    writeFileSync(kept, "not a study");
    linkSync(kept, join(workspace, "linked.html"));

    const answer = await compileSpecSource({ spec: asText(runnable) }, "linked.html");
    expect(answer.failed).toBe(false);
    expect(readFileSync(kept, "utf8")).toBe("not a study");
    expect(readFileSync(join(workspace, "linked.html"), "utf8")).toContain("<html");
  });

  it("leaves nothing behind when the study cannot be written", async () => {
    mkdirSync(join(workspace, "occupied.html"), { recursive: true });
    const answer = await compileSpecSource({ spec: asText(runnable) }, "occupied.html");
    expect(answer.failed).toBe(true);
    expect(readdirSync(workspace).filter((name) => name.endsWith(".part"))).toEqual([]);
  });

  // The divergence that used to be held down by a comment: `..` in a link's target collapsed
  // one way here and walked another by the kernel. Refusing the link removes the question
  // rather than answering it carefully. See #138.
  it("refuses a link whose target walks out of the root and back in", async () => {
    const outside = temporary("tachisto-mcp-outside-");
    mkdirSync(join(outside, "sub"), { recursive: true });
    mkdirSync(join(outside, "in"), { recursive: true });
    mkdirSync(join(workspace, "in"), { recursive: true });
    symlinkSync(join(outside, "sub"), join(workspace, "d"), "dir");
    symlinkSync("d/../in/crooked.html", join(workspace, "crooked.html"), "file");

    const answer = await compileSpecSource({ spec: asText(runnable) }, "crooked.html");
    expect(answer.failed).toBe(true);
    expect(answer.text).toContain("is a link");
    expect(existsSync(join(workspace, "in", "crooked.html"))).toBe(false);
    expect(existsSync(join(outside, "in", "crooked.html"))).toBe(false);
  });

  it("refuses to read a spec through one too", () => {
    const outside = temporary("tachisto-mcp-outside-");
    writeFileSync(join(outside, "study.json"), asText(runnable));
    symlinkSync(join(outside, "study.json"), join(workspace, "linked.json"), "file");

    const answer = validateSpecSource({ path: "linked.json" });
    expect(answer.failed).toBe(true);
    expect(answer.text).toContain("There is no spec to check at linked.json");
    expect(spoken(answer.payload.problems)).toContain("is a link");
  });

  it("falls back to a name of its own when none is given", async () => {
    const answer = await compileSpecSource({ spec: asText(runnable) });
    expect(answer.failed).toBe(false);
    expect(answer.payload.output).toContain("experiment.html");
    expect(readFileSync(join(workspace, "experiment.html"), "utf8")).toContain("<html");
  });
});

// A client's config can name a directory before anyone has made it, and every call then has to
// say so rather than throwing the host's filesystem error back through the protocol.
describe("a root the server cannot use", () => {
  it("answers that the root is wrong instead of failing to answer", async () => {
    const absent = join(workspace, "never-made");
    process.env.TACHISTO_MCP_ROOT = absent;
    try {
      expect(withinRoot("study.html")).toHaveProperty("problem");
      const answer = await compileSpecSource({ spec: asText(runnable) }, "study.html");
      expect(answer.failed).toBe(true);
      expect(answer.text).toContain("is not a directory this server can read and write");
    } finally {
      process.env.TACHISTO_MCP_ROOT = workspace;
    }
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

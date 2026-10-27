import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.ts";

describe("what the command line accepts", () => {
  it("reads a command and its spec", () => {
    expect(parseArgs(["validate", "flanker.json"])).toEqual({
      command: "validate",
      specPath: "flanker.json",
      options: { json: false },
    });
  });

  it("reads the options a compile takes, in any order", () => {
    expect(
      parseArgs(["compile", "--json", "--out", "study.html", "s.json", "--base", "./lib"]),
    ).toEqual({
      command: "compile",
      specPath: "s.json",
      options: { json: true, out: "study.html", base: "./lib" },
    });
  });

  it("parses the schema command and where to put it", () => {
    expect(parseArgs(["schema"])).toEqual({ command: "schema", options: { json: false } });
    expect(parseArgs(["schema", "--out", "s.json"])).toEqual({
      command: "schema",
      options: { json: false, out: "s.json" },
    });
  });

  it("offers help when asked, and when asked for nothing", () => {
    expect(parseArgs([])).toEqual({ command: "help" });
    expect(parseArgs(["--help"])).toEqual({ command: "help" });
    expect(parseArgs(["-h"])).toEqual({ command: "help" });
  });

  it("says what it could not read rather than guessing", () => {
    expect(parseArgs(["build", "s.json"])).toEqual({
      command: "unreadable",
      message: 'unknown command "build"',
    });
    expect(parseArgs(["validate"])).toEqual({
      command: "unreadable",
      message: "validate needs a spec file",
    });
    expect(parseArgs(["validate", "a.json", "b.json"])).toEqual({
      command: "unreadable",
      message: "validate takes one spec file, got 2",
    });
    expect(parseArgs(["validate", "s.json", "--quiet"])).toEqual({
      command: "unreadable",
      message: 'unknown option "--quiet"',
    });
    expect(parseArgs(["validate", "s.json", "--json=yes"])).toEqual({
      command: "unreadable",
      message: "--json takes no value",
    });
    expect(parseArgs(["schema", "--json"])).toEqual({
      command: "unreadable",
      message: "schema does not take --json; its answer is JSON already",
    });
    // A single dash read as a file name hides the mistake until the open fails.
    expect(parseArgs(["validate", "-h"])).toEqual({
      command: "unreadable",
      message: 'unknown option "-h"',
    });
    expect(parseArgs(["schema", "s.json"])).toEqual({
      command: "unreadable",
      message: 'schema takes no spec file, got "s.json"',
    });
  });

  it("takes an option's value attached to it as well as after it", () => {
    expect(parseArgs(["compile", "s.json", "--out=study.html", "--base=./lib"])).toEqual({
      command: "compile",
      specPath: "s.json",
      options: { json: false, out: "study.html", base: "./lib" },
    });
    expect(parseArgs(["compile", "s.json", "--out="])).toEqual({
      command: "unreadable",
      message: "--out needs a value",
    });
  });

  // Without this, `--out --json` would write a file called --json and swallow the flag.
  it("refuses an option whose value is missing or is another option", () => {
    const missing = "--out needs a value";
    expect(parseArgs(["compile", "s.json", "--out"])).toEqual({
      command: "unreadable",
      message: missing,
    });
    expect(parseArgs(["compile", "s.json", "--out", "--json"])).toEqual({
      command: "unreadable",
      message: missing,
    });
  });
});

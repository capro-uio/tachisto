import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Pinned so a test can know the name the write is about to use, which is the only way to plant
// anything there; nothing but a test can guess it.
const PINNED = "pinned-for-this-test";
vi.mock("node:crypto", async (original) => ({
  ...(await original<typeof import("node:crypto")>()),
  randomUUID: () => PINNED,
}));

const { confinedFiles } = await import("../src/tools.ts");

const trees: string[] = [];
const temporary = (name: string) => {
  const made = mkdtempSync(join(tmpdir(), name));
  trees.push(made);
  return made;
};

const workspace = temporary("tachisto-mcp-writing-");
const partName = `.tachisto-${PINNED}.part`;

beforeAll(() => {
  process.env.TACHISTO_MCP_ROOT = workspace;
});

afterAll(() => {
  for (const tree of trees) rmSync(tree, { recursive: true, force: true });
});

describe("the name a study is written under before it is moved into place", () => {
  it("is not the one the caller asked for, and not one that can be guessed", () => {
    expect(randomUUID()).toBe(PINNED);
    expect(partName).not.toContain("experiment");
  });

  // The name is new, so nothing above it can vouch for it the way the guard vouches for the
  // study's own path: it has to refuse what is already there rather than write through it.
  it("refuses to follow a link already sitting at it", () => {
    const outside = temporary("tachisto-mcp-writing-outside-");
    const kept = join(outside, "victim.txt");
    writeFileSync(kept, "not a study");
    symlinkSync(kept, join(workspace, partName), "file");

    expect(() => confinedFiles().write("experiment.html", "<html>a study</html>")).toThrow();
    expect(readFileSync(kept, "utf8")).toBe("not a study");
    rmSync(join(workspace, partName), { force: true });
  });

  it("is cleared away when the move cannot happen", () => {
    // A directory already standing where the study would go: the part file is written, and then
    // the move fails — which is the only way to reach the clearing up.
    mkdirSync(join(workspace, "occupied.html"), { recursive: true });
    expect(() => confinedFiles().write("occupied.html", "<html>a study</html>")).toThrow();
    expect(readdirSync(workspace).filter((name) => name.endsWith(".part"))).toEqual([]);
  });
});

describe("what a study inherits from the one it replaces", () => {
  it("keeps the reach of the file it is written over, rather than widening it", () => {
    const close = join(workspace, "close.html");
    writeFileSync(close, "<html>first</html>");
    chmodSync(close, 0o600);

    confinedFiles().write("close.html", "<html>second</html>");

    expect(statSync(close).mode & 0o777).toBe(0o600);
    expect(readFileSync(close, "utf8")).toContain("second");
  });

  it("leaves a study written where there was none at the usual reach", () => {
    confinedFiles().write("fresh.html", "<html>a study</html>");
    expect(statSync(join(workspace, "fresh.html")).mode & 0o777).not.toBe(0o600);
  });
});

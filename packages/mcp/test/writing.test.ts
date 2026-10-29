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

    // Read before asking after it, so this is not a question followed by a use of the answer.
    const written = readFileSync(close, "utf8");
    const reach = statSync(close).mode & 0o777;
    expect(written).toContain("second");
    expect(reach).toBe(0o600);
  });

  it("leaves a study written where there was none at the usual reach", () => {
    confinedFiles().write("fresh.html", "<html>a study</html>");
    const usual = statSync(join(workspace, "fresh.html")).mode & 0o777;
    expect(usual).not.toBe(0o600);
    expect(usual & 0o111).toBe(0);
  });

  // Lending works one way only. A study left open to everyone does not keep a later one open.
  it("does not lend a reach wider than a study written where there was none", () => {
    const open = join(workspace, "open.html");
    writeFileSync(open, "<html>first</html>");
    chmodSync(open, 0o666);

    confinedFiles().write("open.html", "<html>second</html>");

    const usual = statSync(join(workspace, "fresh.html")).mode & 0o777;
    expect(statSync(open).mode & 0o777).toBe(usual);
  });

  it("lends nothing but the reading and writing of it", () => {
    const marked = join(workspace, "marked.html");
    writeFileSync(marked, "<html>first</html>");
    chmodSync(marked, 0o2755);

    confinedFiles().write("marked.html", "<html>second</html>");

    // The set-group-id bit would otherwise travel onto a file now owned by whoever served it.
    expect(statSync(marked).mode & 0o7000).toBe(0);
    expect(statSync(marked).mode & 0o111).toBe(0);
  });
});

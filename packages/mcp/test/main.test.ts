import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { usageText, wantsHelp } from "../src/usage.ts";

const root = mkdtempSync(join(tmpdir(), "tachisto-mcp-usage-"));

beforeAll(() => {
  process.env.TACHISTO_MCP_ROOT = root;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the words the server answers --help with", () => {
  it("says what it is and how a client starts it", () => {
    const said = usageText();
    expect(said).toContain("over MCP on stdio");
    expect(said).toContain("mcpServers");
    expect(said).toContain("validate_spec, compile_spec, builder_link");
  });

  // The one thing a person running it by hand most needs to know is where it may write.
  it("names the directory it is confined to", () => {
    expect(usageText()).toContain(root);
  });
});

describe("when the server explains itself instead of serving", () => {
  it("takes either spelling of the flag, and nothing else", () => {
    expect(wantsHelp(["--help"])).toBe(true);
    expect(wantsHelp(["-h"])).toBe(true);
    expect(wantsHelp([])).toBe(false);
    expect(wantsHelp(["--version"])).toBe(false);
  });
});

describe("running the built server by hand", () => {
  // Started without a client it would sit silently; this is the whole reason --help exists.
  it("prints the usage and exits rather than waiting", () => {
    const said = execFileSync(
      process.execPath,
      [fileURLToPath(new URL("../src/main.ts", import.meta.url)), "--help"],
      { encoding: "utf8", env: { ...process.env, TACHISTO_MCP_ROOT: root }, timeout: 10_000 },
    );
    expect(said).toContain("tachisto-mcp");
    expect(said).toContain(root);
  });
});

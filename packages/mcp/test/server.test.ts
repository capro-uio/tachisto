import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { tachistoServer } from "../src/server.ts";

let client: Client;

const runnable = JSON.stringify({
  name: "beep",
  timeline: [
    { kind: "trial", plugin: "html-keyboard-response", params: { stimulus: "<p>hi</p>" } },
  ],
});

interface Reply {
  content: { type: string; text: string }[];
  isError?: boolean;
}

const call = (name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args }) as Promise<Reply>;

const workspace = mkdtempSync(join(tmpdir(), "tachisto-mcp-server-"));

beforeAll(async () => {
  process.env.TACHISTO_MCP_ROOT = workspace;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "a test", version: "0" });
  await Promise.all([tachistoServer().connect(serverSide), client.connect(clientSide)]);
});

describe("what the server offers", () => {
  it("offers validating, compiling and linking, and says what a spec is", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "builder_link",
      "compile_spec",
      "validate_spec",
    ]);
    // An agent has to learn the format from somewhere, so every description names the schema.
    for (const tool of tools.filter((tool) => tool.name.endsWith("_spec"))) {
      expect(tool.description, tool.name).toContain("spec-schema.json");
    }
  });

  it("takes a spec whole and answers in words and in JSON", async () => {
    const reply = await call("validate_spec", { spec: runnable });
    expect(reply.isError).toBeFalsy();
    expect(reply.content[0].text).toContain("will run");
    expect(JSON.parse(reply.content[1].text)).toMatchObject({ ok: true, name: "beep" });
  });

  it("marks a spec that will not run as an error, so a caller cannot miss it", async () => {
    const reply = await call("validate_spec", {
      spec: JSON.stringify({ name: "empty", timeline: [] }),
    });
    expect(reply.isError).toBe(true);
    expect(JSON.parse(reply.content[1].text)).toMatchObject({ ok: false });
  });

  it("compiles a study and reports the file it wrote", async () => {
    const reply = await call("compile_spec", { spec: runnable, out: "study.html" });
    expect(reply.isError).toBeFalsy();
    expect(readFileSync(join(workspace, "study.html"), "utf8")).toContain("<html");
    expect(JSON.parse(reply.content[1].text)).toMatchObject({ ok: true, command: "compile" });
  });

  it("marks a compile it refused, rather than failing the call", async () => {
    const reply = await call("compile_spec", { spec: runnable, out: "../escaped.html" });
    expect(reply.isError).toBe(true);
    expect(reply.content[0].text).toContain("is outside");
  });

  it("marks a link it cannot build, rather than failing the call", async () => {
    const reply = await call("builder_link", { spec_url: "http://osf.io/x/study.json" });
    expect(reply.isError).toBe(true);
    expect(reply.content[0].text).toContain("https");
  });

  it("builds a link to the published builder", async () => {
    const reply = await call("builder_link", { spec_url: "https://osf.io/x/study.json" });
    expect(reply.content[0].text).toBe(
      "https://www.capro.dev/tachisto/app/?spec=https%3A%2F%2Fosf.io%2Fx%2Fstudy.json",
    );
  });
});

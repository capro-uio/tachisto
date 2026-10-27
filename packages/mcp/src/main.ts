#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { rootDirectory } from "./tools.ts";
import { tachistoServer } from "./server.ts";

const USAGE = `tachisto-mcp — builds Tachisto experiments for an agent, over MCP on stdio.

It is started by an MCP client rather than by hand:

  { "mcpServers": { "tachisto": { "command": "npx", "args": ["-y", "@tachisto/mcp"] } } }

Tools: validate_spec, compile_spec, builder_link.
Reads and writes only inside ${rootDirectory()} (set TACHISTO_MCP_ROOT to choose).`;

// Run by hand, it would otherwise sit silently waiting for a client that is not there.
if (process.argv.slice(2).some((arg) => arg === "--help" || arg === "-h")) {
  process.stdout.write(`${USAGE}\n`);
} else {
  await tachistoServer().connect(new StdioServerTransport());
}

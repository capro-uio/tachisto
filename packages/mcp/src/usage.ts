import { rootDirectory } from "./tools.ts";

/** What a person who ran the server by hand needs to know, chiefly that a client starts it. */
export const usageText = () =>
  `tachisto-mcp — builds Tachisto experiments for an agent, over MCP on stdio.

It is started by an MCP client rather than by hand:

  { "mcpServers": { "tachisto": { "command": "npx", "args": ["-y", "@tachisto/mcp"] } } }

Tools: validate_spec, compile_spec, builder_link.
Reads and writes only inside ${rootDirectory()} (set TACHISTO_MCP_ROOT to choose).`;

/** Run by hand, the server would otherwise wait silently for a client that is not coming. */
export const wantsHelp = (args: readonly string[]) =>
  args.some((arg) => arg === "--help" || arg === "-h");

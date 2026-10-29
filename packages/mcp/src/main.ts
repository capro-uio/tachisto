#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tachistoServer } from "./server.ts";
import { usageText, wantsHelp } from "./usage.ts";

if (wantsHelp(process.argv.slice(2))) {
  process.stdout.write(`${usageText()}\n`);
} else {
  await tachistoServer().connect(new StdioServerTransport());
}

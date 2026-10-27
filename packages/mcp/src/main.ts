#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tachistoServer } from "./server.ts";

await tachistoServer().connect(new StdioServerTransport());

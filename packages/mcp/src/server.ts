import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SPEC_SCHEMA_ID } from "@tachisto/compiler";
import manifest from "../package.json" with { type: "json" };
import { compileSpecSource, linkToSpec, validateSpecSource, type Answer } from "./tools.ts";

const SOURCE = {
  spec: z.string().optional().describe("The spec itself, as JSON. Give this or path, not both."),
  path: z.string().optional().describe("A spec file to read instead of giving one here."),
};

const SPEC_HELP =
  `A spec is one JSON document describing a whole study; its schema is published at ` +
  `${SPEC_SCHEMA_ID}, and every step's parameters come from the jsPsych plugin it uses.`;

/** The words a tool answers with, plus its payload, which is what a program should read. */
const replyOf = (answer: Answer) => ({
  content: [
    { type: "text" as const, text: answer.text },
    { type: "text" as const, text: JSON.stringify(answer.payload, null, 2) },
  ],
  isError: answer.failed,
});

/** Everything the server offers, registered on a server a caller can then connect however. */
export function tachistoServer() {
  const server = new McpServer({ name: "tachisto", version: manifest.version });

  server.registerTool(
    "validate_spec",
    {
      title: "Validate a Tachisto spec",
      description:
        `Checks whether a spec describes a study that will run, and reports every problem with ` +
        `it: errors that stop it, and warnings worth reading. Use this before compiling, and ` +
        `after writing or changing a spec. ${SPEC_HELP}`,
      inputSchema: SOURCE,
    },
    (source) => replyOf(validateSpecSource(source)),
  );

  server.registerTool(
    "compile_spec",
    {
      title: "Compile a Tachisto spec",
      description:
        `Compiles a spec into one HTML file that runs the study in a browser and can be hosted ` +
        `anywhere. Reports the same problems as validate_spec, and writes nothing when the spec ` +
        `has errors. ${SPEC_HELP}`,
      inputSchema: {
        ...SOURCE,
        out: z
          .string()
          .optional()
          .describe(
            "Where to write the HTML, within the directory this server was started in (or " +
              "TACHISTO_MCP_ROOT). Defaults beside the spec when a path was given.",
          ),
      },
    },
    async ({ out, ...source }) => replyOf(await compileSpecSource(source, out)),
  );

  server.registerTool(
    "builder_link",
    {
      title: "Link a spec into the builder",
      description:
        "Builds a link that opens a spec in Tachisto's builder, where a person can look through " +
        "the timeline, edit it and preview it. The spec has to be reachable at an https address " +
        "already; the link names it rather than carrying it. Following the link asks before it " +
        "opens anything.",
      inputSchema: {
        spec_url: z.string().describe("The https address the spec is published at."),
      },
    },
    ({ spec_url: specUrl }) => {
      // Answered, not thrown: a caller can correct a bad address, but not a protocol error.
      try {
        return { content: [{ type: "text" as const, text: linkToSpec(specUrl) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: (error as Error).message }],
          isError: true,
        };
      }
    },
  );

  return server;
}

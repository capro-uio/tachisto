# @tachisto/mcp

An [MCP](https://modelcontextprotocol.io) server for building
[Tachisto](https://www.capro.dev/tachisto/) experiments: an agent writes a spec — one JSON document
describing a whole behavioural study — and checks its work where it works.

```json
{ "mcpServers": { "tachisto": { "command": "npx", "args": ["-y", "@tachisto/mcp"] } } }
```

| Tool            | What it does                                                                    |
| --------------- | ------------------------------------------------------------------------------- |
| `validate_spec` | Whether a spec describes a study that will run, and every problem with it       |
| `compile_spec`  | Writes the study as one HTML file; writes nothing when the spec has errors      |
| `builder_link`  | A link that opens a published spec in the builder, for a person to look through |

Both spec tools take the spec whole (`spec`) or a file to read (`path`), and answer in words and as
the same JSON envelope `@tachisto/cli` prints. A spec that will not run comes back as an error, so
a caller cannot read past it.

Files are read and written inside the directory the server was started in, or inside
`TACHISTO_MCP_ROOT` when that is set. A spec can be authored by anyone — including whatever an
agent was reading when it decided to call this — and neither it nor the agent should be able to
choose which files on the machine are touched.

The spec format is published as JSON Schema at <https://www.capro.dev/tachisto/spec-schema.json>,
which every tool's description names. Nothing here installs a jsPsych plugin.

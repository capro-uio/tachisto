# @tachisto/cli

Validate and compile [Tachisto](https://www.capro.dev/tachisto/) experiment specs — one JSON
document describing a whole behavioural study — into a single HTML file that runs the study in a
browser and can be hosted anywhere.

```sh
npx @tachisto/cli validate study.json   # is this a study that will run?
npx @tachisto/cli compile study.json    # write study.html, ready to host
npx @tachisto/cli schema                # the spec schema this release was built against
```

Exit status: `0` nothing wrong, `1` the spec has errors, `2` the command could not be read,
`70` a fault inside Tachisto. Warnings never fail a command.

`--json` answers with one envelope instead of lines, so a program reads the problems rather than
parsing prose:

```json
{
  "tachisto": "0.0.2",
  "jspsych": "8.3.0",
  "command": "validate",
  "ok": false,
  "spec": "study.json",
  "name": "my-experiment",
  "problems": [{ "message": "the timeline has no steps", "severity": "error" }]
}
```

The spec format is published as JSON Schema at <https://www.capro.dev/tachisto/spec-schema.json>;
name it in a spec's `$schema` and an editor will complete and check the spec as it is written.
Nothing here installs a jsPsych plugin.

For an agent rather than a shell, see `@tachisto/mcp`.

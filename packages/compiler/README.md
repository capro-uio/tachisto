# @tachisto/compiler

Compiles a declarative Tachisto spec — one JSON document describing a whole behavioural study —
into readable [jsPsych](https://www.jspsych.org) source and a single HTML file that runs in a
browser and can be hosted anywhere.

```js
import { compileSpec, emitHtml, validateSpec } from "@tachisto/compiler";
import { loadBundle } from "@tachisto/schemas/bundle";

const bundle = loadBundle();
validateSpec(spec, bundle.plugins); // throws on anything that would not run
const { html } = await emitHtml(compileSpec(spec, bundle), { title: spec.name, base: "cdn" });
```

The spec format is published as JSON Schema at
<https://www.capro.dev/tachisto/spec-schema.json>, and ships here as `spec-schema.json`.

For a command line rather than an API, see `@tachisto/cli`.

Part of [Tachisto](https://www.capro.dev/tachisto/), a no-code builder for jsPsych experiments.

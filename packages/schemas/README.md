# @tachisto/schemas

JSON Schema for every [jsPsych](https://www.jspsych.org) plugin, extracted from each plugin's own
`info.parameters` and the JSDoc in its shipped type declarations — so a form or an editor can
describe the whole plugin ecosystem without anyone hand-writing it.

```js
import { loadBundle } from "@tachisto/schemas/bundle";

const { jspsych, plugins } = loadBundle();
plugins["html-keyboard-response"].properties.stimulus; // title, description, type, examples
```

The schemas ship with the package, so nothing here installs a jsPsych plugin. Extraction itself is
a maintainer's job and is not published.

Part of [Tachisto](https://www.capro.dev/tachisto/), a no-code builder for jsPsych experiments.

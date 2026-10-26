# Tachisto

[![CI](https://github.com/capro-uio/tachisto/actions/workflows/ci.yml/badge.svg)](https://github.com/capro-uio/tachisto/actions/workflows/ci.yml)
[![Built with Claude](https://img.shields.io/badge/built%20with-Claude-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23669791.svg)](https://doi.org/10.5281/zenodo.23669791)

A no-code builder for [jsPsych](https://www.jspsych.org) experiments. Researchers assemble a study
in a UI; the tool compiles it to readable, correct jsPsych source they can host anywhere.

**Status: early.** You can build a flanker task end to end in the browser — nested timeline,
conditions table generated from a design, generated parameter forms (questionnaire items
included), rich stimulus text, image and sound files, group assignment and branching on
performance or on an answer, a psychophysics canvas step whose objects you drag into place, live
preview of the whole experiment or a single step, a choice of where results go, a guided tour of the
builder, and export to a single HTML file or a zipped project. Participants recruited on Prolific,
SONA or CloudResearch Connect are identified by the platform's id and sent back to it when done.
Tasks can run in a counterbalanced order. There is no hosting or consent flow yet. Every export names the
version that built it.

**Try it:** <https://www.capro.dev/tachisto/app/> — nothing to install, and the examples
open a working experiment in one click. The website at <https://www.capro.dev/tachisto/> explains
what it does.

Tachisto is named after the tachistoscope, the lab instrument that showed a stimulus for an exact
number of milliseconds. Its first release was called jsPsych Studio.

## Why

jsPsych requires JavaScript, which most psychologists do not write. The alternatives are
pay-per-participant platforms or a Python toolchain with a lossy JavaScript export. More
importantly, hand-written jsPsych fails _silently_: the published community flanker timeline
renders one stimulus for every condition because it reads timeline variables the wrong way, with no
console error. A compiler encodes those rules once.

The design rests on one observation: jsPsych plugins describe their own parameters at runtime, and
the JSDoc for each parameter survives in the published type declarations — so the form UI for the
whole plugin ecosystem can be generated instead of hand-written, which is what makes this
maintainable by a small team.

## Packages

| Package              | What it does                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@tachisto/schemas`  | Turns every plugin's `info.parameters` plus the JSDoc in its shipped `.d.ts` into JSON Schema, so the builder's forms are generated rather than hand-written |
| `@tachisto/compiler` | Compiles a declarative spec to jsPsych source and emits an HTML experiment                                                                                   |
| `@tachisto/brand`    | Colours, type, logos and the brand book (`packages/brand/BRAND.md`), shared by the builder and the website                                                   |

The builder lives in `apps/builder`, and the website that introduces it in `apps/site`.

## Use

```sh
npm install
npm run dev              # the builder at http://localhost:5180
npm run dev:site         # the website at http://localhost:5181
npm run build:pages      # the website, with the builder under app/, in dist-pages/ as Pages serves it
npm test                 # unit tests plus two real-browser end-to-end runs
npm run coverage         # the same, reporting coverage of the compiler, schemas and builder logic
npm run typecheck
npm run schemas          # regenerate packages/schemas/plugin-schemas.json, print coverage
npm run spec-schema      # regenerate packages/compiler/spec-schema.json
node packages/compiler/src/cli.ts compile examples/flanker.json
```

The acceptance test for the UI builds `examples/flanker.json` by clicking through the app and
asserts the authored spec matches the reference file, then checks the preview actually runs.

`examples/flanker.json` is the reference spec: instructions, then a practice block over a
four-row conditions table, randomised, twice through, scored against a correct-key column, repeating
while cumulative accuracy stays below 0.75.

`examples/shapes.json` is the image example: four PNGs (blue and orange squares and circles) carried
in the spec as data URLs, named from a conditions column, preloaded, and judged on shape while
colour is recorded but irrelevant.

`examples/stroop.json` is the checkpoint example: a colour-word Stroop with a fixation cross before
each word, congruency and ink colour recorded on every trial, and a checkpoint after the
instructions.

## Counterbalancing the order of tasks

A `counterbalance` step runs every one of its tasks for every participant, in an order that
differs between participants, and records the order used on every row (as `"stroop > flanker"`,
in the column `order` unless `record_as` names another). A task holds any steps, such as
instructions and a block over its own conditions table:

```json
{
  "kind": "counterbalance",
  "method": "latin_square",
  "tasks": [
    {
      "name": "flanker",
      "children": [{ "kind": "block", "conditions": "flanker", "children": [] }]
    },
    { "name": "stroop", "children": [{ "kind": "block", "conditions": "stroop", "children": [] }] }
  ]
}
```

The blocks' own steps are left out here for brevity.

`"random"` shuffles the tasks in the browser. `"latin_square"` uses a balanced Latin square, where
every task takes every position equally often and follows every other task equally often. It needs
a participant count, so it asks the data service for the next condition the way balanced groups
do, and only works with `"save": "post"`. With data downloaded, only random order is available.
Set the experiment's number of conditions on DataPipe to the number of orders the builder shows:
as many as there are tasks, or twice that for an odd number of tasks.

## When DataPipe hands out no condition

Balanced groups and Latin-square orders ask DataPipe for each participant's condition. If no usable
condition comes back, because DataPipe cannot be reached or refuses the request, the study stops
and tells the participant, rather than guess: a participant run in a guessed condition looks like a
good session until someone reads the data, which is DataPipe's own advice. A study that saves at the
end uploads nothing, since it never reaches its end; one that saves as it goes uploads the rows
recorded so far, as it does whenever a study stops.

A study can instead draw the group or order in the browser and keep going, at the risk of
unbalanced groups, and nothing in the data says which participants were drawn that way:

```json
"data": { "save": "post", "experiment_id": "abc123DEF456", "condition_fallback": "random" }
```

`"stop"` is the default, including for a project saved before the choice existed, which used to
draw in the browser without saying so. The builder asks in the Study tab's Data section, once a
step asks DataPipe for a condition.

## Setting up DataPipe

When a study uploads to DataPipe, the Data section of the builder's Study tab has a "Set up
DataPipe" checklist, and a project download carries the same one as `DATAPIPE-SETUP.md`. It follows
DataPipe's own order, filled in from the study, with a copy button for each value:

1. **Create the experiment:** where DataPipe can store the data (Google Drive, Dataverse or Zenodo;
   OSF takes no new experiments), and the title, authors, their affiliations and description.
2. **On its dashboard:** each setting under DataPipe's label: base64 uploads on only for a study
   that records sound or video; condition assignment on, with the number of conditions, only for a
   study with balanced groups or a Latin square; a session limit, on at the study's planned
   `sample_size` and optional when it gives none; submission checks
   allowing CSV and requiring the columns every upload has (`trial_type`, `trial_index`,
   `time_elapsed` and `participant_id`); and Psych-DS metadata, which DataPipe locks once any data
   arrives, a pilot included.
3. **Paste the experiment ID:** the checklist ends just above the field it goes in.

## Saving data as it goes

A study that uploads its data sends it all to [DataPipe](https://pipe.jspsych.org) once, at the
end, gzipped. `endpoint` points it at a DataPipe you host yourself instead of pipe.jspsych.org:
an `https://` address, which may include a path such as `https://example.org/datapipe`, or
`http://` only for `localhost`, `127.0.0.1` or `[::1]` while testing. It cannot hold a login, a
`?` or a `#`, since the study adds DataPipe's own routes after it.
With `"stream": true` it also sends each step's row as soon as it is recorded, through jsPsych's
[DataPipe extension](https://www.jspsych.org/latest/extensions/pipe), so a participant who closes
the page partway still leaves a partial file (`.partial.json`) on DataPipe:

```json
"data": { "save": "post", "experiment_id": "abc123DEF456", "stream": true }
```

It is off unless asked for. A participant who withdraws by closing the page leaves their partial
data behind, recordings included, so the consent form has to say that data from an unfinished
session is kept. Rows already sent cannot be called back, so a study that saves as it goes cannot
have an ending that keeps less than everything. The full upload at the end still falls back to a
download if it fails, and a participant is only sent back to a platform once it has arrived. The
extension carries Firebase, about 240 KB. Firebase holds text that would end a `<script>` element,
so a single-file download carries the extension base64-encoded in a `data:` URL, about 320 KB,
which the browser checks against the extension's recorded hash before running it. A host whose
Content-Security-Policy blocks `data:` scripts needs the project folder instead. The builder's
preview never loads it.

## Recruiting from a platform

Prolific, SONA and CloudResearch Connect all pass the participant's id in the study URL and expect
the participant to come back to a URL they give you. `recruitment` names the parameter the id
arrives in, and where to send the participant once their data is saved:

```json
"recruitment": {
  "platform": "prolific",
  "id_param": "PROLIFIC_PID",
  "endings": {
    "complete": { "url": "https://app.prolific.com/submissions/complete?cc=C1A2B3" }
  }
}
```

The id becomes `participant_id` on every row, alongside every other URL parameter. A parameter
named like a column the study writes itself, such as `?correct=1` or `?stimulus=…`, is recorded as
`url_correct` or `url_stimulus` instead, so a link cannot change a participant's data. The
exported project's `dataset_description.json` lists the parameters each platform sends by default
(Prolific's `STUDY_ID` and `SESSION_ID`, Connect's `assignmentId` and `projectId`) among the
dataset's columns; a parameter a link adds beyond those is recorded but not described. Write
`{participant_id}` in the address where the platform expects the id back, as SONA's credit URL
does. The redirect happens only after the upload succeeds, so it needs `"save": "post"`. If the
upload fails, the data is downloaded and the participant gets a link back to the platform once they
have the file. The builder's Study tab fills in each platform's parameter, and its preview never
redirects.

## Recording sound and video

The steps that record, _Text, answered aloud_ and _Text, answered on camera_, need a _Set up the
microphone_ or _Set up the camera_ step before them, and the validator says so if one is missing.
jsPsych keeps a recording as base64 text in the row, megabytes of it for a few seconds of video, so
a study that saves its data saves each recording as a file of its own instead, named after the
participant and the trial, and the row's `response` holds that name. Uploads go to DataPipe's
`/api/base64/`, which has to be switched on for the experiment in DataPipe; a recording that
cannot be uploaded stays inside the data as text, and the rest is uploaded as usual. Recordings are
only sent when the data is, so an ending that keeps nothing sends none. A study that downloads its
data keeps the recordings inside the one file, since a download has no size limit and a browser
may refuse several at once.

A participant who refuses the camera or microphone stays on its set-up step: jsPsych's plugins
wait for permission, so say in the study's instructions that it is needed.

The preview cannot reach a camera or microphone: browsers give none to a sandboxed frame without an
origin of its own, which is what keeps study code away from the builder. Download the experiment to
try those steps.

## Eye tracking

Eye tracking estimates where the participant looks from their webcam, with
[WebGazer](https://webgazer.cs.brown.edu/). A study sets it up in three steps: _Set up eye tracking_
starts the webcam and has the participant centre their face; _Calibrate eye tracking_ shows points
to click or look at, so the eye tracker learns where they look; and _Check eye-tracking accuracy_,
which is optional, records how close its estimates fall to points shown. The validator says so if a
step comes before the one it needs, on any path a participant can take.

Once a study has an eye-tracking step, every other step offers _track where the participant
looks_. A tracked
step's row holds its gaze estimates in `webgazer_data`, each `x` and `y` in pixels from the top
left of the screen with `t` in milliseconds since the step began, and in `webgazer_targets` the
place on the screen of each element asked for: the stimulus, for the plugins that give it an id,
and any other named by CSS selector.

Webcam eye tracking is far coarser than a lab eye tracker and needs good light and a still head;
it suits which part of the screen someone looks at more than which word. The video never leaves
the participant's computer: only the gaze coordinates are kept, and WebGazer is told not to store
what it learns in the browser, where the next person at a shared computer would inherit it. WebGazer is GPL-3.0
licensed; an exported study loads it from unpkg, as it does jsPsych, unless the download is
self-contained, when it carries a copy. Like recording, it cannot
run in the preview.

## Ending early

A study can end before its last step, for a participant who declines consent or is screened out.
Name the ending under `recruitment.endings`, with either a return address or a message, and put an
`end` step where the study should stop, usually inside a branch on the participant's answer:

```json
"recruitment": {
  "endings": { "no_consent": { "message": "<p>Thank you for your time.</p>" } }
},
"timeline": [
  { "kind": "trial", "plugin": "html-button-response", "tag": "consent",
    "params": { "stimulus": "<p>Do you agree to take part?</p>", "choices": ["Yes", "No"] } },
  { "kind": "branch", "when": { "scope": "consent", "response_equals": 1 },
    "then": [{ "kind": "end", "ending": "no_consent" }] }
]
```

Reaching the end step writes a row naming the ending in an `ending` column, saves the data the
way the study does, then shows the message or sends the participant to the address. Every `end`
step must name an ending the study has.

Each early ending also says what is kept with `keep`. Ethics boards often ask for a declined
participant's data to be discarded:

- `"all"`, the default, saves every row.
- `"checkpoint"` saves only the row naming the ending, which carries the participant's id and the
  link's parameters, so a platform can still be told who left.
- `"nothing"` saves none of their data: no upload, no download, not even that row. The participant
  is shown the message or sent back straight away, with their id in the return address if it asks
  for one. A balanced split that runs before the end step has still asked the data service for a
  group, which sends the experiment id and nothing about the participant.

`complete` always keeps everything, and so does every ending of a study that saves its data as it
goes.

A browser check can screen participants out on its own, by a minimum window size or a rule written
as code. jsPsych would end the whole study there, unsaved and with no way back to the platform, so
a browser check that can turn people away names the ending to send them to instead:

```json
{
  "kind": "trial",
  "plugin": "browser-check",
  "params": { "minimum_width": 1000 },
  "exclusion_ending": "screened_out"
}
```

A participant it turns away gets an `excluded` column on its row, then leaves by that ending as an
`end` step would send them, with what the ending keeps.

## Editing a spec by hand

Every spec names a JSON Schema in `$schema`, so a spec file opened in VS Code, Positron or any
other editor with a JSON language server gets completion, hover documentation and validation —
including each plugin's own parameters and the JSDoc describing them, since the schema is built
from the same extraction that drives the builder's forms. The builder writes `$schema` into
everything it exports, so a downloaded spec is ready to edit before anything is installed.

`npm run spec-schema` regenerates `packages/compiler/spec-schema.json`, which the Pages deploy
serves alongside the builder.

The schema encodes the structural rules — which step kinds exist, what each one requires, that a
parameter may hold a `{ "var": "column" }` reference anywhere a literal is allowed, that a
parameter may instead hold `{ "code": "..." }`, that uploading data needs an experiment id.

The rules that need the whole spec at once, such as whether a referenced conditions column
actually exists upstream of the step reading it, stay in the compiler's validator; the schema
narrows what reaches it rather than replacing it. Where the validator restates one of the schema's
rules in plainer words, a test holds the two to the same answers.

Code is optional, except where a plugin's parameter takes a function. A parameter that takes a
function (such as a button's `button_html`) holds the function itself, and accepts only code;
any other parameter's code is a single expression worked out when the trial starts, with `jsPsych`
in scope. The compiler checks that each piece of code is exactly one JavaScript expression before
emitting it.

## Code, and projects from other people

A study is a web page, and the code and HTML in it run in that page for every participant, with
everything the page can reach: their responses, the upload, where they are sent at the end. Open
and run projects from people you trust. Steps that hold code carry a `code` badge in the timeline.

Nothing from a project runs in the builder's own page:

- **The preview** runs the study in a sandboxed frame (`allow-scripts` and `allow-forms`, which
  jsPsych's questionnaires submit through, but not `allow-same-origin`), so it cannot read the
  builder, the open project, or the browser's storage.
  It saves no data, contacts no data service and sends no one to a platform: the preview drops
  those settings and draws groups and task orders itself.
- **Formatted text** is put into the editor only when it is plain formatting. Anything more, such
  as an image, a link or an event handler, is edited as HTML text instead, and reaches
  participants as written.

The preview frame can still do what any web page can from inside it, such as load from or send to
the internet. That is left open on purpose: jsPsych preloads sounds and videos given by URL over
the network, and blocking it would break the preview of any study that uses them, while the
frame has nothing of yours to send.

## Design rules

- **One-way compile.** The spec compiles to JavaScript; JavaScript is never parsed back.
- **Code is an option, not the route.** Authors may write code for any parameter, and must for the
  few that take a function, until a form can build that function for them.
- **Generated forms.** No per-plugin UI code — ~115 plugins would bury a single maintainer.
- **No backend.** Static tool. Results go to DataPipe, at pipe.jspsych.org or self-hosted, and a
  failed upload falls back to a download so a participant's data is never lost silently. Balanced group
  assignment and Latin-square task order ask that same service for the next participant's
  condition, since only it can count participants; if it gives none, the study stops rather than
  guess, unless the spec opts into drawing one in the browser.
- **Self-contained downloads.** Media is embedded in the project and in the exported file (files
  are capped at 5 MB each), and by default a download carries jsPsych and its plugins too, so the
  study loads nothing from elsewhere. Those copies are fetched from unpkg at pinned versions and
  kept only if they match hashes recorded from the npm packages when Tachisto was built; a study
  that loads from unpkg instead has the browser check the same hashes for the scripts and
  stylesheet its page names (not for the eye tracker's model, which WebGazer fetches itself). Eye tracking loads a model
  as it runs, so it is self-contained as a project folder, not as a single file. A single file
  writes each script and stylesheet into the page, except one holding text that would end its
  element, such as the DataPipe extension's Firebase: that one is carried unchanged as a base64
  `data:` URL, with the browser checking its recorded hash.
- **Readable output.** The generated file is something a researcher can read, host, and hand to a
  collaborator. The builder shows the generated code as you edit.
- **Browser-safe core.** Everything in `packages/compiler/src` except `cli.ts` must run in the
  browser, because the preview compiles there. A test enforces it.
- **Versioned provenance.** Exports say what made them: the Psych-DS `isBasedOn`, the header
  comment in `experiment.js`, the `generator` meta tag and the project readme all name Tachisto and
  jsPsych with their versions. Tachisto's comes from `packages/compiler/package.json`, so a release
  is a version bump and nothing else — `npm version <v> --workspaces` turns it on everywhere, and
  regenerates `codemeta.json` with the new version, its release URL and the jsPsych it builds for
  (`npm run codemeta` does the same by hand; CI fails if it is out of date). The same run writes
  `CITATION.cff` and `.zenodo.json` from `codemeta.json`, so the citation and the Zenodo archive
  say what it says. The description, licence, keywords and links come from the root
  `package.json`, so they are said once; only what npm has no field for, such as the authors and
  development status, is written in `codemeta.json` by hand.
  While the workspaces sit at `0.0.0` no Tachisto version is claimed, because a dataset built by
  "Tachisto 0.0.0" names a build nobody can obtain.

## Citing Tachisto

GitHub's "Cite this repository" button, in the sidebar of the repository page, gives a citation
in APA or BibTeX from [`CITATION.cff`](CITATION.cff).

Every release is archived on Zenodo. [10.5281/zenodo.23669791](https://doi.org/10.5281/zenodo.23669791)
always resolves to the latest one; each release also has a DOI of its own, so a methods section can
name the exact Tachisto that built an experiment.

## License

MIT — see [LICENSE](LICENSE). Experiments you build with it are yours, under whatever terms you
like; nothing Tachisto generates carries this licence onward.

The repository also ships jsPsych's own documentation text inside
`packages/schemas/plugin-schemas.json`, which is MIT licensed too. See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

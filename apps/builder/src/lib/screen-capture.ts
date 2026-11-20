import captureLibrary from "html-to-image/dist/html-to-image.js?raw";
import { STEP_COLUMN, walkNodes, type Spec, type SpecNode } from "tachisto-compiler";
import { compilePreview, isStepId, previewPage, tracedPreview } from "./preview.ts";
import { segmentHolds, tableAt, type Segment, type Sequence } from "./sequence.ts";
import { measureTextScreen, readTextScreen, type ScreenPicture } from "./text-screen.ts";

/** The size the participant's screen is drawn at: the figure's screens, five times over. */
export const CAPTURE_SIZE = { width: 800, height: 500 };

/** Pictures are taken at twice the screen's size, whatever the screen of the computer taking them. */
const PIXEL_RATIO = 2;

const MESSAGE_SOURCE = "tachisto-capture";

/** Long enough for a slow plugin to draw, short enough that a stuck one does not hold the figure. */
const CAPTURE_TIMEOUT = 20_000;

/** Far more than any screen at this size needs; a frame sending more is not sending a screen. */
const MAX_PICTURE_LENGTH = 4_000_000;

function onePass(nodes: SpecNode[]) {
  walkNodes(nodes, (node) => {
    if (node.kind === "block") {
      node.repetitions = 1;
      node.randomize_order = false;
    }
    // Nobody answers during a capture, so a loop repeating until answers are good would not end;
    // no accuracy is below none, so it runs once.
    if (node.kind === "loop") {
      node.repeat_while = { scope: node.repeat_while.scope, accuracy_below: 0 };
    }
  });
}

/**
 * The study narrowed to one pass through a sequence's block or loop: every block in it runs one
 * row, once, in order, every loop runs once, and there is no pause between steps. The block's own
 * table runs the row asked for; any other runs its first.
 */
export function captureSpec(spec: Spec, sequence: Sequence, row = 0) {
  const traced = tracedPreview(spec, { from: sequence.path });
  onePass(traced.spec.timeline);
  const chosen = tableAt(spec, sequence.path);
  const conditions = Object.fromEntries(
    Object.entries(traced.spec.conditions ?? {}).map(([name, rows]) => {
      const pick = name === chosen ? (rows[row] ?? rows[0]) : rows[0];
      return [name, pick ? [pick] : []];
    }),
  );
  const settings = { ...traced.spec.settings, default_iti: 0 };
  return { ...traced, spec: { ...traced.spec, conditions, settings } };
}

// Runs in the capture frame before jsPsych loads. No step of the study may end by itself while it
// is pictured: one that did would leave the next to be pictured in its place, and a stimulus
// timed to disappear would be gone. So the study's timers are held back (those set to fire at
// once still do, since jsPsych uses them to move on), and each step is ended once pictured. Sound
// is silenced, since a step ended this way never stops what it played. Steps that are not the
// study's own, such as the preload jsPsych adds, are neither pictured nor ended: they end
// themselves, and ending one early would end the step after it instead. A screen of nothing but
// text is also measured, so the figure can draw its text as text.
const CAPTURE_SCRIPT = `(() => {
  const measureTextScreen = (${measureTextScreen.toString()});
  const setTimer = window.setTimeout.bind(window);
  const wait = (ms) => new Promise((done) => setTimer(done, ms));
  window.setTimeout = (callback, ms, ...rest) => (ms > 0 ? 0 : setTimer(callback, ms, ...rest));
  window.setInterval = () => 0;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    this.muted = true;
    return play.call(this);
  };
  for (const Context of [window.AudioContext, window.webkitAudioContext].filter(Boolean)) {
    Context.prototype.resume = () => Promise.resolve();
  }
  let steps = 0;
  window.tachistoCapture = async (step) => {
    const started = ++steps;
    await wait(100);
    await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
    await document.fonts.ready;
    if (started !== steps) return;
    let text = null;
    try {
      text = measureTextScreen(${CAPTURE_SIZE.width}, ${CAPTURE_SIZE.height});
    } catch {}
    let png = null;
    try {
      const options = {
        width: ${CAPTURE_SIZE.width},
        height: ${CAPTURE_SIZE.height},
        pixelRatio: ${PIXEL_RATIO},
        backgroundColor: getComputedStyle(document.body).backgroundColor,
      };
      // WebKit draws the page before the pictures in it have loaded, leaving out images and
      // canvases the first time; by the second they are loaded.
      await htmlToImage.toPng(document.body, options);
      png = await htmlToImage.toPng(document.body, options);
    } catch {}
    if (started !== steps) return;
    parent.postMessage({ source: "${MESSAGE_SOURCE}", step, png, text }, "*");
    window.studioExperiment.jsPsych.finishTrial();
  };
})();`;

const CAPTURE_HOOKS =
  `on_trial_start: (trial) => { const step = trial.data?.${STEP_COLUMN}; ` +
  `if (step) window.tachistoCapture(step); }, ` +
  `on_finish: () => { parent.postMessage({ source: "${MESSAGE_SOURCE}", done: true }, "*"); }`;

export type CaptureMessage =
  { done: true } | { done: false; step: string; picture: ScreenPicture | null };

// A capture is written straight into the figure's markup, so only a plain base64 PNG is taken.
const PNG_DATA = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

/**
 * A message from the capture frame, if it is one the capture script sends. A step is pictured by
 * its text where the frame measured it and every part of it reads, and by its PNG otherwise.
 */
export function readCaptureMessage(message: unknown): CaptureMessage | null {
  if (typeof message !== "object" || message === null) return null;
  const { source, done, step, png, text } = message as Record<string, unknown>;
  if (source !== MESSAGE_SOURCE) return null;
  if (done === true) return { done: true };
  if (!isStepId(step)) return null;
  const readablePng =
    typeof png === "string" && png.length <= MAX_PICTURE_LENGTH && PNG_DATA.test(png);
  if (png !== null && !readablePng) return null;
  return { done: false, step, picture: readTextScreen(text) ?? png };
}

/** The page that runs one pass through the sequence and pictures each step. */
export async function capturePage(spec: Spec, sequence: Sequence, row = 0) {
  const compiled = compilePreview(captureSpec(spec, sequence, row), CAPTURE_HOOKS);
  // The capture script goes first, so the study's timers are held before jsPsych can set any.
  const { html } = await previewPage(compiled, spec.name, [CAPTURE_SCRIPT, captureLibrary]);
  return html;
}

/** Whether a segment is drawn with a screen worth picturing: anything but a pause. */
const pictured = (segment: Segment) => segment.role !== "gap";

/** Where a picture of a step goes: the segment that holds the step, once. */
export function placeCapture(
  sequence: Sequence,
  screens: (ScreenPicture | undefined)[],
  step: string,
  picture: ScreenPicture,
) {
  const index = sequence.segments.findIndex(
    (segment) => pictured(segment) && segmentHolds(segment, step),
  );
  if (index === -1 || screens[index] !== undefined) return false;
  screens[index] = picture;
  return true;
}

function hiddenFrame() {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  // Nothing in it may be reached by a Tab or a key press: a key could end a step before its
  // picture is taken.
  frame.inert = true;
  frame.tabIndex = -1;
  // Kept inside the window but unseen: a browser stops drawing a frame that is out of view, and a
  // frame that is not drawn cannot be pictured.
  Object.assign(frame.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${CAPTURE_SIZE.width}px`,
    height: `${CAPTURE_SIZE.height}px`,
    border: "0",
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
  });
  return frame;
}

/**
 * A picture of the screen each segment of a sequence starts with, or its text where it shows
 * nothing else, as a participant would see it for one row of its conditions. It runs the steps
 * in a hidden frame sealed off like the preview; a step that cannot be pictured, or does not
 * finish in time, is left without one. Aborting stops the capture and removes the frame.
 */
export async function captureScreens(
  spec: Spec,
  sequence: Sequence,
  { row = 0, signal }: { row?: number; signal?: AbortSignal } = {},
) {
  const html = await capturePage(spec, sequence, row);
  const screens: (ScreenPicture | undefined)[] = sequence.segments.map(() => undefined);
  const wanted = sequence.segments.filter(pictured).length;
  const frame = hiddenFrame();
  let placed = 0;
  try {
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        window.removeEventListener("message", listen);
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, CAPTURE_TIMEOUT);
      function listen(event: MessageEvent) {
        if (event.source !== frame.contentWindow) return;
        const message = readCaptureMessage(event.data);
        if (!message) return;
        if (message.done) return finish();
        if (message.picture && placeCapture(sequence, screens, message.step, message.picture)) {
          placed += 1;
        }
        if (placed >= wanted) finish();
      }
      if (signal?.aborted) return finish();
      signal?.addEventListener("abort", finish);
      window.addEventListener("message", listen);
      frame.srcdoc = html;
      document.body.append(frame);
    });
  } finally {
    frame.remove();
  }
  return screens;
}

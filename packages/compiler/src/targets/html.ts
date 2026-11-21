import { escapeHtmlText } from "../emit.ts";
import { PACKAGE_ATTRIBUTE } from "../gaze.ts";
import {
  BROWSER_BUNDLE,
  JSPSYCH_STYLESHEET,
  breaksOut,
  type Element,
} from "tachisto-schemas/files";
import { cdnUrl, packageFileKey, thirdPartyComment } from "../package-files.ts";
import { generatorLabel } from "../metadata.ts";
import { formatSource } from "../format.ts";
import type { CompileResult } from "../types.ts";

export interface HtmlTargetOptions {
  title: string;
  /** Load the experiment from this file instead of writing it into the page. */
  sourceFile?: string;
  /**
   * Where the page loads jsPsych and its plugins from: `"cdn"` for unpkg, checked against each
   * file's recorded hash, or a path to a folder holding them as `<package>/<path>`.
   */
  base?: string;
  /**
   * The packages' files by {@link packageFileKey}, to carry in the page instead of linking. Each is
   * written in as it is, except a file that would break out of its element, which is carried
   * encoded and checked against its recorded hash as it loads.
   */
  inline?: Record<string, Uint8Array>;
  /** Which Tachisto built the page; defaults to this build's own version. */
  tachisto?: string;
  /** Inline scripts that run before jsPsych loads, such as the preview's focus guard. */
  headScripts?: string[];
}

interface PageFile {
  package: string;
  version: string;
  path: string;
  /** Extras say which package they are, so the experiment can find files beside them. */
  named?: boolean;
}

/** The files the page itself names, in the order it loads them; the stylesheet comes first. */
function pageFiles(result: CompileResult): PageFile[] {
  return [
    { package: "jspsych", version: result.jspsych, path: JSPSYCH_STYLESHEET },
    { package: "jspsych", version: result.jspsych, path: BROWSER_BUNDLE },
    ...result.scripts.map(({ package: name, version, file }) => ({
      package: name,
      version,
      path: file,
      named: true,
    })),
    ...result.plugins.map((plugin) => {
      const { name, version } = result.packages[plugin];
      return { package: name, version, path: BROWSER_BUNDLE };
    }),
  ];
}

/**
 * Files the study loads while it runs rather than naming in the page, such as the eye tracker's
 * model. A page that carries its scripts inside it has no folder for these to be found in.
 */
export function filesLoadedWhileRunning(result: CompileResult) {
  const named = new Set(pageFiles(result).map(packageFileKey));
  return result.files.filter((file) => !named.has(packageFileKey(file)));
}

/**
 * Refuses a study that loads files while it runs, such as the eye tracker's model, since a page
 * carrying its scripts inside it has no folder for them. Asked before gathering any copies, so
 * nobody waits for files that would only be thrown away.
 */
export function assertFitsInOnePage(result: CompileResult) {
  if (filesLoadedWhileRunning(result).length > 0) {
    throw new Error(
      "this study loads files while it runs, such as the eye tracker's model, so it cannot be " +
        "carried in one page; download the project folder instead",
    );
  }
}

export { breaksOut, type Element };

function insideElement(text: string, element: Element, key: string) {
  const found = breaksOut(text, element);
  if (found) {
    throw new Error(`${key} holds "${found}", so it cannot be written safely into the page`);
  }
  return text;
}

function urlOf(file: PageFile, base: string) {
  return base === "cdn" ? cdnUrl(file) : `${base}/${packageFileKey(file)}`;
}

const BASE64_CHUNK = 0x8000;

function base64Of(bytes: Uint8Array) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK));
  }
  return btoa(binary);
}

function tagFor(file: PageFile, result: CompileResult, options: HtmlTargetOptions) {
  const isStylesheet = file.path.endsWith(".css");
  const name = file.named ? ` ${PACKAGE_ATTRIBUTE}="${escapeHtmlText(file.package)}"` : "";
  const key = packageFileKey(file);
  const recorded = result.files.find((each) => packageFileKey(each) === key);
  let url: string;
  let check = "";
  if (options.inline) {
    const copy = options.inline[key];
    if (copy === undefined) throw new Error(`no copy of ${key} to write in`);
    if (!recorded?.breaksOutOfPage) {
      const text = new TextDecoder().decode(copy);
      const contents = insideElement(text, isStylesheet ? "style" : "script", key);
      return isStylesheet
        ? `<style>\n${contents}\n</style>`
        : `<script${name}>\n${contents}\n</script>`;
    }
    // A file that would break out of any element written around it is carried as a `data:` URL:
    // base64 cannot end an attribute, the bytes stay exactly those checked, and the browser
    // checks them again against the recorded hash, as it does a CDN copy. A script loaded this
    // way still runs in its place among the others, before the experiment.
    url = `data:text/${isStylesheet ? "css" : "javascript"};base64,${base64Of(copy)}`;
    check = ` integrity="${recorded.integrity}"`;
  } else {
    const base = (options.base ?? "cdn").replace(/\/+$/, "");
    url = urlOf(file, base);
    // A CDN file is checked against the hash recorded for it, so a changed copy is refused rather
    // than run; files beside the page are the author's own.
    if (base === "cdn" && recorded) {
      check = ` integrity="${recorded.integrity}" crossorigin="anonymous"`;
    }
  }
  return isStylesheet
    ? `<link rel="stylesheet" href="${url}"${check} />`
    : `<script${name} src="${url}"${check}></script>`;
}

export interface HtmlOutput {
  html: string;
  /** The formatted experiment source, so callers can show it without formatting again. */
  body: string;
}

export async function emitHtml(
  result: CompileResult,
  options: HtmlTargetOptions,
): Promise<HtmlOutput> {
  if (options.inline) assertFitsInOnePage(result);
  const [stylesheet, ...packageScripts] = pageFiles(result).map((file) =>
    tagFor(file, result, options),
  );
  const scripts = [
    ...(options.headScripts ?? []).map((script) => `    <script>${script}</script>`),
    ...packageScripts.map((tag) => `    ${tag}`),
  ].join("\n");

  // The jsPsych browser bundle already declares a global `initJsPsych`, so the experiment body
  // must not re-declare it. `studioExperiment` is the handle the preview iframe talks to.
  const body = await formatSource(`${result.source}
window.studioExperiment = { jsPsych };
`);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
${options.inline ? `    ${thirdPartyComment(result.files).replace(/\n/g, "\n    ")}\n` : ""}    <meta name="generator" content="${generatorLabel(options.tachisto)}" />
    <meta name="description" content="${escapeHtmlText(options.title)}, a behavioural experiment." />
    <title>${escapeHtmlText(options.title)}</title>
    ${stylesheet}
${result.styles ? `    <style>\n${result.styles.replace(/^/gm, "      ").trimEnd()}\n    </style>` : ""}
${scripts}
  </head>
  <body>
${
  options.sourceFile
    ? `    <script src="${options.sourceFile}"></script>`
    : // Left unindented: indenting each line would change the text of a multi-line template
      // literal, which author code can hold.
      `    <script>
${body.trimEnd()}
    </script>`
}
  </body>
</html>
`;

  return { html, body };
}

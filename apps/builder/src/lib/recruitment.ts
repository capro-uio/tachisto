import {
  COMPLETE_ENDING,
  earlyEndingNames,
  endingOf,
  idParamOf,
  isEndingName,
  PARTICIPANT_PLACEHOLDER,
  RECRUITMENT_PLATFORMS,
  RETENTIONS,
} from "tachisto-compiler";
import type { Ending, RecruitmentPlatform, Retention, Spec } from "tachisto-compiler";

interface PlatformGuide {
  label: string;
  urlPlaceholder: string;
  /** What the researcher has to do on the platform's side for the hand-off to work. */
  hint: string;
}

const GUIDES: Record<RecruitmentPlatform, PlatformGuide> = {
  prolific: {
    label: "Prolific",
    urlPlaceholder: "https://app.prolific.com/submissions/complete?cc=…",
    hint:
      "In Prolific, choose to record Prolific IDs through URL parameters, and paste the " +
      "completion URL from the study's completion section.",
  },
  sona: {
    label: "SONA",
    urlPlaceholder: `https://….sona-systems.com/webstudy_credit.aspx?…&survey_code=${PARTICIPANT_PLACEHOLDER}`,
    hint:
      "In SONA, end the study URL with ?id=%SURVEY_CODE%. Paste SONA's completion URL here and " +
      `put ${PARTICIPANT_PLACEHOLDER} after survey_code= in place of the XXXX.`,
  },
  connect: {
    label: "CloudResearch Connect",
    urlPlaceholder: "https://…",
    hint: "Paste the completion redirect URL from the Connect study wizard.",
  },
  custom: {
    label: "Another platform",
    urlPlaceholder: `https://…?id=${PARTICIPANT_PLACEHOLDER}`,
    hint:
      "Name the URL parameter your platform puts the participant's id in, and write " +
      `${PARTICIPANT_PLACEHOLDER} in the return address wherever the platform expects it.`,
  },
};

export const PLATFORMS = RECRUITMENT_PLATFORMS.map((id) => ({ id, ...GUIDES[id] }));

/** A spec written by hand may name no platform; it is then treated as an unnamed one. */
export function guideFor(platform: RecruitmentPlatform | undefined): PlatformGuide | undefined {
  return GUIDES[platform ?? "custom"];
}

export type PlatformChoice = RecruitmentPlatform | "none";
export type EndingKind = "message" | "url";

export const DEFAULT_EARLY_ENDING = "ended_early";
const DEFAULT_MESSAGE = "<p>Thank you for your time. The study ends here.</p>";

function hasReturnAddress(spec: Spec) {
  return Object.values(spec.recruitment?.endings ?? {}).some(
    (ending) => endingKind(ending) === "url",
  );
}

/**
 * A spec written by hand may name no platform; it counts as an unnamed one when it hands
 * participants to or from a platform at all, and as none when it only has messages to show.
 */
export function platformChoice(spec: Spec): PlatformChoice {
  const recruitment = spec.recruitment;
  if (recruitment?.platform) return recruitment.platform;
  return recruitment?.id_param || hasReturnAddress(spec) ? "custom" : "none";
}

/** Removes the recruitment settings once nothing is left in them. */
function tidy(spec: Spec) {
  const recruitment = spec.recruitment;
  if (!recruitment) return;
  if (recruitment.endings && Object.keys(recruitment.endings).length === 0) {
    delete recruitment.endings;
  }
  if (Object.keys(recruitment).length === 0) delete spec.recruitment;
}

/**
 * Switching platform drops any id parameter typed for the last one, and keeps the return
 * addresses. Choosing none drops every hand-off back to a platform, but keeps the messages an
 * early ending shows.
 */
export function choosePlatform(spec: Spec, platform: PlatformChoice) {
  const { id_param: _previous, platform: _platform, ...rest } = spec.recruitment ?? {};
  if (platform !== "none") {
    spec.recruitment = { ...rest, platform };
    return;
  }
  const endings = Object.entries(rest.endings ?? {}).filter(
    ([, ending]) => endingKind(ending) === "message",
  );
  spec.recruitment = { ...rest, endings: Object.fromEntries(endings) };
  tidy(spec);
}

/** Typing the platform's own parameter, or nothing, stores nothing, so the field and spec agree. */
export function setIdParam(spec: Spec, value: string) {
  if (!spec.recruitment) return;
  const idParam = value.trim();
  const usual = idParamOf({ platform: spec.recruitment.platform });
  if (idParam && idParam !== usual) spec.recruitment.id_param = idParam;
  else delete spec.recruitment.id_param;
}

/** An empty field stores no sample size; anything else is kept as typed, for the checks to judge. */
export function setSampleSize(spec: Spec, value: string) {
  const sampleSize = value.trim();
  if (sampleSize) spec.sample_size = Number(sampleSize);
  else delete spec.sample_size;
}

export function setCompletionUrl(spec: Spec, value: string) {
  if (!spec.recruitment) return;
  const url = value.trim();
  if (url) (spec.recruitment.endings ??= {})[COMPLETE_ENDING] = { url };
  else delete spec.recruitment.endings?.[COMPLETE_ENDING];
  tidy(spec);
}

/** The endings an end step can reach before the study is complete. */
export function earlyEndings(spec: Spec) {
  return earlyEndingNames(spec.recruitment).flatMap((name) => {
    const ending = endingOf(spec.recruitment, name);
    return ending ? [{ name, ending }] : [];
  });
}

/** Adds an ending that shows a message, or says why the name will not do. */
export function addEnding(spec: Spec, name: string): string | undefined {
  const ending = name.trim();
  if (ending === COMPLETE_ENDING) return "the study already ends this way after its last step";
  if (endingOf(spec.recruitment, ending)) return `there is already an ending called ${ending}`;
  if (!isEndingName(ending)) {
    return "start with a letter, and use only letters, digits, - and _ (e.g. no_consent)";
  }
  spec.recruitment ??= {};
  (spec.recruitment.endings ??= {})[ending] = { message: DEFAULT_MESSAGE };
  return undefined;
}

export function removeEnding(spec: Spec, name: string) {
  delete spec.recruitment?.endings?.[name];
  tidy(spec);
}

export function endingKind(ending: Ending): EndingKind {
  return ending.url === undefined ? "message" : "url";
}

/** Switching between a message and a return address starts the other one empty. */
export function setEndingKind(spec: Spec, name: string, kind: EndingKind) {
  const endings = spec.recruitment?.endings;
  const ending = endingOf(spec.recruitment, name);
  if (!endings || !ending || endingKind(ending) === kind) return;
  const { url: _url, message: _message, ...kept } = ending;
  endings[name] = kind === "url" ? { ...kept, url: "" } : { ...kept, message: "" };
}

/** Sets the message or the address, whichever the ending has. */
export function setEndingTarget(spec: Spec, name: string, value: string) {
  const ending = endingOf(spec.recruitment, name);
  if (!ending) return;
  if (endingKind(ending) === "url") ending.url = value.trim();
  else ending.message = value;
}

const RETENTION_LABELS: Record<Retention, string> = {
  all: "keep all their data",
  checkpoint: "keep only a row saying they ended here",
  nothing: "keep nothing: save and upload none of their data",
};

export const RETENTION_CHOICES = RETENTIONS.map((id) => ({ id, label: RETENTION_LABELS[id] }));

/** Keeping everything is the default, so it is stored as no setting at all. */
export function setRetention(spec: Spec, name: string, keep: Retention) {
  const ending = endingOf(spec.recruitment, name);
  if (!ending || name === COMPLETE_ENDING) return;
  if (keep === "all") delete ending.keep;
  else ending.keep = keep;
}

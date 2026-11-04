import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

type DependencyField = (typeof DEPENDENCY_FIELDS)[number];

/**
 * A range one workspace states for another, and where it states it. Kept per field rather than
 * collapsed by name: the same sibling may appear in two fields, and a release has to move both.
 */
export interface InternalRange {
  field: DependencyField;
  name: string;
  range: string;
}

/** A workspace as a release sees it: what it is called, where it lives, and the version it carries. */
export interface WorkspaceVersion {
  name: string;
  /** Relative to the repository root, so a message names the file someone has to edit. */
  directory: string;
  /** Undefined when the manifest states none at all. */
  version?: string;
  /** Private workspaces carry the version but are never published. */
  private: boolean;
  /**
   * The ranges it states for other workspaces in this repository. A release has to move these with
   * the version: `^0.0.2` does not include 0.0.3, so a bump that leaves them behind stops npm
   * linking the sibling on disk and sends it to the registry for the version before.
   */
  internal: InternalRange[];
}

interface WorkspaceManifest {
  name?: string;
  version?: string;
  private?: boolean;
  workspaces?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** A range meaning "whatever this repository has", which only a private workspace may state. */
const ANY = "*";

/** The range a workspace should state for a sibling at this version. */
export function internalRange(version: string) {
  return `^${version}`;
}

function manifestAt(path: string): WorkspaceManifest | undefined {
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as WorkspaceManifest)
    : undefined;
}

/**
 * The directories a `workspaces` pattern names. Only a trailing `*` is expanded, which is every
 * pattern this repository uses; a negation is skipped, since honouring one would take matching npm
 * rather than guessing at it, and a pattern spelling out one directory is taken as that directory.
 */
export function workspaceDirectories(root: string, patterns: string[]): string[] {
  const directories: string[] = [];
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) continue;
    if (!pattern.endsWith("/*")) {
      directories.push(pattern);
      continue;
    }
    const parent = pattern.slice(0, -2);
    const entries = existsSync(join(root, parent))
      ? readdirSync(join(root, parent), { withFileTypes: true })
      : [];
    for (const entry of entries) {
      if (entry.isDirectory() && existsSync(join(root, parent, entry.name, "package.json"))) {
        directories.push(`${parent}/${entry.name}`);
      }
    }
  }
  return directories.sort();
}

function internalRanges(manifest: WorkspaceManifest, siblings: Set<string>): InternalRange[] {
  return DEPENDENCY_FIELDS.flatMap((field) =>
    Object.entries(manifest[field] ?? {})
      .filter(([name]) => siblings.has(name))
      .map(([name, range]) => ({ field, name, range })),
  );
}

/**
 * Every workspace a release stamps, private ones included: a version that disagrees anywhere is a
 * version this repository does not really have, whether or not that workspace is published.
 */
export function workspaceVersions(root: string): WorkspaceVersion[] {
  const repository = manifestAt(join(root, "package.json"));
  if (!repository) throw new Error(`no package.json at ${root}`);
  const manifests = workspaceDirectories(root, repository.workspaces ?? []).map(
    (directory) => [directory, manifestAt(join(root, directory, "package.json"))] as const,
  );
  const siblings = new Set(
    manifests.map(([, manifest]) => manifest?.name).filter((name): name is string => !!name),
  );
  return manifests.map(([directory, manifest]) => ({
    name: manifest?.name ?? directory,
    directory,
    version: manifest?.version,
    private: manifest?.private === true,
    internal: manifest ? internalRanges(manifest, siblings) : [],
  }));
}

/** The version most workspaces carry, ignoring those that state none. */
function commonest(workspaces: WorkspaceVersion[]): string | undefined {
  const counts = new Map<string, number>();
  for (const { version } of workspaces) {
    if (version !== undefined) counts.set(version, (counts.get(version) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Whether a range a workspace states for a sibling is one this release can publish. */
function rangeHolds(workspace: WorkspaceVersion, range: string, agreed: string) {
  // A published package saying `*` would ship a dependency on whatever the registry has next, and
  // on a private sibling it would ship a dependency nobody can install.
  if (range === ANY) return workspace.private;
  return range === internalRange(agreed);
}

/** The ranges a workspace states for its siblings that no longer name the version being released. */
function staleRanges(workspace: WorkspaceVersion, agreed: string) {
  return workspace.internal
    .filter(({ range }) => !rangeHolds(workspace, range, agreed))
    .map(
      ({ field, name, range }) =>
        `${workspace.directory}/package.json: ${workspace.name} names ${name} ${range} in ${field}, not ${internalRange(agreed)}`,
    );
}

/**
 * What stops these workspaces from being one release, as lines to print; empty when there is
 * nothing wrong. Given an expected version, every workspace is held to it, which is how a tag is
 * checked; given none, they are only held to each other.
 */
export function versionDisagreements(workspaces: WorkspaceVersion[], expected?: string): string[] {
  if (workspaces.length === 0) return ["no workspaces found"];
  const agreed = expected ?? commonest(workspaces);
  // Nothing to hold the others to: no workspace states a version and no release said what it is.
  if (agreed === undefined) {
    return workspaces.map(
      (workspace) => `${workspace.directory}/package.json: ${workspace.name} carries no version`,
    );
  }
  const wrongVersion = workspaces
    .filter((workspace) => workspace.version !== agreed)
    .map((workspace) =>
      workspace.version === undefined
        ? `${workspace.directory}/package.json: ${workspace.name} carries no version`
        : `${workspace.directory}/package.json: ${workspace.name} is ${workspace.version}, not ${agreed}`,
    );
  return [...wrongVersion, ...workspaces.flatMap((workspace) => staleRanges(workspace, agreed))];
}

/** A semver numeric identifier: no leading zeros, which npm refuses later if they get through. */
const NUMBER = "(?:0|[1-9]\\d*)";
const TAG = new RegExp(`^v(${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-[0-9A-Za-z.-]+)?)$`);

/** The version a release tag names: `v0.0.3` is 0.0.3. */
export function versionFromTag(tag: string): string {
  const match = TAG.exec(tag);
  if (!match) throw new Error(`"${tag}" is not a release tag; expected v1.2.3`);
  return match[1];
}

/**
 * A flag's value, written either way round: `--name value` or `--name=value`. Undefined only when
 * the flag is absent; a flag given without a value throws rather than reading as absent, which
 * would quietly downgrade a check on a tag to a check on nothing.
 */
export function optionValue(argv: string[], name: string): string | undefined {
  const joined = argv.find((argument) => argument.startsWith(`--${name}=`));
  if (joined !== undefined) {
    const value = joined.slice(name.length + 3);
    if (!value) throw new Error(`--${name} needs a value`);
    return value;
  }
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
  return value;
}

/** The version a release is for: a tag's, or one given outright. */
export function askedVersion(argv: string[]): string | undefined {
  const tag = optionValue(argv, "tag");
  if (tag !== undefined) return versionFromTag(tag);
  return optionValue(argv, "version") ?? optionValue(argv, "expect");
}

/** A heading that opens a released version's section, capturing the version it names. */
const NEWS_HEADING = new RegExp(
  `^##\\s+v?(${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-[0-9A-Za-z.-]+)?)(?![\\w.-])`,
);
/** A heading that closes one. A `###` subheading belongs to the section it sits in. */
const SECTION_END = /^#{1,2}\s/;
const FENCE = /^\s*(?:```|~~~)/;

/**
 * One version's section of NEWS.md, as the body of its release. Headings inside a fenced code
 * block are text, not headings, so an entry may quote one. A tag whose version has no section
 * throws rather than publishing a release with notes reconstructed from the commit log, which is
 * what this file exists to stop.
 */
export function releaseNotes(news: string, version: string): string {
  const lines = news.split("\n");
  let fenced = false;
  let start = -1;
  let end = lines.length;
  for (const [index, line] of lines.entries()) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (start === -1) {
      if (NEWS_HEADING.exec(line)?.[1] === version) start = index;
    } else if (SECTION_END.test(line)) {
      end = index;
      break;
    }
  }
  if (start === -1) throw new Error(`NEWS.md has no section for ${version}`);
  const body = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  if (!body) throw new Error(`NEWS.md says nothing under ${version}`);
  return body;
}

/**
 * Every workspace manifest set to one version, siblings' ranges moved with it. Returned as the text
 * to write for each file rather than written here, so what a bump would do can be shown or tested
 * without touching the repository.
 */
export function bumpedManifests(root: string, version: string): Map<string, string> {
  const written = new Map<string, string>();
  for (const workspace of workspaceVersions(root)) {
    const path = join(root, workspace.directory, "package.json");
    const manifest = JSON.parse(readFileSync(path, "utf8")) as WorkspaceManifest;
    manifest.version = version;
    for (const { field, name, range } of workspace.internal) {
      // A private workspace's `*` says "whatever this repository has", which stays true.
      if (range === ANY && workspace.private) continue;
      manifest[field]![name] = internalRange(version);
    }
    written.set(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return written;
}

/** The workspaces a release publishes, in the order npm should receive them. */
export function publishedWorkspaces(workspaces: WorkspaceVersion[]) {
  return workspaces.filter((workspace) => !workspace.private).map((workspace) => workspace.name);
}

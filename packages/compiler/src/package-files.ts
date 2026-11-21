import type { PackageCredit, SchemaBundle } from "tachisto-schemas";

/** A file a study's page loads from a package, with the hash any copy of it must match. */
export interface PackageFile {
  package: string;
  version: string;
  /** Where the file sits inside the package. */
  path: string;
  /** Its subresource-integrity hash, as a browser checks it. */
  integrity: string;
  /** The package's licence, such as MIT. */
  license: string;
  /** Where the package's source and full licence text are published. */
  source: string;
  /** Packages built into the package's files, which a copy of them carries too. */
  bundles?: PackageCredit[];
  /** Set when the file holds text that would end the element a page writes it into. */
  breaksOutOfPage?: true;
}

/** Where a package file goes in a download that carries its own copies: `<package>/<path>`. */
export const packageFileKey = (file: Pick<PackageFile, "package" | "path">) =>
  `${file.package}/${file.path}`;

const CDN = "https://unpkg.com";

/** Where unpkg serves a package file, at exactly the version the study was built with. */
export const cdnUrl = (file: Pick<PackageFile, "package" | "version" | "path">) =>
  `${CDN}/${file.package}@${file.version}/${file.path}`;

/**
 * Every file the bundle records for these packages. A package the bundle has no files for, or
 * records at another version than the study asks for, means the bundle is out of date, which
 * would put the wrong file in a download, so it stops the compile.
 */
export function filesOfPackages(
  bundle: SchemaBundle,
  wanted: { name: string; version: string }[],
): PackageFile[] {
  const seen = new Set<string>();
  return wanted.flatMap(({ name, version }) => {
    if (seen.has(name)) return [];
    seen.add(name);
    const recorded = bundle.packages[name];
    if (!recorded) throw new Error(`the schema bundle records no files for ${name}`);
    if (recorded.version !== version) {
      throw new Error(
        `the schema bundle records ${name} ${recorded.version}, but the study uses ${version}`,
      );
    }
    return Object.entries(recorded.files).map(([path, integrity]) => ({
      package: name,
      version,
      path,
      integrity,
      license: recorded.license,
      source: recorded.source,
      ...(recorded.bundles && { bundles: recorded.bundles }),
      ...(recorded.breaksOutOfPage?.includes(path) && { breaksOutOfPage: true as const }),
    }));
  });
}

/**
 * Each package among the files, once, in the order they first appear, each followed by any
 * package built into its files, named as inside it.
 */
function packagesAmong(files: PackageFile[]): PackageCredit[] {
  const seen = new Map<string, PackageFile>();
  for (const file of files) if (!seen.has(file.package)) seen.set(file.package, file);
  return [...seen.values()].flatMap((file) => [
    file,
    ...(file.bundles ?? []).map((bundled) => ({
      ...bundled,
      package: `${bundled.package} (inside ${file.package})`,
    })),
  ]);
}

// A bar inside a cell would end it and shift every cell after it, and a backslash before a bar
// would undo the escape meant to stop that, so backslashes are escaped first.
const tableCell = (text: string) => text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

/**
 * What a download that carries copies of these packages owes their authors: which packages they
 * are, the licence each is used under, and where its source and full licence text are, as the
 * MIT, GPL and Apache licences ask of anyone handing on a copy.
 */
export function thirdPartyNotice(files: PackageFile[]) {
  const rows = packagesAmong(files).map(
    (file) =>
      `| ${[file.package, file.version, file.license, file.source].map(tableCell).join(" | ")} |`,
  );
  return `# Software this study carries

\`lib/\` holds unchanged copies of these packages, at the versions below. Each belongs to its
authors and is used under the licence named; its source and full licence text are at the address
given.

| Package | Version | Licence | Source |
| --- | --- | --- | --- |
${rows.join("\n")}
`;
}

/** The same notice as a comment at the top of a page that carries the packages inside it. */
export function thirdPartyComment(files: PackageFile[]) {
  const lines = packagesAmong(files).map(
    // A comment ends at the first "--", so no dash may be followed by another inside it.
    (file) =>
      `  ${file.package} ${file.version}, ${file.license}, ${file.source}`.replace(/-(?=-)/g, "- "),
  );
  return `<!--
  This page carries unchanged copies of these packages, each used under the licence named, with
  its source and full licence text at the address given:
${lines.join("\n")}
-->`;
}

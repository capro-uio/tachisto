import { SPDX_PREFIX, withoutMissing, type Codemeta } from "./codemeta.ts";

interface CodemetaAgent {
  "@id"?: string;
  givenName?: string;
  familyName?: string;
  name?: string;
  affiliation?: { name?: string };
}

interface CodemetaRequirement {
  name?: string;
  url?: string;
}

const ORCID_PREFIX = "https://orcid.org/";
const DOI_PREFIX = "https://doi.org/";

/**
 * The bare DOI codemeta's identifier names, if it names one. Zenodo mints the DOI itself, so
 * .zenodo.json must not claim one; only CITATION.cff repeats it.
 */
function doi(codemeta: Codemeta) {
  const identifier = codemeta.identifier as string | undefined;
  return identifier?.startsWith(DOI_PREFIX) ? identifier.slice(DOI_PREFIX.length) : undefined;
}

function authors(codemeta: Codemeta) {
  return ((codemeta.author ?? []) as CodemetaAgent[]).map((author) => ({
    givenName: author.givenName,
    familyName: author.familyName,
    name: author.name,
    orcid: author["@id"]?.startsWith(ORCID_PREFIX) ? author["@id"] : undefined,
    affiliation: author.affiliation?.name,
  }));
}

function spdxLicense(codemeta: Codemeta) {
  const license = codemeta.license as string | undefined;
  return license?.startsWith(SPDX_PREFIX) ? license.slice(SPDX_PREFIX.length) : license;
}

/**
 * CITATION.cff (Citation File Format 1.2.0) from codemeta.json, so GitHub's "Cite this
 * repository" says what codemeta says.
 */
export function citationCff(codemeta: Codemeta) {
  return withoutMissing({
    "cff-version": "1.2.0",
    message: `If you use ${codemeta.name as string}, please cite it as below.`,
    type: "software",
    title: codemeta.name as string,
    abstract: codemeta.description as string | undefined,
    authors: authors(codemeta).map((author) =>
      withoutMissing(
        author.familyName === undefined
          ? { name: author.name, orcid: author.orcid, affiliation: author.affiliation }
          : {
              "given-names": author.givenName,
              "family-names": author.familyName,
              orcid: author.orcid,
              affiliation: author.affiliation,
            },
      ),
    ),
    doi: doi(codemeta),
    version: codemeta.version as string | undefined,
    "date-released": codemeta.dateModified as string | undefined,
    license: spdxLicense(codemeta),
    keywords: codemeta.keywords as string[] | undefined,
    "repository-code": codemeta.codeRepository as string | undefined,
    url: codemeta.url as string | undefined,
  });
}

/**
 * .zenodo.json from codemeta.json: the metadata Zenodo archives each GitHub release with. Zenodo
 * reads it in preference to CITATION.cff, so it carries everything a record needs; the
 * publication date is left for Zenodo to take from the release itself.
 */
export function zenodoMetadata(codemeta: Codemeta) {
  const requirements = (codemeta.softwareRequirements ?? []) as CodemetaRequirement[];
  const website = codemeta.url as string | undefined;
  return withoutMissing({
    upload_type: "software",
    title: codemeta.name as string,
    description: codemeta.description as string | undefined,
    creators: authors(codemeta).map((author) =>
      withoutMissing({
        name:
          author.familyName === undefined
            ? author.name
            : [author.familyName, author.givenName].filter(Boolean).join(", "),
        orcid: author.orcid?.slice(ORCID_PREFIX.length),
        affiliation: author.affiliation,
      }),
    ),
    access_right: "open",
    license: spdxLicense(codemeta)?.toLowerCase(),
    keywords: codemeta.keywords as string[] | undefined,
    version: codemeta.version as string | undefined,
    related_identifiers: [
      ...(website ? [{ identifier: website, relation: "isDocumentedBy", scheme: "url" }] : []),
      ...requirements
        .filter((requirement) => requirement.url)
        .map((requirement) => ({
          identifier: requirement.url,
          relation: "requires",
          scheme: "url",
          resource_type: "software",
        })),
    ],
  });
}

function yamlLines(value: unknown, indent: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const [first, ...rest] = yamlLines(item, `${indent}  `);
      return [`${indent}- ${first.trimStart()}`, ...rest];
    });
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, field]) =>
      field !== null && typeof field === "object" && Object.keys(field).length > 0
        ? [`${indent}${key}:`, ...yamlLines(field, `${indent}  `)]
        : [`${indent}${key}: ${JSON.stringify(field)}`],
    );
  }
  return [`${indent}${JSON.stringify(value)}`];
}

/** Block-style YAML; every string is double-quoted, so none can be read as another type. */
export function toYaml(value: Record<string, unknown>) {
  return `${yamlLines(value, "").join("\n")}\n`;
}

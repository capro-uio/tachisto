/** Where the builder is served, and how a link hands it a spec to open. */
export const BUILDER_URL = "https://www.capro.dev/tachisto/app/";

/** The query parameter a link uses to name the spec the builder should open. */
export const SPEC_PARAMETER = "spec";

/**
 * A link that opens a spec in the builder: for passing a study to someone who should look at it
 * rather than run it. The spec is named by its address, not carried in the link — a spec holding
 * images as data URLs outgrows a URL immediately.
 */
export function builderLink(specUrl: string, builder: string = BUILDER_URL) {
  const link = new URL(builder);
  link.searchParams.set(SPEC_PARAMETER, specUrl);
  return link.href;
}

import type { Spec } from "@tachisto/compiler";
import { parseSpec } from "./project.svelte.ts";

/**
 * A spec is sent from one person to another: downloaded and pasted back in, or left somewhere and
 * opened by its address. Both end here, so both answer the same way when what arrives is not a
 * spec.
 */

/**
 * Big enough for a spec carrying images as data URLs, small enough not to hang the page. Counted
 * in characters rather than bytes, which is what there is to count before parsing.
 */
export const MAXIMUM_SPEC_LENGTH = 8 * 1024 * 1024;

const QUERY_PARAMETER = "spec";

export interface Invitation {
  url: string;
  /** The host alone, which is what tells someone whether to trust what they are about to open. */
  host: string;
}

/**
 * The spec a link asks the builder to open. Only https: a spec holds code that runs for every
 * participant, so it may not arrive over a connection someone can rewrite, and `javascript:` or
 * `data:` are not addresses anyone sends in good faith.
 */
export function invitationFrom(search: string): Invitation | { problem: string } | null {
  const asked = new URLSearchParams(search).get(QUERY_PARAMETER);
  if (asked === null || asked.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(asked);
  } catch {
    return { problem: `${asked} is not an address` };
  }
  if (url.protocol !== "https:") return { problem: `${url.protocol} addresses are not opened` };
  return { url: url.href, host: url.host };
}

export const isInvitation = (
  invitation: Invitation | { problem: string } | null,
): invitation is Invitation => invitation !== null && "url" in invitation;

/** A link that opens this spec in this builder, for passing on to whoever needs to see it. */
export function linkTo(url: string, page: { origin: string; pathname: string }) {
  const link = new URL(page.pathname, page.origin);
  link.searchParams.set(QUERY_PARAMETER, url);
  return link.href;
}

const HTTPS = /^https:\/\//i;
const SOME_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * What someone pasted: the spec itself, or where it lives. One box takes both, because that is
 * how a spec arrives — in a message, or as a link to it.
 */
export async function specFromPasted(
  text: string,
  fetcher: typeof fetch = fetch,
): Promise<{ spec: Spec; url?: string }> {
  const pasted = text.trim();
  if (pasted === "") throw new Error("there is nothing here to open");
  // The caller needs to know whether this came from an address, and only here is that decided.
  if (HTTPS.test(pasted)) return { spec: await specFrom(pasted, fetcher), url: pasted };
  // SOME_SCHEME is anchored and needs a leading letter, so a pasted spec never matches it.
  if (SOME_SCHEME.test(pasted)) throw new Error("only https addresses are opened");
  if (pasted.length > MAXIMUM_SPEC_LENGTH) throw new Error("it is larger than a spec can be");
  return { spec: parseSpec(pasted) };
}

/**
 * Fetches a spec by its address. Everything that can go wrong says so in the words of what was
 * being done, because whoever follows the link did not choose the address and cannot fix it.
 */
export async function specFrom(url: string, fetcher: typeof fetch = fetch): Promise<Spec> {
  let response: Response;
  try {
    response = await fetcher(url);
  } catch (error) {
    throw new Error(`could not be reached (${(error as Error).message})`, { cause: error });
  }
  if (!response.ok) throw new Error(`answered ${response.status}`);
  const text = await response.text();
  // Counted after reading: a server need not say how long its answer is, and a browser will not
  // always tell us even when it does.
  if (text.length > MAXIMUM_SPEC_LENGTH) throw new Error("is larger than a spec can be");
  return parseSpec(text);
}

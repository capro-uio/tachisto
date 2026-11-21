import { cdnUrl, packageFileKey, type PackageFile } from "tachisto-compiler";
import { integrityOf } from "tachisto-schemas/files";

const TURN_OFF = "check the connection, or turn off Self-contained under Downloads in the menu";

/**
 * A copy of every file, fetched from unpkg at the version the study was built with and kept only
 * if it matches the hash recorded when Tachisto was built. A download carries these copies, so a
 * file that differs from what was checked is refused rather than handed to participants. The
 * first file that fails stops the rest, some of which are several megabytes.
 */
export async function fetchPackageSources(
  files: PackageFile[],
  fetcher: typeof fetch = fetch,
): Promise<Record<string, Uint8Array>> {
  const stop = new AbortController();
  const fetchOne = async (file: PackageFile) => {
    const key = packageFileKey(file);
    let response: Response;
    try {
      response = await fetcher(cdnUrl(file), { signal: stop.signal });
    } catch (error) {
      throw new Error(`could not fetch ${key} (${(error as Error).message}); ${TURN_OFF}`, {
        cause: error,
      });
    }
    if (!response.ok) throw new Error(`could not fetch ${key} (${response.status}); ${TURN_OFF}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if ((await integrityOf(bytes)) !== file.integrity) {
      throw new Error(`${key} from unpkg is not the file Tachisto checked, so it was not used`);
    }
    return [key, bytes] as const;
  };
  try {
    return Object.fromEntries(await Promise.all(files.map(fetchOne)));
  } catch (error) {
    stop.abort();
    throw error;
  }
}

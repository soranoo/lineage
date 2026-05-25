import type { IParser } from "@/parse/Parser";
import type { AbsolutePath, ParsedFile, SourceText } from "@/types";

import { ParseError } from "@/types";

/**
 * In-memory parser stub backed by a pre-populated cache.
 */
export class FakeParser implements IParser {
  private readonly cache: Map<AbsolutePath, ParsedFile>;

  /**
   * Create a fake parser with the provided cache.
   *
   * @param cache Map of absolute paths to pre-parsed files.
   */
  constructor(cache: Map<AbsolutePath, ParsedFile>) {
    this.cache = cache;
  }

  /**
   * Returns the cached file for `absolutePath` or throws a ParseError.
   *
   * @param absolutePath Absolute path of the file to retrieve.
   * @param _source Source text (unused for fake parser).
   * @returns Cached ParsedFile for the provided path.
   * @throws {ParseError} When the path is not in the cache.
   */
  readonly parse = (absolutePath: AbsolutePath, _source: SourceText): ParsedFile => {
    const cached = this.cache.get(absolutePath);

    if (cached === undefined) {
      throw new ParseError(absolutePath, []);
    }

    return cached;
  };

  /**
   * Returns the internal cache map.
   *
   * @returns Cache map of absolute paths to ParsedFile values.
   */
  readonly getCache = (): Map<AbsolutePath, ParsedFile> => this.cache;
}

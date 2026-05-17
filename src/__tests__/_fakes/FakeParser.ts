import type { IParser } from "@/parse/Parser";
import type { AbsolutePath, ParsedFile, SourceText } from "@/types";

import { ParseError } from "@/types";

/**
 * In-memory parser stub backed by a pre-populated cache.
 */
export class FakeParser implements IParser {
  private readonly cache: Map<AbsolutePath, ParsedFile>;

  constructor(cache: Map<AbsolutePath, ParsedFile>) {
    this.cache = cache;
  }

  /**
   * Returns the cached file for `absolutePath` or throws a ParseError.
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
   */
  readonly getCache = (): Map<AbsolutePath, ParsedFile> => this.cache;
}

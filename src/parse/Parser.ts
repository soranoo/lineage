import type { AbsolutePath, ParsedFile, SourceText } from "@/types";

/**
 * Parses JavaScript/TypeScript source files into cached ASTs.
 * Implementors must return the cached result on repeated calls for the same path.
 */
export interface IParser {
  /**
   * Parse `source` and cache the result under `absolutePath`.
   * Returns the cached `ParsedFile` on subsequent calls without re-parsing.
   *
   * @param absolutePath Absolute file path of the source being parsed.
   * @param source Raw source code text to parse.
   * @returns Parsed file data for the provided source.
   * @throws {ParseError} When `source` contains syntax errors.
   */
  readonly parse: (absolutePath: AbsolutePath, source: SourceText) => ParsedFile;

  /**
   * Returns the internal parse cache.
   * Key is an absolute file path; value is the corresponding `ParsedFile`.
   *
   * @returns Internal parse cache mapping absolute paths to parsed files.
   */
  readonly getCache: () => Map<AbsolutePath, ParsedFile>;
}

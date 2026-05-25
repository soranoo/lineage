import type { AbsolutePath, ResolveResult, SourceText } from "@/types";

/**
 * Resolves module specifiers to absolute file paths.
 */
export interface IResolver {
  /**
   * Resolves `specifier` as imported from `fromFile`.
   *
   * @param specifier Raw import specifier to resolve.
   * @param fromFile Absolute path of the importing file.
   * @returns Resolution result for the specifier.
   */
  readonly resolve: (specifier: SourceText, fromFile: AbsolutePath) => ResolveResult;
}

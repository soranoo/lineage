import type { AbsolutePath, ResolveResult, SourceText } from "@/types";

/**
 * Resolves module specifiers to absolute file paths.
 */
export interface IResolver {
  /**
   * Resolves `specifier` as imported from `fromFile`.
   */
  readonly resolve: (specifier: SourceText, fromFile: AbsolutePath) => ResolveResult;
}

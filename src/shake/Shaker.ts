import type { FunctionNode, OffsetRange, SourceText } from "@/types";

/**
 * Shakes unused statements inside a function body.
 */
export interface IShaker {
  /**
   * Returns the set of ranges that should be removed or blanked.
   *
   * @param fn Function node to analyze.
   * @param source Source text that contains the function.
   * @returns Set of ranges to remove or blank.
   */
  readonly shake: (fn: FunctionNode, source: SourceText) => Set<OffsetRange>;
}

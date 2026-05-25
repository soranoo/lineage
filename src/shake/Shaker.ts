import type { FunctionNode, OffsetRange, SourceText } from "@/types";

/**
 * Shakes unused statements inside a function body.
 */
export interface IShaker {
  /**
   * Returns the set of ranges that should be removed or blanked.
   */
  readonly shake: (fn: FunctionNode, source: SourceText) => Set<OffsetRange>;
}

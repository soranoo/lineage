import type { IShaker } from "@/shake/Shaker";
import type { FunctionNode, OffsetRange, SourceText } from "@/types";

/**
 * Returns a fixed set of shaken ranges for test scenarios.
 */
export class FakeShaker implements IShaker {
  private readonly result: Set<OffsetRange>;

  /**
   * Create a fake shaker that always returns the provided range set.
   *
   * @param result Set of ranges to return for every shake call.
   */
  constructor(result: Set<OffsetRange>) {
    this.result = result;
  }

  /**
   * Returns the canned set of shaken ranges regardless of input.
   *
   * @param _fn Function node to analyze.
   * @param _source Source text containing the function.
   * @returns Preconfigured set of shaken ranges.
   */
  readonly shake = (_fn: FunctionNode, _source: SourceText): Set<OffsetRange> => this.result;
}

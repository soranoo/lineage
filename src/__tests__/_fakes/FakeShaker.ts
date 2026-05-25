import type { IShaker } from "@/shake/Shaker";
import type { FunctionNode, OffsetRange, SourceText } from "@/types";

/**
 * Returns a fixed set of shaken ranges for test scenarios.
 */
export class FakeShaker implements IShaker {
  private readonly result: Set<OffsetRange>;

  constructor(result: Set<OffsetRange>) {
    this.result = result;
  }

  /**
   * Returns the canned set of shaken ranges regardless of input.
   */
  readonly shake = (_fn: FunctionNode, _source: SourceText): Set<OffsetRange> => this.result;
}

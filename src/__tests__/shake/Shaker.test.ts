import { describe, expect, it } from "vitest";

import type { IShaker } from "@/shake/Shaker";
import type { FunctionNode, OffsetRange, SourceText } from "@/types";

/**
 * Build a minimal function node for shaker tests.
 *
 * @returns FunctionNode instance with an empty body.
 */
const buildFunctionNode = (): FunctionNode => ({
  type: "FunctionDeclaration",
  id: null,
  generator: false,
  async: false,
  params: [],
  body: {
    type: "BlockStatement",
    body: [],
    start: 0,
    end: 0,
  },
  expression: false,
  start: 0,
  end: 0,
});

/**
 * Minimal shaker implementation used for interface checks.
 */
class ValidShaker implements IShaker {
  /**
   * Return an empty set of ranges for the provided function.
   *
   * @param _fn Function node to analyze.
   * @param _source Source text containing the function.
   * @returns Empty set of shaken ranges.
   */
  readonly shake = (_fn: FunctionNode, _source: SourceText): Set<OffsetRange> => new Set();
}

/**
 * Shaker missing shake method for compile-time checks.
 */
// @ts-expect-error Missing shake method.
class MissingShake implements IShaker {}

describe("IShaker", () => {
  it("accepts a valid implementation", () => {
    const shaker = new ValidShaker();
    const ranges = shaker.shake(buildFunctionNode(), "");

    expect(ranges.size).toBe(0);
  });
});

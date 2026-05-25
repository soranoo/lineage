import { describe, expect, it } from "vitest";

import type { IShaker } from "@/shake/Shaker";
import type { FunctionNode, OffsetRange, SourceText } from "@/types";

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

class ValidShaker implements IShaker {
  readonly shake = (_fn: FunctionNode, _source: SourceText): Set<OffsetRange> => new Set();
}

// @ts-expect-error Missing shake method.
class MissingShake implements IShaker {}

describe("IShaker", () => {
  it("accepts a valid implementation", () => {
    const shaker = new ValidShaker();
    const ranges = shaker.shake(buildFunctionNode(), "");

    expect(ranges.size).toBe(0);
  });
});

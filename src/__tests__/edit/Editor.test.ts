import { describe, expect, it } from "vitest";
import MagicString from "magic-string";

import type { IEditor } from "@/edit/Editor";
import type { OffsetRange, OutputMode, SourceText } from "@/types";

/**
 * Minimal editor implementation used for interface checks.
 */
class ValidEditor implements IEditor {
  /**
   * Applies a no-op edit for the provided MagicString.
   *
   * @param _ms MagicString instance to edit.
   * @param _source Original source text.
   * @param _keepRanges Ranges that should be preserved.
   * @param _mode Output mode for the edit operation.
   */
  readonly apply = (
    _ms: MagicString,
    _source: SourceText,
    _keepRanges: Set<OffsetRange>,
    _mode: OutputMode,
  ): void => {};
}

/**
 * Editor missing apply method for compile-time checks.
 */
// @ts-expect-error Missing apply method.
class MissingApply implements IEditor {}

describe("IEditor", () => {
  it("accepts a valid implementation", () => {
    const editor = new ValidEditor();
    const source: SourceText = "const value = 1;";
    const ms = new MagicString(source);
    const ranges = new Set<OffsetRange>();

    editor.apply(ms, source, ranges, "blank");

    expect(ms.toString()).toBe(source);
  });
});

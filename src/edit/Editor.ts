import type MagicString from "magic-string";

import type { OffsetRange, OutputMode, SourceText } from "@/types";

/**
 * Edits a MagicString based on keep/remove ranges.
 */
export interface IEditor {
  /**
   * Applies edits to the provided MagicString in-place.
   *
   * @param ms MagicString instance to edit.
   * @param source Original source text for range calculations.
   * @param keepRanges Ranges that should be preserved.
   * @param mode Output mode controlling blank vs compact edits.
   */
  readonly apply: (
    ms: MagicString,
    source: SourceText,
    keepRanges: Set<OffsetRange>,
    mode: OutputMode,
  ) => void;
}

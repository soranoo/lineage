import type { OffsetRange, OutputMode, SourceText } from "@/types";
import type MagicString from "magic-string";


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
   * @param omitRanges Additional ranges to blank or remove within preserved source.
   */
  readonly apply: (
    ms: MagicString,
    source: SourceText,
    keepRanges: Set<OffsetRange>,
    mode: OutputMode,
    omitRanges?: ReadonlySet<OffsetRange>,
  ) => void;
}

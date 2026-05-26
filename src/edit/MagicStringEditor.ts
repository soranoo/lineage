import { assertNever } from "assert-never";
import MagicString from "magic-string";

import type { CharOffset, OffsetRange, OutputMode, SourceText } from "@/types";

import type { IEditor } from "@/edit/Editor";

/**
 * Sort ranges descending by start offset.
 *
 * @param ranges Ranges to sort.
 * @returns New array sorted in descending start order.
 */
const sortRangesDescending = (ranges: OffsetRange[]): OffsetRange[] =>
  [...ranges].sort((left, right) => right.start - left.start);

/**
 * Merge overlapping or adjacent keep ranges into a sorted list.
 *
 * @param ranges Raw keep ranges to normalize.
 * @returns Sorted non-overlapping keep ranges.
 */
const normalizeKeepRanges = (ranges: Set<OffsetRange>): OffsetRange[] => {
  const sorted = [...ranges].sort((left, right) => {
    if (left.start === right.start) {
      return left.end - right.end;
    }

    return left.start - right.start;
  });

  const merged: OffsetRange[] = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];

    if (!last) {
      merged.push({ start: range.start, end: range.end });
      continue;
    }

    if (range.start <= last.end) {
      const end = range.end > last.end ? range.end : last.end;
      merged[merged.length - 1] = { start: last.start, end };
      continue;
    }

    merged.push({ start: range.start, end: range.end });
  }

  return merged;
};

/**
 * Build the complement ranges that should be removed or blanked.
 *
 * @param source Source text to derive the full range from.
 * @param keepRanges Ranges that should remain untouched.
 * @returns Ranges to remove or blank.
 */
const buildRemoveRanges = (source: SourceText, keepRanges: Set<OffsetRange>): OffsetRange[] => {
  const sourceLength: CharOffset = source.length;

  if (sourceLength === 0) {
    return [];
  }

  const normalized = normalizeKeepRanges(keepRanges);

  if (normalized.length === 0) {
    return [{ start: 0, end: sourceLength }];
  }

  const removeRanges: OffsetRange[] = [];
  let cursor: CharOffset = 0;

  for (const keep of normalized) {
    if (keep.start > cursor) {
      removeRanges.push({ start: cursor, end: keep.start });
    }

    cursor = keep.end > cursor ? keep.end : cursor;
  }

  if (cursor < sourceLength) {
    removeRanges.push({ start: cursor, end: sourceLength });
  }

  return removeRanges;
};

/**
 * Applies blank or compact edits to a MagicString based on keep ranges.
 */
export class MagicStringEditor implements IEditor {
  /**
   * Applies edits to the provided MagicString in-place.
   *
   * @param ms MagicString instance to edit.
   * @param source Original source text for range calculations.
   * @param keepRanges Ranges that should be preserved.
   * @param mode Output mode controlling blank vs compact edits.
   */
  readonly apply = (
    ms: MagicString,
    source: SourceText,
    keepRanges: Set<OffsetRange>,
    mode: OutputMode,
  ): void => {
    const removeRanges = buildRemoveRanges(source, keepRanges);

    // Apply removals from the end to avoid shifting offsets for earlier ranges.
    const ordered = sortRangesDescending(removeRanges);

    switch (mode) {
      case "blank":
        for (const range of ordered) {
          if (range.start === range.end) {
            continue;
          }

          ms.overwrite(range.start, range.end, " ".repeat(range.end - range.start));
        }
        break;
      case "compact":
        for (const range of ordered) {
          if (range.start === range.end) {
            continue;
          }

          ms.remove(range.start, range.end);
        }
        break;
      default:
        assertNever(mode);
    }
  };
}

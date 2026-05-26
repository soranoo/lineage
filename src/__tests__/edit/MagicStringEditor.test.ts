import { describe, expect, it } from "vitest";
import MagicString from "magic-string";

import type { CharOffset, OffsetRange, OutputMode, SourceText } from "@/types";

import { MagicStringEditor } from "@/edit/MagicStringEditor";

/**
 * Build an OffsetRange with the provided bounds.
 *
 * @param start Inclusive start offset.
 * @param end Exclusive end offset.
 * @returns OffsetRange describing the provided bounds.
 */
const buildRange = (start: CharOffset, end: CharOffset): OffsetRange => ({ start, end });

/**
 * Build a Set of keep ranges from a list of ranges.
 *
 * @param ranges Ordered list of keep ranges.
 * @returns Set containing the provided ranges.
 */
const buildKeepRanges = (ranges: OffsetRange[]): Set<OffsetRange> => new Set(ranges);

/**
 * Find the first occurrence of a fragment and return its range.
 *
 * @param source Source text to search.
 * @param fragment Fragment that must exist within the source.
 * @returns OffsetRange covering the fragment.
 */
const findRange = (source: SourceText, fragment: SourceText): OffsetRange => {
  const start: CharOffset = source.indexOf(fragment);

  if (start < 0) {
    throw new Error(`Fragment not found: ${fragment}`);
  }

  const end: CharOffset = start + fragment.length;

  return { start, end };
};

/**
 * Build a keep range set for the provided source fragments.
 *
 * @param source Source text containing all fragments.
 * @param fragments Ordered list of fragments to keep.
 * @returns Set of keep ranges that cover the fragments.
 */
const buildKeepRangesForFragments = (
  source: SourceText,
  fragments: SourceText[],
): Set<OffsetRange> => buildKeepRanges(fragments.map((fragment) => findRange(source, fragment)));

describe("MagicStringEditor", () => {
  it("blanks non-kept ranges while preserving offsets", () => {
    const editor = new MagicStringEditor();
    const source: SourceText = "const keep = 1;\nconst drop = 2;";
    const ms = new MagicString(source);
    const keepRanges = buildKeepRangesForFragments(source, ["keep"]);

    editor.apply(ms, source, keepRanges, "blank");

    const output = ms.toString();
    const keepRange = findRange(source, "keep");

    expect(output).toHaveLength(source.length);
    expect(output.indexOf("keep")).toBe(keepRange.start);
    expect(output.includes("drop")).toBe(false);
    expect(output.slice(0, keepRange.start)).toBe(" ".repeat(keepRange.start));
  });

  it("compacts output by removing non-kept ranges", () => {
    const editor = new MagicStringEditor();
    const source: SourceText = "alpha\nremove\nbeta\nremove2\ngamma";
    const ms = new MagicString(source);
    const keepRanges = buildKeepRangesForFragments(source, ["alpha", "gamma"]);

    editor.apply(ms, source, keepRanges, "compact");

    const output = ms.toString();

    expect(output.length).toBeLessThan(source.length);
    expect(output).toBe("alphagamma");
  });

  it("keeps the full range unchanged", () => {
    const editor = new MagicStringEditor();
    const source: SourceText = "const value = 1;";
    const ms = new MagicString(source);
    const end: CharOffset = source.length;
    const keepRanges = buildKeepRanges([buildRange(0, end)]);

    editor.apply(ms, source, keepRanges, "blank");

    expect(ms.toString()).toBe(source);
  });

  it("blanks the full source when keep set is empty", () => {
    const editor = new MagicStringEditor();
    const source: SourceText = "let value = 1;";
    const ms = new MagicString(source);
    const keepRanges = new Set<OffsetRange>();

    editor.apply(ms, source, keepRanges, "blank");

    expect(ms.toString()).toBe(" ".repeat(source.length));
  });

  it("removes the full source when keep set is empty in compact mode", () => {
    const editor = new MagicStringEditor();
    const source: SourceText = "let value = 1;";
    const ms = new MagicString(source);
    const keepRanges = new Set<OffsetRange>();

    editor.apply(ms, source, keepRanges, "compact");

    expect(ms.toString()).toBe("");
  });

  it("handles overlapping keep ranges by unioning them", () => {
    const editor = new MagicStringEditor();
    const source: SourceText = "abcdefghij";
    const ms = new MagicString(source);
    const keepRanges = buildKeepRanges([buildRange(0, 4), buildRange(2, 6)]);

    editor.apply(ms, source, keepRanges, "compact");

    expect(ms.toString()).toBe("abcdef");
  });

  it("mutates the provided MagicString instance", () => {
    const editor = new MagicStringEditor();
    const source: SourceText = "keep drop";
    const ms = new MagicString(source);
    const original = ms;
    const keepRanges = buildKeepRangesForFragments(source, ["keep"]);

    editor.apply(ms, source, keepRanges, "compact");

    expect(ms).toBe(original);
    expect(ms.toString()).toBe("keep");
  });
});

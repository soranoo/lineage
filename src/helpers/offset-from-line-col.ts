import type { CharOffset, ColumnNumber, LineNumber, SourceText } from "@/types";

/**
 * Convert a 1-based line/column position to a 0-based character offset.
 *
 * @param source Raw source text to compute offsets within.
 * @param line 1-based line number to convert.
 * @param col 1-based column number to convert.
 * @returns 0-based character offset for the given line and column.
 * @throws {RangeError} When the line or column is out of range.
 */
export const offsetFromLineCol = (
  source: SourceText,
  line: LineNumber,
  col: ColumnNumber,
): CharOffset => {
  if (line < 1) {
    throw new RangeError(`Line must be >= 1. Received ${line}.`);
  }

  if (col < 1) {
    throw new RangeError(`Column must be >= 1. Received ${col}.`);
  }

  const lines = source.split("\n");
  if (line > lines.length) {
    throw new RangeError(`Line ${line} exceeds total lines ${lines.length}.`);
  }

  const lineIndex = line - 1;
  const lineText = lines[lineIndex] ?? "";
  const maxColumn = lineText.length + 1;

  if (col > maxColumn) {
    throw new RangeError(`Column ${col} exceeds line length ${lineText.length}.`);
  }

  let offset = 0;
  for (let index = 0; index < lineIndex; index += 1) {
    const line = lines[index];

    if (line === undefined) {
      // unexpected since we already checked line count, but handle just in case
      throw new RangeError(
        `Line ${index + 1} is missing in source, this is an unexpected error, please report this.`,
      );
    }

    offset += line.length + 1;
  }

  offset += col - 1;
  return offset;
};

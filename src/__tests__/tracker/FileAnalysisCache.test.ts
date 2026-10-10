import { parseSource } from "@/__tests__/utils";
import { FileAnalysisCache } from "@/tracker/FileAnalysisCache";
import type { DependencyFileAnalysis, ParsedFile } from "@/types";
import { expect, test } from "vitest";

/** Build source-derived metadata without serializing the shared AST.
 * @param parsed Current immutable source and AST.
 * @returns Minimal completed file analysis.
 */
const analysis = (parsed: ParsedFile): DependencyFileAnalysis => ({
  source: parsed.source,
  ast: parsed.ast,
  dependencies: [],
  moduleCalls: [],
  issues: [],
});

test("invalidates metadata when either source text or AST identity changes", () => {
  const parsed = parseSource('const selected="one";', "/cache/page.js");
  const cache = new FileAnalysisCache();
  cache.write(parsed.absolutePath, analysis(parsed));
  expect(cache.read(parsed)).toBeDefined();
  expect(cache.read({ ...parsed, source: parsed.source.replace("one", "two") })).toBeUndefined();
  expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
  cache.write(parsed.absolutePath, analysis(parsed));
  expect(cache.read(parseSource(parsed.source, parsed.absolutePath))).toBeUndefined();
  expect(cache.stats()).toMatchObject({ hits: 1, misses: 2, entries: 0, bytes: 0 });
});

test("enforces estimated metadata byte limits and leaves oversized files uncached", () => {
  const first = parseSource("const a=1;", "/cache/a.js");
  const second = parseSource("const b=2;", "/cache/b.js");
  const measured = new FileAnalysisCache();
  measured.write(first.absolutePath, analysis(first));
  const bytes = measured.stats().bytes;
  const cache = new FileAnalysisCache({ maxBytes: bytes });
  cache.write(first.absolutePath, analysis(first));
  cache.write(second.absolutePath, analysis(second));
  expect(cache.stats()).toMatchObject({ entries: 1, bytes, evictions: 1 });
  expect(cache.read(first)).toBeUndefined();
  expect(cache.read(second)).toBeDefined();
  cache.write(second.absolutePath, { ...analysis(second), dependencies: ["x".repeat(bytes)] });
  expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
});

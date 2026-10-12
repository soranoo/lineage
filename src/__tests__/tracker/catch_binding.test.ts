import { DependencyTracker } from "@/tracker";
import { expect, test } from "vitest";

test("tracks a caught error without linking the shadowed function parameter", async () => {
  const file = "/virtual/catch.js";
  const source = "function outer(e) { try { fail(); } catch (e) { return e.message; } }";
  const start = source.indexOf("e.message");
  const caught = source.indexOf("e)", source.indexOf("catch"));
  const outer = source.indexOf("e)");
  const result = await new DependencyTracker({ virtualFiles: { [file]: source } }).track({
    entryFile: file,
    startPoint: { start, end: start + "e.message".length },
  });

  expect(result.nodes.some((node) => node.range.start === caught && node.label === "e")).toBe(true);
  expect(result.nodes.some((node) => node.range.start === outer && node.label === "e")).toBe(false);
});

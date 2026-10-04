import { DependencyTracker } from "@/tracker";

test("keeps a destructured error binding separate from an outer module loader", async () => {
  const file = "/virtual/error.js";
  const source =
    "function module(r) { function u(e) { let { res: t, err: r } = e; return r.statusCode; } }";
  const start = source.indexOf("r.statusCode");
  const bound = source.indexOf("r }", source.indexOf("err:"));
  const result = await new DependencyTracker({ virtualFiles: { [file]: source } }).track({
    entryFile: file,
    startPoint: { start, end: start + "r.statusCode".length },
  });
  const bindings = result.nodes.filter((node) => node.kind === "parameter" && node.label === "r");
  expect(bindings.map((node) => node.range)).toEqual([{ start: bound, end: bound + 1 }]);
});
import { expect, test } from "vitest";

test.each([
  { source: "const make = (e) => ({ params: e.params });", needle: "e.params", binding: "e" },
  { source: "const e = false; const update = () => set((e) => !e);", needle: "!e", binding: "e" },
  {
    source: 'const f = "/page"; const getters = { originalPathname: () => f };',
    needle: "f };",
    binding: "f",
  },
])(
  "tracks references selected inside nested expressions: $source",
  async ({ source, needle, binding }) => {
    const file = "/virtual/nested.js";
    const start = source.indexOf(needle);
    const end = start + (needle === "f };" ? 1 : needle.length);
    const result = await new DependencyTracker({ virtualFiles: { [file]: source } }).track({
      entryFile: file,
      startPoint: { start, end },
    });
    const expectedStart = source.indexOf(
      binding,
      source.includes("(e)") ? source.lastIndexOf("(e)") : 0,
    );
    expect(
      result.nodes.some(
        (node) =>
          node.kind === (binding === "f" ? "global" : "parameter") &&
          node.range.start <= expectedStart &&
          node.range.end > expectedStart,
      ),
    ).toBe(true);
    if (needle === "!e") {
      expect(
        result.nodes.some((node) => node.kind === "global" && node.label.includes("false")),
      ).toBe(false);
    }
  },
);

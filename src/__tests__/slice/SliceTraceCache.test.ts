import { parseSource } from "@/__tests__/utils";
import { SliceTraceCache } from "@/slice/SliceTraceCache";
import type { CachedSliceTrace } from "@/slice/SliceTraceCache";
import { expect, test } from "vitest";

const trace: CachedSliceTrace = {
  slice: {
    nodes: [
      {
        id: "root",
        file: "/a.js",
        range: { start: 0, end: 4 },
        label: "seed",
        kind: "start-point",
        shaken: false,
      },
    ],
    edges: [],
    visitedRanges: new Set(["root"]),
  },
  issues: [],
};

test("evicts the least recently used graph and skips graphs beyond the byte budget", () => {
  const cache = new SliceTraceCache({ maxEntries: 2, maxBytes: 10_000 });
  cache.write("a", trace);
  cache.write("b", trace);
  expect(cache.read("a")).toBeDefined();
  cache.write("c", trace);
  expect(cache.read("b")).toBeUndefined();
  expect(cache.read("a")).toEqual(trace);
  expect(cache.stats()).toMatchObject({ entries: 2, evictions: 1 });
  const peak = cache.stats();
  expect(peak.peakEntries).toBe(2);
  expect(peak.peakBytes).toBeGreaterThan(0);
  cache.synchronize(new Map([["/a.js", parseSource("const a=1;", "/a.js")]]));
  expect(cache.stats()).toMatchObject({
    entries: 0,
    bytes: 0,
    peakEntries: 2,
    peakBytes: peak.peakBytes,
  });
  const small = new SliceTraceCache({ maxBytes: 1 });
  small.write("large", trace);
  expect(small.stats()).toMatchObject({ entries: 0, bytes: 0 });
  const weight = new SliceTraceCache();
  weight.write("a", trace);
  const bounded = new SliceTraceCache({ maxBytes: weight.stats().bytes });
  bounded.write("a", trace);
  bounded.write("b", trace);
  expect(bounded.read("a")).toBeUndefined();
  expect(bounded.stats()).toMatchObject({ entries: 1, evictions: 1 });
  expect(bounded.stats().bytes).toBeLessThanOrEqual(weight.stats().bytes);
});

test("invalidates graphs for changed ASTs, changed source, added files, and removed files", () => {
  const cache = new SliceTraceCache();
  const first = parseSource("const a=1;", "/a.js");
  const sources = new Map([["/a.js", first]]);
  cache.synchronize(sources);
  cache.write("a", trace);
  cache.synchronize(new Map(sources));
  expect(cache.read("a")).toBeDefined();
  sources.set("/a.js", parseSource("const a=1;", "/a.js"));
  cache.synchronize(sources);
  expect(cache.read("a")).toBeUndefined();
  cache.write("a", trace);
  sources.get("/a.js")!.source = "const a=2;";
  cache.synchronize(sources);
  expect(cache.stats().entries).toBe(0);
  cache.write("a", trace);
  sources.set("/b.js", parseSource("const b=2;", "/b.js"));
  cache.synchronize(sources);
  expect(cache.stats().entries).toBe(0);
  cache.write("a", trace);
  sources.delete("/b.js");
  cache.synchronize(sources);
  expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
});

test("detaches cache storage and every returned graph from caller mutations", () => {
  const cache = new SliceTraceCache();
  const input = structuredClone(trace);
  cache.write("a", input);
  input.slice.nodes[0]!.label = "changed before read";
  const first = cache.read("a")!;
  first.slice.nodes[0]!.range.start = 99;
  first.slice.visitedRanges.clear();
  first.slice.edges.push({ from: "bad", to: "bad", kind: "data-flow" });
  expect(cache.read("a")).toEqual(trace);
});

test("does not attach an occurrence whose start ID already belongs to a dependency", () => {
  const cache = new SliceTraceCache();
  const graph = structuredClone(trace);
  const dependency = {
    ...graph.slice.nodes[0]!,
    id: "dependency",
    kind: "global",
    range: { start: 10, end: 20 },
  } satisfies CachedSliceTrace["slice"]["nodes"][number];
  graph.slice.nodes.push(dependency);
  graph.slice.edges.push({ from: "root", to: "dependency", kind: "data-flow" });
  cache.write("binding", graph);
  expect(cache.read("binding", { ...dependency, kind: "start-point" })).toBeUndefined();
  expect(cache.stats().hits).toBe(0);
});

test.each([{ maxEntries: 0 }, { maxBytes: 0 }])("supports disabling reuse: %j", (limits) => {
  const cache = new SliceTraceCache(limits);
  cache.write("a", trace);
  expect(cache.read("a")).toBeUndefined();
  expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0, hits: 0 });
});

test.each([-1, 1.5, Infinity, NaN])("rejects invalid cache limits: %s", (limit) => {
  expect(() => new SliceTraceCache({ maxEntries: limit })).toThrow(RangeError);
  expect(() => new SliceTraceCache({ maxBytes: limit })).toThrow(RangeError);
});

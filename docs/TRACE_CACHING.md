# Dependency analysis caching

Reuse a `DependencyTracker` for repeated selections in one immutable project.
It retains computed graphs and per-file preprocessing independently:

| Cache              | Configuration        | Default limits                      | Reused work                                                   |
| ------------------ | -------------------- | ----------------------------------- | ------------------------------------------------------------- |
| Computed traces    | `traceCache`         | 128 keys, 8 MiB estimated data      | Completed backward graphs and crawl issues                    |
| File preprocessing | `preprocessingCache` | 128 files, 8 MiB estimated metadata | Module discovery, plugin decisions and dynamic-pattern issues |

Both use LRU: successful reads refresh recency and insertion evicts the least
recently used keys until both limits fit. Oversized entries are computed normally
and skipped for retention. Either limit set to zero disables that cache; invalid
limits throw `RangeError`. Each tracker owns its caches.

```ts
const tracker = new DependencyTracker({
  traceCache: { maxEntries: 128, maxBytes: 8 * 1024 * 1024 },
  preprocessingCache: { maxEntries: 128, maxBytes: 8 * 1024 * 1024 },
});

await tracker.track(request);
console.log(tracker.getTraceCacheStats());
console.log(tracker.getPreprocessingCacheStats());
```

## Reuse and correctness

Exact graph keys include the entry file, selection range and shaking option.
Conservative binding reuse can attach a previously computed variable graph to a
new occurrence when the lexical binding and containing function match. Calls,
parameters, unresolved names and wider expressions retain their own selection
identities. Binding reuse requires `shake: false` and excludes unsafe graph or
issue overlaps. Returned graphs and issues are detached from retained data.
Output assembly still runs for each output request.

Preprocessing records each file's resolved ESM/CommonJS dependencies, module-call
plugin results (including unclaimed calls), and file-wide dynamic-pattern issues.
A warm selection traverses the saved dependency lists and replays cloned issues
in discovery order. It avoids repeating module-discovery and detection AST walks
for retained files. Slice-specific issues are collected separately, so replay
does not mix issues from different selections.

Partial or blocked graphs remain reusable: caching preserves their unresolved
nodes and reasons. Failed operations that throw do not create completed cache
entries. No module IDs or framework signatures are introduced by these caches.

## Snapshot lifetime and memory

Computed graphs invalidate when the parsed file set, source text or AST identities
change. File preprocessing validates the source text and AST identity for each
file. Parser and resolver caches are not filesystem watchers: create a new tracker
and `ProjectContext` when source files, resolver settings or plugin behavior change.
Plugins must return deterministic decisions for the same source snapshot.

The limits estimate derived metadata and graph retention; they are not total
process memory limits. File metadata shares the parser's source and AST instead
of cloning them. Parsed files, resolver indexes, output editors and other project
state have separate lifetimes.

## Statistics

`getTraceCacheStats()` returns a detached snapshot:

- `hits`: exact and binding graph reuse.
- `bindingHits`: hits attached to another occurrence of the same safe binding.
- `misses`: requests needing a new backward crawl.
- `entries`, `bytes`: current retention and estimated size.
- `peakEntries`, `peakBytes`: lifetime retention peaks.
- `evictions`: entries removed to satisfy capacity limits.

`getPreprocessingCacheStats()` returns `hits`, `misses`, `entries`, `bytes` and
`evictions` for per-file metadata. Its byte estimate excludes shared sources and
ASTs. Invalidation does not count as a capacity eviction. Disabled caches still
count misses, enabling comparisons with cached runs.

Regression coverage is in `src/__tests__/tracker/trace-cache.test.ts`,
`preprocessing-cache.test.ts` and `FileAnalysisCache.test.ts`.

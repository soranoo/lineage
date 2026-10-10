# Changelog

All notable changes to Lineage are documented here.

## Unreleased

### Added

- Bounded per-file module discovery, plugin decision and dynamic-pattern issue
  caching with `TrackerConfig.preprocessingCache` and
  `DependencyTracker.getPreprocessingCacheStats()`.
- Computed dependency trace caching with bounded LRU eviction, safe reuse of
  repeated variable bindings, configurable `TrackerConfig.traceCache` limits,
  and `DependencyTracker.getTraceCacheStats()`. See the
  [caching guide](docs/TRACE_CACHING.md) for defaults, invalidation, and metrics.

## 2.0.0

### Breaking Changes

- Sliced file output is now opt-in for `DependencyTracker.track()`. When
  `output` is omitted, `result.files` is an empty `Map` and no editor pass is
  performed. Pass `output: { mode: "blank" }` to retain the previous behavior.

### Added

- Exported `assembleSlicedOutput` for assembling and merging dependency and
  usage nodes from multiple tracker calls into one sliced output per file.

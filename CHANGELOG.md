# Changelog

All notable changes to Lineage are documented here.

## 2.0.0

### Breaking Changes

- Sliced file output is now opt-in for `DependencyTracker.track()`. When
  `output` is omitted, `result.files` is an empty `Map` and no editor pass is
  performed. Pass `output: { mode: "blank" }` to retain the previous behavior.

### Added

- Exported `assembleSlicedOutput` for assembling and merging dependency and
  usage nodes from multiple tracker calls into one sliced output per file.

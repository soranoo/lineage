# Upgrade Guide

## Upgrading to 2.0.0

Version 2.0.0 changes sliced file generation from implicit to opt-in for
`DependencyTracker.track()`.

### Breaking change: output is opt-in

Before 2.0.0, omitting `output` assembled blank-mode sliced files:

```ts
const result = await tracker.track({
  entryFile,
  startPoint,
});

const source = result.files.get(entryFile)?.ms.toString();
```

In 2.0.0, omitting `output` returns an empty `result.files` map and skips
`MagicString` output assembly. Add an explicit output mode anywhere your
application reads `result.files`:

```ts
const result = await tracker.track({
  entryFile,
  startPoint,
  output: { mode: "blank" },
});
```

Use `mode: "compact"` when removed code should be excised instead of replaced
with spaces.

### New: merge output from multiple tracking calls

`assembleSlicedOutput` is now exported for callers that accumulate dependency
or usage nodes across several calls and want to edit each file once:

```ts
import { assembleSlicedOutput } from "@soranoo/lineage";

const files = assembleSlicedOutput(
  [...dependencyResult.nodes, ...usageResult.nodes],
  parsedFiles,
  "blank",
  shouldKeepNode,
);
```

The function groups nodes by file and merges their keep ranges before applying
the selected output mode. See the [README API reference](../README.md#assembleslicedoutput)
for the full signature.

### Migration checklist

- [ ] Add `output: { mode: "blank" }` to calls that consume `result.files`.
- [ ] Keep `output` omitted for calls that only need graph nodes, edges, or issues.
- [ ] Use `assembleSlicedOutput` when combining nodes from independent tracking
  calls before generating source output.
- [ ] Review any code that assumes `result.files` is populated after every call.

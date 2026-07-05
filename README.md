# lineage

Project starts on 17-05-2026

[![GPL-3.0 License](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE) &nbsp;&nbsp;&nbsp;[![Sponsorship](https://img.shields.io/static/v1?label=Sponsor&message=❤️&style=social)](https://github.com/soranoo/Donation)

Follow the lineage of any value, across every file.

Give me a ⭐ if you like it.

---

## 📖 Table of Contents

- [✨ Features](#-features)
- [🚀 Getting Started](#-getting-started)
- [⚙️ How It Works](#️-how-it-works)
- [📦 API Reference](#-api-reference)
  - [DependencyTracker](#dependencytracker)
  - [offsetFromLineCol](#offsetfromlinecol)
  - [TrackResult](#trackresult)
  - [nodes](#nodes--dependencynode)
  - [edges](#edges--dependencyedge)
  - [issues](#issues--trackerissue)
  - [files](#files--slicedfile)
  - [Error Types](#error-types)
- [⭐ TODO](#-todo)
- [🐛 Known Issues](#-known-issues)
- [🤝 Contributing](#-contributing)
- [⚠️ Disclaimer](#-disclaimer)
- [📝 License](#-license)
- [☕ Sponsorship](#-sponsorship)

---

## ✨ Features

- **Backward dependency slicing**: given any statement or expression as a start point, Lineage traces every variable, function, parameter, and import that could influence its value
- **Cross-file analysis**: follows `import` and `re-export` chains across your entire codebase, not just a single file
- **Intra-function tree shaking**: statements inside a dependency function that do not contribute to its return value are identified and flagged separately
- **Ignore patterns**: exclude folders or files from recursion using strings or RegExp (e.g. `generated/`, `/vendor/`); `node_modules` is always excluded implicitly
- **Unresolved dependency reporting**: when a binding cannot be traced to a definition, Lineage keeps a placeholder leaf node in the graph instead of silently dropping it
- **Dynamic pattern detection**: `eval`, computed properties, indirect calls, `arguments`, and other statically unresolvable patterns are detected and reported with the conservative action taken
- **Dual output modes**: `blank` mode preserves original character offsets (ideal for source-map-adjacent tooling); `compact` mode removes non-dependency code entirely
- **Reusable tracker instance**: one `DependencyTracker` instance caches parsed files across multiple `track()` calls, making repeated analysis cheap
- **Structured graph output**: `nodes`, `edges`, and `issues` are all first-class typed objects, ready to feed into a relationship graph, visualiser, or further static analysis pipeline

---

## 🚀 Getting Started

### Installation

```bash
npm install @soranoo/lineage
```

> [!TIP]\
> Replace `npm` with `bun`, `yarn` or `pnpm` if you prefer those package managers.

### Basic usage

```ts
import { DependencyTracker, offsetFromLineCol } from "@soranoo/lineage";

const source = `
const globalA = 0;

function a(b, c) {
    return c + 2 * b + globalA;
}
function b(c, d) {
    return a(c, d);
}
function c(d, e) {
    const t = d + 5;
    return b(t, e);
}

const result = c(5, 6);
`.trimStart();

// Convert a human-friendly line/col into the offset Lineage needs
const start = offsetFromLineCol(source, 11, 5); // line 11, col 5 -> "return b(t, e);"
const end   = offsetFromLineCol(source, 11, 20);

const tracker = new DependencyTracker();

const result = await tracker.track({
  entryFile: "/project/src/main.ts",
  startPoint: { start, end },
  output: { mode: "blank" }, // "blank" (default) | "compact"
});

// Sliced source — non-dependency lines are blanked out
console.log(result.files.get("/project/src/main.ts")?.ms.toString());

// Dependency graph nodes
console.log(result.nodes);

// Directed edges between nodes
console.log(result.edges);

// Issues (unresolved deps, dynamic patterns, ignored paths)
console.log(result.issues);
```

### With ignore patterns

```ts
const tracker = new DependencyTracker({
  // Stop recursing into these paths — they become leaf nodes in the graph
  ignorePatterns: [
    "/project/src/generated/", // string: tested with path.includes()
    /\/vendor\//,              // RegExp: tested with pattern.test()
  ],
});
```

> [!NOTE]\
> `node_modules` is always an implicit ignore pattern regardless of what you pass to `ignorePatterns`. You never need to add it manually.

### Reusing a tracker across multiple analyses

```ts
const tracker = new DependencyTracker();

// First call — parses and caches all files it touches
const result1 = await tracker.track({ entryFile: "/project/src/main.ts", startPoint: { start: 10, end: 40 } });

// Second call — cached files are reused; only new files are parsed
const result2 = await tracker.track({ entryFile: "/project/src/main.ts", startPoint: { start: 55, end: 90 } });
```

> [!TIP]\
> Each `track()` call returns an independent `TrackResult`. Results never bleed into each other — issues, nodes, and `MagicString` instances are all fresh per call.

---

## ⚙️ How It Works

Lineage runs five phases every time `track()` is called:

```mermaid
flowchart TD
    A([track called]) --> B

    B["🌱 **Phase 0 - Bootstrap**: Parse entry file. Locate seed AST node at startPoint offset."]
    B --> C

    C["🔍 **Phase 1 - Seed Expansion**: Extract initial binding names from the seed node."]
    C --> D

    D["⛏️ **Phase 2 - Backward Slice**: Worklist algorithm - follow every binding across functions, closures, and file imports until all upstreams are resolved."]
    D --> E

    E["✂️ **Phase 3 - Intra-function Shaking**: For each dependency function: identify statements not on any path to return. Mark them shaken: true."]
    E --> F

    F["✏️ **Phase 4 - Edit**: Apply blank or compact edits to each file's MagicString."]
    F --> G

    G["📦 **Phase 5 - Assemble**: Build TrackResult: nodes, edges, issues, files."]
    G --> H([TrackResult returned])

    style A fill:transparent,stroke:transparent
    style H fill:transparent,stroke:transparent
```

### Cross-file resolution

When the worklist encounters an import, it resolves the specifier using `oxc-resolver` and checks the result against the ignore filter before recursing:

```mermaid
flowchart TD
    A([Import binding encountered]) --> B{Resolve specifier\nvia oxc-resolver}

    B -->|resolved| C{Path matches\nignore pattern?}
    B -->|failed| D[Add unresolved-leaf node\nEmit unresolved-dependency issue\n⛔ Stop]

    C -->|yes — node_modules\nor custom pattern| E[Add ignored-leaf node\nKeep ImportDeclaration in slice\nEmit ignored-path issue\n⛔ Stop]
    C -->|no| F[Parse target file\nFind exported binding]

    F --> G{Binding found\nin target file?}
    G -->|no| H[Add unresolved-leaf node\nEmit unresolved-dependency issue\n⛔ Stop]
    G -->|yes| I[Enqueue binding\nin worklist\n✅ Continue]

    style A fill:transparent,stroke:transparent
    style D fill:transparent,stroke:transparent
    style E fill:transparent,stroke:transparent
    style H fill:transparent,stroke:transparent
    style I fill:transparent,stroke:transparent
```

### Output graph shape

For a simple three-function chain (`c` calls `b`, `b` calls `a`), the graph Lineage produces looks like this:

```mermaid
graph LR
    SP([start-point\nreturn b t e]):::sp

    SP -->|call| B([function b]):::fn
    SP -->|data-flow| T([variable t]):::var
    SP -->|data-flow| E([parameter e]):::param

    B -->|call| A([function a]):::fn
    B -->|param-bind| PC([parameter c of b]):::param
    B -->|param-bind| PD([parameter d of b]):::param

    T -->|data-flow| D([parameter d of c]):::param

    A -->|data-flow| G([global globalA]):::global

    classDef sp     fill:#7F77DD,color:#fff,stroke:none
    classDef fn     fill:#5DCAA5,color:#fff,stroke:none
    classDef var    fill:#F0997B,color:#fff,stroke:none
    classDef param  fill:#888780,color:#fff,stroke:none
    classDef global fill:#E8C547,color:#222,stroke:none
```

> [!NOTE]\
> `const result = c(5, 6)` does **not** appear in the graph. Lineage traces backward from the start point — consumers of a value are never included, only producers.

---

## 📦 API Reference

### `DependencyTracker`

The only exported class. Create one instance per project configuration and reuse it across multiple `track()` calls.

```ts
const tracker = new DependencyTracker(config?: TrackerConfig);
```

**`TrackerConfig`**

| Field | Type | Default | Description |
|---|---|---|---|
| `resolver` | `OxcResolverOptions` | `undefined` | Options forwarded verbatim to `oxc-resolver`. Defaults to Node.js ESM + CJS resolution with automatic `tsconfig.json` detection. |
| `ignorePatterns` | `Array<string \| RegExp>` | `[]` | Paths to treat as leaf nodes. Strings are matched with `path.includes(pattern)`, RegExps with `pattern.test(path)`. `node_modules` is always implicitly included. |

**`tracker.track(request)`**

```ts
const result = await tracker.track(request: TrackRequest): Promise<TrackResult>
```

**`TrackRequest`**

| Field | Type | Default | Description |
|---|---|---|---|
| `entryFile` | `string` | required | Absolute path to the file containing the start point. |
| `startPoint` | `OffsetRange` | required | 0-based character offset range of the start-point node. Use `offsetFromLineCol()` to convert from line/col. |
| `output.mode` | `"blank" \| "compact"` | `"blank"` | `blank` — replaces removed code with spaces, preserving original offsets. `compact` — excises removed code, producing shorter output. |

> [!IMPORTANT]\
> `StartPointNotFoundError` is thrown if the `startPoint` offset range does not correspond to any AST node in `entryFile`.

---

### `offsetFromLineCol`

A standalone helper that converts a human-readable 1-based line/column position into a 0-based character offset, which is what `startPoint` expects.

```ts
import { offsetFromLineCol } from "@soranoo/lineage";

const offset = offsetFromLineCol(
  source, // the raw source string
  11,     // line (1-based)
  5,      // column (1-based)
);
```

> [!CAUTION]\
> Throws `RangeError` if `line` or `col` is out of range for the given source string.

---

### `TrackResult`

The object returned by `tracker.track()`. All four fields are always present.

```ts
interface TrackResult {
  nodes:  DependencyNode[];
  edges:  DependencyEdge[];
  issues: TrackerIssue[];
  files:  Map<string, SlicedFile>;
}
```

---

### `nodes` — `DependencyNode[]`

Every AST node that is part of the dependency slice, across all files.

```ts
interface DependencyNode {
  id:      string;          // stable unique ID: "<absolutePath>:<start>:<end>"
  file:    string;          // absolute path of the file this node lives in
  range:   OffsetRange;     // { start: number; end: number } — 0-based, exclusive end
  label:   string;          // human-readable source excerpt
  kind:    DependencyKind;  // see table below
  shaken:  boolean;         // true = inside a dependency function but not on the return path
}
```

**`DependencyKind` values**

| Value | Meaning |
|---|---|
| `"start-point"` | The marked node itself |
| `"variable"` | A `const` / `let` / `var` declaration |
| `"parameter"` | A function parameter |
| `"function"` | An entire function declaration or expression |
| `"call-site"` | A specific call expression within a function |
| `"import"` | An `import` declaration |
| `"global"` | A module-level binding outside any function |
| `"re-export"` | A re-export that transitively brings in a dependency |
| `"ignored-leaf"` | A binding whose resolved file matched an ignore pattern — not recursed into |
| `"unresolved-leaf"` | A binding with no findable definition — kept as a placeholder |

> [!NOTE]\
> Nodes with `shaken: true` are still present in `nodes` so you can see exactly what was inside a dependency function but did not contribute to its return value. They are blanked/removed in the sliced output.

---

### `edges` — `DependencyEdge[]`

Directed edges describing how dependency nodes relate to each other.

```ts
interface DependencyEdge {
  from: string;    // DependencyNode.id — the upstream node
  to:   string;    // DependencyNode.id — the downstream node
  kind: EdgeKind;
}
```

**`EdgeKind` values**

| Value | Meaning |
|---|---|
| `"data-flow"` | The value of `from` is read by `to` |
| `"call"` | `to` calls `from` |
| `"param-bind"` | An argument at a call site binds to a parameter |
| `"closure"` | `to` closes over the binding `from` |
| `"import"` | `to` imports the binding `from` |

---

### `issues` — `TrackerIssue[]`

Reported when Lineage encounters something it cannot fully resolve statically, or when a path is ignored or unresolvable. The tracker always takes a conservative action and records it here so you can decide what to do downstream.

```ts
interface TrackerIssue {
  kind:            IssueKind;
  message:         string;               // human-readable description
  file:            string;               // absolute path where the issue was found
  range:           OffsetRange;          // location of the problematic node
  resolution:      "included"            // node kept in slice despite uncertainty
                 | "leaf"               // node kept as a non-recursed leaf
                 | "flagged-only";      // noted but slice unchanged
  matchedPattern?: string | RegExp;     // set on "ignored-path" issues only
}
```

**`IssueKind` values**

| Value | Trigger | Conservative action |
|---|---|---|
| `"unresolved-dependency"` | Binding not found in any file | Kept as `"unresolved-leaf"` |
| `"ignored-path"` | Resolved path matched an ignore pattern | Kept as `"ignored-leaf"`; `matchedPattern` is set |
| `"dynamic-import"` | `import(expr)` with non-literal specifier | Kept as leaf; no recursion |
| `"computed-property"` | `obj[expr]` — property name unknown | Full object bindings included |
| `"eval"` | `eval(...)` call | Entire enclosing scope included |
| `"arguments-object"` | Use of `arguments` inside a function | All parameters treated as on-path |
| `"rest-spread-unknown"` | `...spread` of unknown shape | Spread source binding included |
| `"indirect-call"` | `const f = getFn(); f()` | Kept as leaf; no recursion into callee |
| `"prototype-mutation"` | `Foo.prototype.x = ...` | Flagged only — cannot trace all instances |
| `"this-call"` | `this.method()` — receiver unknown | Call included; receiver flagged |

> [!WARNING]\
> An issue does not mean the slice is wrong — it means the slice may be over-inclusive in that area. Always check `resolution` to understand what action was taken.

---

### `files` — `Map<string, SlicedFile>`

A map from absolute file path to the edited source for that file. Only files that contributed at least one dependency node appear here.

```ts
interface SlicedFile {
  path:           string;       // absolute file path (same as the map key)
  ms:             MagicString;  // the edited source — call .toString() to get the string
  originalSource: string;       // the original unmodified source
}
```

```ts
// Get the sliced source for the entry file
const sliced = result.files.get("/project/src/main.ts");

console.log(sliced?.ms.toString());       // edited source
console.log(sliced?.originalSource);      // original source — always unchanged
```

> [!NOTE]\
> In `blank` mode the edited string is the same length as the original. In `compact` mode it is shorter. The `MagicString` instance is independent per `track()` call — mutating it does not affect subsequent calls.

---

### Error Types

These are thrown at the `track()` boundary. All extend `Error`.

| Class | Thrown when | Extra fields |
|---|---|---|
| `StartPointNotFoundError` | `startPoint` offsets match no AST node in `entryFile` | `file: string`, `requestedRange: OffsetRange` |
| `ParseError` | A file contains syntax errors that prevent parsing | `file: string`, `oxcErrors: unknown[]` |
| `CyclicResolutionError` | A resolution cycle bypassed the visited-set guard (should not occur in normal use) | `cycle: string[]` — the absolute paths forming the cycle |

```ts
import {
  DependencyTracker,
  StartPointNotFoundError,
  ParseError,
} from "@soranoo/lineage";

try {
  const result = await tracker.track({ ... });
} catch (e) {
  if (e instanceof StartPointNotFoundError) {
    console.error(`No AST node found at offset ${e.requestedRange.start}–${e.requestedRange.end} in ${e.file}`);
  } else if (e instanceof ParseError) {
    console.error(`Syntax error in ${e.file}`, e.oxcErrors);
  } else {
    throw e;
  }
}
```

> [!TIP]\
> For full TypeScript type definitions, see [`src/types.ts`](src/types.ts).

---

## ⭐ TODO

- n/a

## 🐛 Known Issues

- n/a

## 🤝 Contributing

Contributions are welcome! If you find a bug or have a feature request, please open an issue. If you want to contribute code, please fork the repository and run
`bun run fmt` & `deno run typecheck` & `deno test` before submitting a pull request.

We are following [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages.

## ⚠️ Disclaimer

AI is used to assist in the development of this project, including

- Idea and knowledge reinforcement
- Inline code completion
- Code refactoring suggestions
- Code review and feedback
- Code generation for boilerplate and repetitive tasks

## 📝 License

This project is licensed under the GPL-3.0 License - see the [LICENSE](LICENSE) file for details

## ☕ Sponsorship

Love it? Consider a sponsorship to support my work.

[!["Sponsorship"](https://raw.githubusercontent.com/soranoo/Donation/main/resources/image/DonateBtn.png)](https://github.com/soranoo/Donation) <- click me~

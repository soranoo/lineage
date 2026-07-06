# Coding Standards

> [!IMPORTANT]\
> Standards that apply to every file, every task, and every contribution to Lineage.
> Breaking any rule below is a bug regardless of whether tests pass.

---

## 📖 Table of Contents

- [🛠️ Stack and Tooling](#️-stack-and-tooling)
  - [Path Alias](#path-alias---src)
  - [Import Order](#import-order)
- [📐 Language Rules](#-language-rules)
  - [No `any`](#no-any)
  - [Arrow Functions Only](#arrow-functions-only-applicable-to-typescript-files-only)
  - [No `as` Type Assertions](#no-as-type-assertions)
  - [Type Aliases for Primitives](#type-aliases-for-primitives)
- [🔀 Control Flow Rules](#-control-flow-rules)
  - [switch over if/else](#switch-over-ifelse)
  - [assert-never in Every Default](#assert-never-in-every-default)
- [🧱 Architecture Rules](#-architecture-rules)
  - [OOP and SOLID](#oop-and-solid)
  - [neverthrow for Fallible Operations](#neverthrow-for-fallible-operations)
- [📝 Documentation Rules](#-documentation-rules)
  - [JSDoc is Mandatory](#jsdoc-is-mandatory)
  - [Inline Comments for Complex Logic](#inline-comments-for-complex-logic)
- [🧪 Testing Rules](#-testing-rules)
  - [Tests Before Implementation](#tests-before-implementation)
  - [Test File Locations](#test-file-locations)
  - [No Mocking Libraries](#no-mocking-libraries)
  - [No Snapshot Tests](#no-snapshot-tests)
- [📁 File and Folder Conventions](#-file-and-folder-conventions)
  - [Naming Conventions](#naming-conventions)

---

## 🛠️ Stack and Tooling

| Tool | Purpose | Notes |
|---|---|---|
| **Bun** | Runtime, package manager, test runner | Use `bun` only, not `node` or `npm` |
| **Vitest** | Test framework | Config in `vitest.config.ts` |
| **oxc-parser** | AST parsing |  |
| **oxc-resolver** | Module resolution | Wraps Node.js ESM and CJS algorithm |
| **magic-string** | Source editing | Used only in `MagicStringEditor` |
| **assert-never** | Exhaustiveness checking | Required in every finite union `switch` default case |
| **neverthrow** | Result type | Use `Result<T, E>` for fallible internal operations |

### Path Alias `@/` = `src/`

All imports that cross folder boundaries must use the `@/` alias. Relative paths across folders are banned. The only exception is a same-folder import of one segment (`./name`).

```ts
// correct - alias for any cross-folder import
import type { OffsetRange } from "@/types";
import { OxcParser }        from "@/parse/OxcParser";
import { IssueCollector }   from "@/issues/IssueCollector";

// acceptable - same folder, one segment only
import { buildNodeId } from "./nodeId";

// banned - relative path crossing a folder boundary
import type { OffsetRange } from "../../types";
import { OxcParser }        from "../parse/OxcParser";
```

### Import Order

All imports follow this order, with a blank line between each group:

```ts
// Group 1 - Node / Bun built-ins
import path from "node:path";

// Group 2 - Third-party packages
import MagicString     from "magic-string";
import { assertNever } from "assert-never";
import { ok, err }     from "neverthrow";

// Group 3 - Internal types only (always type-only import, always @/ alias)
import type { OffsetRange, TrackerIssue } from "@/types";

// Group 4 - Internal values (@/ alias)
import { IssueCollector } from "@/issues/IssueCollector";
import { IgnoreFilter }   from "@/resolve/IgnoreFilter";
```

Additional rules:

- Type-only imports always use `import type { ... }`. Never mix types and values in one import statement.
- Named exports only for internal modules - no default imports from `src/`.
- The `@/` alias applies to all cross-folder internal imports (see above).

---

## 📐 Language Rules

### No `any`

TypeScript's `any` type is banned. Use `unknown` for truly opaque values and narrow explicitly. If a type is missing, add it to `src/types.ts`.

```ts
// banned
const parse = (input: any) => { ... };

// correct
const parse = (input: unknown) => {
  if (typeof input !== "string") throw new TypeError("...");
  ...
};
```

### Arrow Functions Only (Applicable to TypeScript Files Only)

Use `const` arrow functions for all standalone functions and class methods when dealing with TypeScript. Function declarations are banned with two narrow exceptions:

- **Generator functions** - arrow generators do not exist in JavaScript, so `function*` is required.
- **Cases where hoisting is explicitly required** - it is rare; add a comment on the line directly above explaining why.

```ts
// correct - module-level helper
export const offsetFromLineCol = (
  source: SourceText,
  line: number,
  col: number,
): CharOffset => {
  ...
};

// correct - inline callback
const ids = nodes.map((n) => n.id);

// correct - class method as arrow property (lexical `this`, no rebinding risk)
class IssueCollector {
  /** Appends `issue` to the internal list. */
  readonly add = (issue: TrackerIssue): void => {
    this.issues.push(issue);
  };
}

// banned - function declaration at module level
export function offsetFromLineCol(source: string, line: number): number { ... }

// banned - traditional method syntax in a class
class IssueCollector {
  add(issue: TrackerIssue): void { ... }
}
```

When a `function` keyword genuinely cannot be avoided, add a comment on the line immediately above:

```ts
// Generator - arrow syntax does not support function* in JavaScript
function* walkNodes(root: AstNode): Generator<AstNode> { ... }
```

### No `as` Type Assertions

TypeScript `as` casts are banned except at the `oxc-parser` and `oxc-resolver` API boundaries where the external library type does not match the internal `ParsedFile` or `ResolveResult` shapes. When used at those boundaries, add an inline `//` comment on the same line explaining why.

```ts
// banned
const node = result as AstNode;

// acceptable at an oxc boundary only
const ast = rawResult.program as OxcProgram; // oxc-parser returns untyped program field
```

### Type Aliases for Primitives

Never use raw `string` or `number` in function signatures or field declarations where a named alias would make the intent clear. All aliases live in `src/types.ts` and are imported from `@/types`.

**Aliases defined in `src/types.ts`, always use these, never the raw primitive:**

```ts
/** An absolute file system path starting with `/`. */
type AbsolutePath = string;

/**
 * A stable unique identifier for a `DependencyNode`.
 * Format: `"<absolutePath>:<start>:<end>"`.
 */
type NodeId = string;

/** A 0-based character offset into a source string. */
type CharOffset = number;

/** One entry from `TrackerConfig.ignorePatterns`. */
type IgnorePattern = string | RegExp;

/** Raw source code text of a JavaScript or TypeScript file. */
type SourceText = string;
```

When introducing a new primitive-backed concept, add its alias to `src/types.ts` first, then use the alias everywhere.

```ts
// banned - opaque raw primitives at call sites
const buildId = (path: string, start: number, end: number): string => ...

// correct - self-documenting aliases
const buildId = (path: AbsolutePath, start: CharOffset, end: CharOffset): NodeId => ...
```

---

## 🔀 Control Flow Rules

### `switch` over `if/else`

Whenever branching on a finite set of known values (union type members, enum values, string literal sets, AST node types, etc.) use a `switch` statement. `if/else` chains over finite sets are banned.

```ts
// banned
if (kind === "resolved") {
  ...
} else if (kind === "ignored") {
  ...
} else if (kind === "failed") {
  ...
}

// correct
switch (kind) {
  case "resolved": ...  break;
  case "ignored":  ...  break;
  case "failed":   ...  break;
  default: assertNever(kind);
}
```

### `assert-never` in Every Default

Every `switch` over a finite union must have a `default` case that calls `assertNever(x)` from the `assert-never` package. This enforces exhaustiveness at compile time. There are no exceptions.

```ts
import { assertNever } from "assert-never";

switch (node.kind) {
  case "variable":  handleVariable(node);  break;
  case "function":  handleFunction(node);  break;
  case "parameter": handleParameter(node); break;
  // ... all members listed
  default: assertNever(node.kind);
}
```

If a new member is added to the union and any `switch` is not updated, TypeScript will produce a compile error at the `assertNever` call site, making it impossible to miss.

---

## 🧱 Architecture Rules

### OOP and SOLID

Every class must follow these constraints:

- **Single responsibility**: one class, one job. If a second concern appears, extract a new class.
- **Depend on interfaces, not implementations**: constructor injection is the only accepted DI pattern. No service locators, no singletons, no static stateful methods.
- **`DependencyTracker` is the only exported class** from `src/index.ts`. All other classes are internal and must not be exported.

```ts
// correct - depends on IParser interface, not OxcParser directly
class BackwardSlicer {
  constructor(
    private readonly parser: IParser,
    private readonly resolver: IResolver,
    private readonly shaker: IShaker,
    private readonly issues: IssueCollector,
  ) {}
}

// banned - depends on concrete implementation
class BackwardSlicer {
  constructor(private readonly parser: OxcParser) {}
}
```

### `neverthrow` for Fallible Operations

Fallible internal operations should return `Result<T, E>` from `neverthrow` rather than throwing. The three public error classes (`StartPointNotFoundError`, `ParseError`, `CyclicResolutionError`) are still thrown at the `DependencyTracker.track()` boundary so callers do not need to know about `neverthrow`.

```ts
// correct - internal function returns Result, never throws
const resolveBinding = (name: SourceText): Result<AstNode, UnresolvedError> => {
  ...
};

// correct - public boundary unwraps Result and throws the public error type
const node = resolveBinding(name).match(
  (n) => n,
  (_e) => { throw new StartPointNotFoundError(...); },
);
```

---

## 📝 Documentation Rules

### JSDoc is Mandatory

JSDoc is required on every surface listed below. Absence is a bug, not a style choice.

#### Every type, interface, union, and alias in `src/types.ts`

Document the type itself and every field:

```ts
/**
 * A half-open character offset range within a source file.
 * `start` is inclusive and 0-based; `end` is exclusive.
 */
type OffsetRange = {
  /** Inclusive start offset, 0-based. */
  start: CharOffset;
  /** Exclusive end offset, 0-based. */
  end: CharOffset;
};

/**
 * Discriminated union describing the outcome of resolving an import specifier.
 */
export type ResolveResult =
  | {
      /** Specifier resolved to a project file. */
      kind: "resolved";
      /** Absolute path to the resolved file. */
      absolutePath: AbsolutePath;
    }
  | {
      /** Resolved path matched an ignore pattern. */
      kind: "ignored";
      /** Absolute path to the resolved file. */
      absolutePath: AbsolutePath;
      /** Pattern that caused the match. */
      matchedPattern: IgnorePattern;
    }
  | {
      /** Specifier could not be resolved. */
      kind: "failed";
    };
```

#### Every interface and every method signature within it

```ts
/**
 * Parses JavaScript/TypeScript source files into cached ASTs.
 * Implementors must return the cached result on repeated calls for the same path.
 */
interface IParser {
  /**
   * Parse `source` and cache the result under `absolutePath`.
   * Returns the cached `ParsedFile` on subsequent calls without re-parsing.
   *
   * @param absolutePath - The absolute path of the file being parsed.
   * @param source - The raw source text of the file.
   * @returns The parsed file with its AST.
   * @throws {ParseError} if `source` contains syntax errors.
   */
  readonly parse: (absolutePath: AbsolutePath, source: SourceText) => ParsedFile;

  /**
   * Returns the internal parse cache.
   * The `Map` key is an absolute file path; the value is its `ParsedFile`.
   *
   * @returns The full parse cache.
   */
  readonly getCache: () => Map<AbsolutePath, ParsedFile>;
}
```

#### Every class

State the single responsibility and any important constraints:

```ts
/**
 * Compiles and tests ignore patterns against resolved absolute file paths.
 *
 * Always includes `"node_modules"` as an implicit leading pattern regardless
 * of what is passed to the constructor. Pattern order is preserved; the first
 * match wins.
 */
class IgnoreFilter { ... }
```

#### Every method and arrow property on a class

Included both public and private methods. State the purpose, parameters, return value, and any thrown errors:

```ts
/**
 * Returns the first pattern that matches `absolutePath`, or `null` if none match.
 *
 * @param absolutePath - The absolute file path to test against the compiled patterns.
 * @returns The first matching ignore pattern, or `null` if no pattern matches.
 */
readonly match = (absolutePath: AbsolutePath): IgnorePattern | null => { ... };
```

### Inline Comments for Complex Logic

Any logic block that would require more than one reading to understand must have an inline `//` comment. Explain **why**, not just **what**.

```ts
// Ranges must be sorted in reverse start order so that removing an earlier
// range does not shift the character offsets of later MagicString operations,
// which would silently corrupt the sliced output.
const sorted = [...removeRanges].sort((a, b) => b.start - a.start);
```

Self-evident single-line statements (`return result`, `this.cache = new Map()`) do not need inline comments.

---

## 🧪 Testing Rules

### Tests Before Implementation

For every task, write the test file first and confirm it **fails** (red), then write the implementation until the test **passes** (green). Never write implementation without a corresponding failing test already in place.

### Test File Locations

Test files live under `src/__tests__/` and mirror the source folder structure exactly:

```
src/parse/OxcParser.ts
  -> src/__tests__/parse/OxcParser.test.ts

src/resolve/IgnoreFilter.ts
  -> src/__tests__/resolve/IgnoreFilter.test.ts
```

Folders that do not mirror a `src/` folder are prefixed with `_`:

- `src/__tests__/_fakes/` - shared hand-rolled fakes implementing interfaces
- `src/__tests__/_fixtures/` - real `.ts` source files for pipeline tests

Never create a test file outside `src/__tests__/`.

### No Mocking Libraries

All test doubles are hand-rolled fakes that implement the interface they replace. `vi.mock()`, `vi.spyOn()`, `jest.mock()`, and similar APIs are banned. Fakes live in `src/__tests__/_fakes/` and are imported directly.

**Why fakes over mocks?**

- Mocks couple tests to implementation details (exact method names, call counts, argument shapes). Fakes only require satisfying the interface contract.
- Module-level mocking (e.g. `vi.mock("../parse/OxcParser")`) breaks the dependency inversion principle by making the test aware of the concrete class being replaced.
- Fakes are reusable across the full test suite. If an interface changes, TypeScript immediately reports every broken fake.

A fake looks like this:

```ts
// src/__tests__/_fakes/fake-parser.ts
class FakeParser implements IParser {
  constructor(private readonly responses: Map<AbsolutePath, ParsedFile>) {}

  readonly parse = (absolutePath: AbsolutePath): ParsedFile => {
    const cached = this.responses.get(absolutePath);
    if (!cached) throw new ParseError(absolutePath, []);
    return cached;
  };

  readonly getCache = (): Map<AbsolutePath, ParsedFile> => this.responses;
}
```

### No Snapshot Tests

Assert on specific fields and values explicitly. Snapshot tests are banned because they over-assert and break on unrelated internal changes.

```ts
// correct
expect(result.issues[0].kind).toBe("ignored-path");
expect(result.issues[0].matchedPattern).toEqual(/\/generated\//);
expect(result.nodes).toHaveLength(7);

// banned
expect(result).toMatchSnapshot();
```

---

## 📁 File and Folder Conventions

```
src/
  index.ts                    <- public API only; no logic here
  types.ts                    <- all shared types; imported everywhere via @/types
  tracker/
    DependencyTracker.ts      <- orchestrator (the only exported class)
  parse/
    Parser.ts                 <- IParser interface
    OxcParser.ts              <- implementation
  resolve/
    Resolver.ts               <- IResolver interface
    OxcResolver.ts            <- implementation
    IgnoreFilter.ts           <- pattern matching
  slice/
    Slicer.ts                 <- ISlicer interface
    BackwardSlicer.ts         <- worklist implementation
    SeedExpander.ts           <- phase 1 seed extraction
    BindingResolver.ts        <- scope-aware name to node lookup
  shake/
    Shaker.ts                 <- IShaker interface
    IntraFunctionShaker.ts    <- implementation
  edit/
    Editor.ts                 <- IEditor interface
    MagicStringEditor.ts      <- implementation
  issues/
    IssueCollector.ts         <- issue accumulator
    DynamicPatternDetector.ts <- AST walker for dynamic patterns
  helpers/
    ast-walker.ts             <- pure helper
    offset-from-line-col.ts   <- pure helper

src/__tests__/
  parse/                      <- mirrors src/parse/
  resolve/                    <- mirrors src/resolve/
  slice/                      <- mirrors src/slice/
  shake/                      <- mirrors src/shake/
  edit/                       <- mirrors src/edit/
  issues/                     <- mirrors src/issues/
  helpers/                    <- mirrors src/helpers/
  tracker/                    <- mirrors src/tracker/
  _fakes/                     <- non-mirrored: shared hand-rolled fakes
    FakeParser.test.ts
    FakeParser.ts
    FakeResolver.test.ts
    FakeResolver.ts
    FakeShaker.ts
  _fixtures/                  <- non-mirrored: real source files and pipeline tests
    linear-chain/
    intra-shake/
    cross-file/
    ignored-path/
    unresolved/
    closures-conditionals/
    dynamic-patterns/
    class-async-circular/
    pipeline.fixture.test.ts
    slice-output.fixture.test.ts
    multi-call.fixture.test.ts
```

> [!IMPORTANT]\
> Please always check and update the chart above when creating a new file or folder. The chart is the canonical source of truth for the project structure.

### Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Class or interface file | `PascalCase.ts` | `OxcParser.ts`, `Parser.ts` |
| Pure helper or utility file | `kebab-case.ts` | `offset-from-line-col.ts` |
| Test file | `PascalCase.test.ts` or `kebab-case.test.ts` mirroring the source | `OxcParser.test.ts` |
| Fake file | `fake-<name>.ts` | `fake-parser.ts` |
| Fixture source folder | `kebab-case/` | `linear-chain/` |
| Non-mirrored test folder | `_kebab-case/` | `_fakes/`, `_fixtures/` |

> [!NOTE]\
> The naming rule is simple: if the file's primary export is a class or interface, use `PascalCase.ts`. Everything else uses `kebab-case.ts`. Test files mirror their source file name exactly with `.test.ts` appended.

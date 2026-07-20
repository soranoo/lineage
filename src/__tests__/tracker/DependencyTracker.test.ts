import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import MagicString from "magic-string";
import { describe, expect, it } from "vitest";

import type {
  AbsolutePath,
  CharOffset,
  IIssueCollector,
  IParser,
  IResolver,
  IShaker,
  OffsetRange,
  ParsedFile,
  ResolveResult,
  SourceText,
  TrackerConfig,
  TrackRequest,
  TrackResult,
} from "@/types";

import { offsetFromLineCol } from "@/helpers/offset-from-line-col";
import { IssueCollector } from "@/issues/IssueCollector";
import { OxcParser } from "@/parse/OxcParser";
import { FakeParser } from "@/__tests__/_fakes/FakeParser";
import { FakeResolver } from "@/__tests__/_fakes/FakeResolver";
import { FakeShaker } from "@/__tests__/_fakes/FakeShaker";
import { StartPointNotFoundError } from "@/types";
import { InvalidVirtualPathError } from "@/types";

/**
 * Runtime shape expected from a tracker instance.
 */
type DependencyTrackerInstance = {
  /**
   * Execute dependency tracking for the provided request.
   *
   * @param request Track request describing entry file and start point.
   * @returns Track result for the request.
   */
  readonly track: (request: TrackRequest) => Promise<TrackResult>;
};

/**
 * Dependency overrides accepted by tracker tests.
 */
type TrackerDependencyOverrides = {
  /** Injected parser implementation used by tests. */
  parser?: IParser;
  /** Injected resolver implementation used by tests. */
  resolver?: IResolver;
  /** Injected shaker implementation used by tests. */
  shaker?: IShaker;
  /** Injected issue collector implementation used by tests. */
  issueCollector?: IIssueCollector;
};

/**
 * Constructor signature expected from the DependencyTracker export.
 */
type DependencyTrackerConstructor = new (
  config: TrackerConfig,
  dependencies?: TrackerDependencyOverrides,
) => DependencyTrackerInstance;

/**
 * Source file descriptor used for on-disk fixture setup.
 */
type FixtureFile = {
  /** Relative file path under the temporary fixture root. */
  relativePath: SourceText;
  /** Source text written to the file. */
  source: SourceText;
};

/**
 * Temporary fixture context containing created files and cleanup.
 */
type FixtureContext = {
  /** Absolute temporary root path containing fixture files. */
  rootDir: AbsolutePath;
  /** Relative path to absolute path mapping for fixture files. */
  absolutePaths: Map<SourceText, AbsolutePath>;
  /** Absolute path to source text mapping for fixture files. */
  sourcesByPath: Map<AbsolutePath, SourceText>;
  /** Removes the temporary fixture directory recursively. */
  cleanup: () => void;
};

/**
 * Counts parse invocations while delegating behavior to FakeParser.
 */
class CountingFakeParser implements IParser {
  private readonly fakeParser: FakeParser;
  private parseCount: number;

  /**
   * Create a counting parser over a canned parsed-file cache.
   *
   * @param cache Parsed-file map keyed by absolute path.
   */
  constructor(cache: Map<AbsolutePath, ParsedFile>) {
    this.fakeParser = new FakeParser(cache);
    this.parseCount = 0;
  }

  /**
   * Parse via FakeParser while incrementing the invocation counter.
   *
   * @param absolutePath Absolute file path being parsed.
   * @param source Source text passed through to FakeParser.
   * @returns Parsed file from the fake parser cache.
   */
  readonly parse = (absolutePath: AbsolutePath, source: SourceText): ParsedFile => {
    this.parseCount += 1;
    return this.fakeParser.parse(absolutePath, source);
  };

  /**
   * Return the FakeParser cache.
   *
   * @returns Internal parsed-file cache.
   */
  readonly getCache = (): Map<AbsolutePath, ParsedFile> => this.fakeParser.getCache();

  /**
   * Return how many times parse has been invoked.
   *
   * @returns Parse invocation count.
   */
  readonly getParseCount = (): number => this.parseCount;
}

/**
 * Create temporary files for a test case and provide cleanup metadata.
 *
 * @param files Files to create under a fresh temporary root.
 * @returns Fixture context with absolute paths and cleanup.
 */
const createFixtureContext = (files: FixtureFile[]): FixtureContext => {
  const rootDir: AbsolutePath = mkdtempSync(path.join(tmpdir(), "lineage-tracker-"));
  const absolutePaths = new Map<SourceText, AbsolutePath>();
  const sourcesByPath = new Map<AbsolutePath, SourceText>();

  for (const file of files) {
    const absolutePath: AbsolutePath = path.join(rootDir, file.relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, file.source, "utf8");
    absolutePaths.set(file.relativePath, absolutePath);
    sourcesByPath.set(absolutePath, file.source);
  }

  return {
    rootDir,
    absolutePaths,
    sourcesByPath,
    cleanup: (): void => {
      rmSync(rootDir, { recursive: true, force: true });
    },
  };
};

/**
 * Resolve an absolute fixture path from its relative path.
 *
 * @param fixture Fixture context containing the file maps.
 * @param relativePath Relative fixture path.
 * @returns Absolute path for the fixture file.
 * @throws {Error} When the relative file is missing.
 */
const requireFixturePath = (fixture: FixtureContext, relativePath: SourceText): AbsolutePath => {
  const absolutePath = fixture.absolutePaths.get(relativePath);

  if (!absolutePath) {
    throw new Error(`Missing fixture path: ${relativePath}`);
  }

  return absolutePath;
};

/**
 * Resolve source text for an absolute fixture path.
 *
 * @param fixture Fixture context containing source text map.
 * @param absolutePath Absolute fixture path.
 * @returns Source text for the fixture path.
 * @throws {Error} When no source exists for the path.
 */
const requireFixtureSource = (fixture: FixtureContext, absolutePath: AbsolutePath): SourceText => {
  const source = fixture.sourcesByPath.get(absolutePath);

  if (source === undefined) {
    throw new Error(`Missing fixture source: ${absolutePath}`);
  }

  return source;
};

/**
 * Parse fixture source files into a ParsedFile map.
 *
 * @param sourcesByPath Absolute path to source map.
 * @returns Parsed-file cache keyed by absolute path.
 */
const buildParsedFileMap = (
  sourcesByPath: Map<AbsolutePath, SourceText>,
): Map<AbsolutePath, ParsedFile> => {
  const parser = new OxcParser();
  const parsedFiles = new Map<AbsolutePath, ParsedFile>();

  for (const [absolutePath, source] of sourcesByPath) {
    parsedFiles.set(absolutePath, parser.parse(absolutePath, source));
  }

  return parsedFiles;
};

/**
 * Find a range for a required fragment in source.
 *
 * @param source Source text to inspect.
 * @param fragment Required fragment that must exist in source.
 * @returns Offset range spanning the fragment.
 * @throws {Error} When the fragment does not exist.
 */
const findRangeForFragment = (source: SourceText, fragment: SourceText): OffsetRange => {
  const start: CharOffset = source.indexOf(fragment);

  if (start < 0) {
    throw new Error(`Fragment not found: ${fragment}`);
  }

  return { start, end: start + fragment.length };
};

/**
 * Create a same-length whitespace mask for assertion of blanked spans.
 *
 * @param value Source fragment to convert into spaces.
 * @returns Whitespace-only string matching fragment length.
 */
const toSpaceMask = (value: SourceText): SourceText => " ".repeat(value.length);

/**
 * Runtime type guard for a DependencyTracker constructor export.
 *
 * @param value Unknown export value to validate.
 * @returns True when the value is callable as a constructor.
 */
const isDependencyTrackerConstructor = (value: unknown): value is DependencyTrackerConstructor =>
  typeof value === "function";

/**
 * Load the DependencyTracker constructor from the tracker module export.
 *
 * @returns DependencyTracker constructor.
 * @throws {Error} When no valid constructor export is found.
 */
const loadDependencyTrackerConstructor = async (): Promise<DependencyTrackerConstructor> => {
  const trackerModule = await import("@/tracker");
  const candidate = Reflect.get(trackerModule, "DependencyTracker");

  if (!isDependencyTrackerConstructor(candidate)) {
    throw new Error("DependencyTracker export not found on tracker module.");
  }

  return candidate;
};

/**
 * Construct a tracker instance for tests.
 *
 * @param config Tracker configuration passed to the constructor.
 * @param dependencies Optional dependency overrides for tests.
 * @returns Constructed tracker instance.
 */
const createTracker = async (
  config: TrackerConfig,
  dependencies?: TrackerDependencyOverrides,
): Promise<DependencyTrackerInstance> => {
  const DependencyTracker = await loadDependencyTrackerConstructor();
  return new DependencyTracker(config, dependencies);
};

describe("DependencyTracker", () => {
  it("returns TrackResult fields and only includes files that contribute nodes", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: [
          "import { used } from './dep.ts';",
          "const drop = 42;",
          "export const result = used();",
        ].join("\n"),
      },
      {
        relativePath: "dep.ts",
        source: ["export const used = () => 1;", "export const extra = () => 2;"].join("\n"),
      },
      {
        relativePath: "unused.ts",
        source: "export const ghost = 0;",
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const dependencyFile = requireFixturePath(fixture, "dep.ts");
      const unusedFile = requireFixturePath(fixture, "unused.ts");
      const entrySource = requireFixtureSource(fixture, entryFile);
      const dependencySource = requireFixtureSource(fixture, dependencyFile);
      const startPoint = findRangeForFragment(entrySource, "result = used()");
      const parser = new FakeParser(buildParsedFileMap(fixture.sourcesByPath));
      const resolver = new FakeResolver(
        new Map<SourceText, ResolveResult>([
          ["./dep.ts", { kind: "resolved", absolutePath: dependencyFile }],
        ]),
      );
      const shaker = new FakeShaker(new Set<OffsetRange>());
      const tracker = await createTracker({}, { parser, resolver, shaker });

      const result = await tracker.track({
        entryFile,
        startPoint,
        output: { mode: "blank" },
      });

      expect(result.files).toBeInstanceOf(Map);
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(Array.isArray(result.edges)).toBe(true);
      expect(Array.isArray(result.issues)).toBe(true);
      expect(result.files.has(entryFile)).toBe(true);
      expect(result.files.has(dependencyFile)).toBe(true);
      expect(result.files.has(unusedFile)).toBe(false);

      const entrySlice = result.files.get(entryFile);
      const dependencySlice = result.files.get(dependencyFile);

      if (!entrySlice || !dependencySlice) {
        throw new Error("Expected sliced entry and dependency files.");
      }

      expect(entrySlice.ms).toBeInstanceOf(MagicString);
      expect(dependencySlice.ms).toBeInstanceOf(MagicString);
      expect(entrySlice.originalSource).toBe(entrySource);
      expect(dependencySlice.originalSource).toBe(dependencySource);
    } finally {
      fixture.cleanup();
    }
  });

  it("clears IssueCollector between track calls", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "unresolved.ts",
        source: [
          "import { missing } from './missing.ts';",
          "export const result = missing();",
        ].join("\n"),
      },
      {
        relativePath: "clean.ts",
        source: ["const value = 1;", "export const result = value;"].join("\n"),
      },
    ]);

    try {
      const unresolvedFile = requireFixturePath(fixture, "unresolved.ts");
      const cleanFile = requireFixturePath(fixture, "clean.ts");
      const unresolvedSource = requireFixtureSource(fixture, unresolvedFile);
      const cleanSource = requireFixtureSource(fixture, cleanFile);
      const unresolvedStartPoint = findRangeForFragment(unresolvedSource, "result = missing()");
      const cleanStartPoint = findRangeForFragment(cleanSource, "result = value");
      const parser = new FakeParser(buildParsedFileMap(fixture.sourcesByPath));
      const resolver = new FakeResolver(new Map<SourceText, ResolveResult>());
      const shaker = new FakeShaker(new Set<OffsetRange>());
      const issueCollector = new IssueCollector();
      const tracker = await createTracker({}, { parser, resolver, shaker, issueCollector });

      const firstResult = await tracker.track({
        entryFile: unresolvedFile,
        startPoint: unresolvedStartPoint,
      });
      const secondResult = await tracker.track({
        entryFile: cleanFile,
        startPoint: cleanStartPoint,
      });

      expect(firstResult.issues.some((issue) => issue.kind === "unresolved-dependency")).toBe(true);
      expect(secondResult.issues).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  it("uses parser cache so repeated calls do not invoke parser.parse again", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: ["const value = 1;", "export const result = value;"].join("\n"),
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const entrySource = requireFixtureSource(fixture, entryFile);
      const startPoint = findRangeForFragment(entrySource, "result = value");
      const parser = new CountingFakeParser(buildParsedFileMap(fixture.sourcesByPath));
      const resolver = new FakeResolver(new Map<SourceText, ResolveResult>());
      const shaker = new FakeShaker(new Set<OffsetRange>());
      const tracker = await createTracker({}, { parser, resolver, shaker });

      await tracker.track({ entryFile, startPoint });
      await tracker.track({ entryFile, startPoint });

      expect(parser.getParseCount()).toBe(1);
      expect(parser.getCache().size).toBe(1);
    } finally {
      fixture.cleanup();
    }
  });

  it("throws StartPointNotFoundError when the start point matches no node", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: ["const value = 1;", "export const result = value;"].join("\n"),
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const source = requireFixtureSource(fixture, entryFile);
      const parser = new FakeParser(buildParsedFileMap(fixture.sourcesByPath));
      const resolver = new FakeResolver(new Map<SourceText, ResolveResult>());
      const shaker = new FakeShaker(new Set<OffsetRange>());
      const tracker = await createTracker({}, { parser, resolver, shaker });
      const missingStartPoint: OffsetRange = {
        start: source.length + 10,
        end: source.length + 15,
      };

      await expect(
        tracker.track({
          entryFile,
          startPoint: missingStartPoint,
        }),
      ).rejects.toThrow(StartPointNotFoundError);
    } finally {
      fixture.cleanup();
    }
  });

  it("tracks dependencies when start point is a switch statement header range", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: [
          "let a = 1;",
          "",
          "switch(a) {",
          "  case 1: {",
          "    a = a;",
          "    const b = 2;",
          "  }",
          "  case 2: {",
          "    const c = 3;",
          "  }",
          "}",
        ].join("\n"),
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const source = requireFixtureSource(fixture, entryFile);
      const startPoint: OffsetRange = {
        start: offsetFromLineCol(source, 3, 1),
        end: offsetFromLineCol(source, 3, 12),
      };
      const tracker = await createTracker({});

      const result = await tracker.track({ entryFile, startPoint });

      expect(result.nodes.some((node) => node.kind === "start-point")).toBe(true);
      expect(
        result.nodes.some(
          (node) =>
            node.file === entryFile &&
            (node.kind === "global" || node.kind === "variable") &&
            node.label.includes("a = 1"),
        ),
      ).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("tracks dependencies when start point is an if statement header range", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: ["let a = 1;", "", "if(a === 1) {", "  a = a;", "  const b = 2;", "}"].join(
          "\n",
        ),
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const source = requireFixtureSource(fixture, entryFile);
      const startPoint: OffsetRange = {
        start: offsetFromLineCol(source, 3, 1),
        end: offsetFromLineCol(source, 3, 13),
      };
      const tracker = await createTracker({});

      const result = await tracker.track({ entryFile, startPoint });

      expect(result.nodes.some((node) => node.kind === "start-point")).toBe(true);
      expect(
        result.nodes.some(
          (node) =>
            node.file === entryFile &&
            (node.kind === "global" || node.kind === "variable") &&
            node.label.includes("a = 1"),
        ),
      ).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("tracks dependencies when start point is a while statement header range", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: ["let a = 1;", "", "while(a < 2) {", "  a = a + 1;", "}"] .join("\n"),
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const source = requireFixtureSource(fixture, entryFile);
      const startPoint: OffsetRange = {
        start: offsetFromLineCol(source, 3, 1),
        end: offsetFromLineCol(source, 3, 13),
      };
      const tracker = await createTracker({});

      const result = await tracker.track({ entryFile, startPoint });

      expect(result.nodes.some((node) => node.kind === "start-point")).toBe(true);
      expect(
        result.nodes.some(
          (node) =>
            node.file === entryFile &&
            (node.kind === "global" || node.kind === "variable") &&
            node.label.includes("a = 1"),
        ),
      ).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("tracks dependencies when start point is a do-while statement header range", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: ["let a = 1;", "", "do {", "  a = a + 1;", "} while (a < 2);"] .join("\n"),
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const source = requireFixtureSource(fixture, entryFile);
      const startPoint: OffsetRange = {
        start: offsetFromLineCol(source, 5, 1),
        end: offsetFromLineCol(source, 5, 16),
      };
      const tracker = await createTracker({});

      const result = await tracker.track({ entryFile, startPoint });

      expect(result.nodes.some((node) => node.kind === "start-point")).toBe(true);
      expect(
        result.nodes.some(
          (node) =>
            node.file === entryFile &&
            (node.kind === "global" || node.kind === "variable") &&
            node.label.includes("a = 1"),
        ),
      ).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("tracks dependencies when start point is a for statement header range", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: ["let a = 1;", "", "for (; a < 2; a++) {", "  const b = a;", "}"] .join("\n"),
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const source = requireFixtureSource(fixture, entryFile);
      const startPoint: OffsetRange = {
        start: offsetFromLineCol(source, 3, 1),
        end: offsetFromLineCol(source, 3, 20),
      };
      const tracker = await createTracker({});

      const result = await tracker.track({ entryFile, startPoint });

      expect(result.nodes.some((node) => node.kind === "start-point")).toBe(true);
      expect(
        result.nodes.some(
          (node) =>
            node.file === entryFile &&
            (node.kind === "global" || node.kind === "variable") &&
            node.label.includes("a = 1"),
        ),
      ).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("tracks dependencies when start point is a for-in statement header range", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: [
          "const obj = { x: 1 };",
          "let key = '';",
          "",
          "for (key in obj) {",
          "  const b = key;",
          "}",
        ].join("\n"),
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const source = requireFixtureSource(fixture, entryFile);
      const startPoint: OffsetRange = {
        start: offsetFromLineCol(source, 4, 1),
        end: offsetFromLineCol(source, 4, 18),
      };
      const tracker = await createTracker({});

      const result = await tracker.track({ entryFile, startPoint });

      expect(result.nodes.some((node) => node.kind === "start-point")).toBe(true);
      expect(
        result.nodes.some(
          (node) =>
            node.file === entryFile &&
            (node.kind === "global" || node.kind === "variable") &&
            node.label.includes("obj = { x: 1 }"),
        ),
      ).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("tracks dependencies when start point is a for-of statement header range", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: ["const arr = [1, 2];", "", "for (const x of arr) {", "  const b = x;", "}"] .join("\n"),
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const source = requireFixtureSource(fixture, entryFile);
      const startPoint: OffsetRange = {
        start: offsetFromLineCol(source, 3, 1),
        end: offsetFromLineCol(source, 3, 22),
      };
      const tracker = await createTracker({});

      const result = await tracker.track({ entryFile, startPoint });

      expect(result.nodes.some((node) => node.kind === "start-point")).toBe(true);
      expect(
        result.nodes.some(
          (node) =>
            node.file === entryFile &&
            (node.kind === "global" || node.kind === "variable") &&
            node.label.includes("arr = [1, 2]"),
        ),
      ).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("does not mark start-point call statement as shaken when tracking an identifier within it", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: [
          "let a = 1;",
          "",
          "(function() {",
          "  const b = (t, e) => {",
          "    return t + e;",
          "  };",
          "",
          "  const c = (t, e) => {",
          "    return b(t, e);",
          "  };",
          "",
          "  console.log(c(1, 2) + a);",
          "})();",
        ].join("\n"),
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const source = requireFixtureSource(fixture, entryFile);
      const aOffset = source.lastIndexOf(" + a");

      if (aOffset < 0) {
        throw new Error("Expected '+ a' fragment in fixture source.");
      }

      const startPoint: OffsetRange = {
        start: aOffset + 3,
        end: aOffset + 4,
      };
      const tracker = await createTracker({});

      const result = await tracker.track({ entryFile, startPoint });
      const startNode = result.nodes.find((node) => node.kind === "start-point");

      expect(startNode).toBeDefined();
      expect(startNode?.shaken).toBe(false);
      expect(startNode?.label.includes("console.log(c(1, 2) + a);")).toBe(true);

      const output = result.files.get(entryFile)?.ms.toString() ?? "";
      expect(output.includes("console.log(c(1, 2) + a);")).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("blanks unrelated same-line statements when tracking identifier inside call expression", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: [
          "let a = 1;",
          "",
          "(function() {",
          "  const b = (t, e) => {",
          "    return t + e;",
          "  };",
          "",
          "  const c = (t, e) => {return b(t, e);};console.log(c(1, 2)+a);",
          "})();",
        ].join("\n"),
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const source = requireFixtureSource(fixture, entryFile);
      const aOffset = source.lastIndexOf("+a");

      if (aOffset < 0) {
        throw new Error("Expected '+a' fragment in fixture source.");
      }

      const startPoint: OffsetRange = {
        start: aOffset + 1,
        end: aOffset + 2,
      };
      const tracker = await createTracker({});
      const result = await tracker.track({
        entryFile,
        startPoint,
        output: { mode: "blank" },
      });
      const output = result.files.get(entryFile)?.ms.toString() ?? "";
      const sameLineDeclaration = "const c = (t, e) => {return b(t, e);};";
      const sameLineCall = "console.log(c(1, 2)+a);";

      expect(output).toContain(sameLineCall);
      expect(output).not.toContain(`  ${sameLineDeclaration}${sameLineCall}`);
      expect(output).toContain(`  ${toSpaceMask(sameLineDeclaration)}${sameLineCall}`);
    } finally {
      fixture.cleanup();
    }
  });

  it("preserves output length in blank mode and shortens output in compact mode", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: ["const used = 1;", "const dropped = 2;", "export const result = used;"].join("\n"),
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const source = requireFixtureSource(fixture, entryFile);
      const startPoint = findRangeForFragment(source, "result = used");
      const parser = new FakeParser(buildParsedFileMap(fixture.sourcesByPath));
      const resolver = new FakeResolver(new Map<SourceText, ResolveResult>());
      const shaker = new FakeShaker(new Set<OffsetRange>());
      const tracker = await createTracker({}, { parser, resolver, shaker });

      const blankResult = await tracker.track({
        entryFile,
        startPoint,
        output: { mode: "blank" },
      });
      const compactResult = await tracker.track({
        entryFile,
        startPoint,
        output: { mode: "compact" },
      });
      const blankOutput = blankResult.files.get(entryFile);
      const compactOutput = compactResult.files.get(entryFile);

      if (!blankOutput || !compactOutput) {
        throw new Error("Expected sliced entry file for both output modes.");
      }

      expect(blankOutput.ms.toString().length).toBe(source.length);
      expect(compactOutput.ms.toString().length).toBeLessThan(source.length);
    } finally {
      fixture.cleanup();
    }
  });

  it("forwards ignorePatterns and emits ignored-path issues for matching imports", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: [
          "import { schemaValue } from './generated/schema.ts';",
          "export const result = schemaValue;",
        ].join("\n"),
      },
      {
        relativePath: "generated/schema.ts",
        source: "export const schemaValue = 1;",
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const source = requireFixtureSource(fixture, entryFile);
      const startPoint = findRangeForFragment(source, "result = schemaValue");
      const tracker = await createTracker({ ignorePatterns: ["generated"] });

      const result = await tracker.track({ entryFile, startPoint });
      const ignoredIssue = result.issues.find((issue) => issue.kind === "ignored-path");

      if (!ignoredIssue) {
        throw new Error(
          "Expected ignored-path issue when ignorePatterns match resolved import path.",
        );
      }

      expect(ignoredIssue.matchedPattern).toBe("generated");
    } finally {
      fixture.cleanup();
    }
  });

  it("uses OxcResolver path when virtualFiles is absent", async () => {
    const fixture = createFixtureContext([
      {
        relativePath: "entry.ts",
        source: ["import { target } from './target.ts';", "export const result = target;"].join("\n"),
      },
      {
        relativePath: "target.ts",
        source: "export const target = 42;",
      },
    ]);

    try {
      const entryFile = requireFixturePath(fixture, "entry.ts");
      const source = requireFixtureSource(fixture, entryFile);
      const startPoint = findRangeForFragment(source, "result = target");
      const tracker = await createTracker({});

      const result = await tracker.track({ entryFile, startPoint });

      expect(result.nodes.some((node) => node.file === requireFixturePath(fixture, "target.ts"))).toBe(
        true,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("throws InvalidVirtualPathError when a virtual key is not absolute", async () => {
    await expect(
      createTracker({
        virtualFiles: {
          "relative/file.ts": "export const value = 1;",
        },
      }),
    ).rejects.toThrow(InvalidVirtualPathError);
  });

  it("tracks virtual entry files without reading disk", async () => {
    const entrySource = [
      "import { add } from './math';",
      "const left = 1;",
      "const right = 2;",
      "export const result = add(left, right);",
    ].join("\n");

    const tracker = await createTracker({
      virtualFiles: {
        "/virtual/main.ts": entrySource,
        "/virtual/math.ts": "export const add = (a: number, b: number): number => a + b;",
      },
    });

    const result = await tracker.track({
      entryFile: "/virtual/main.ts",
      startPoint: findRangeForFragment(entrySource, "result = add(left, right)"),
    });

    expect(result.nodes.some((node) => node.file === "/virtual/main.ts")).toBe(true);
    expect(result.nodes.some((node) => node.file === "/virtual/math.ts")).toBe(true);
  });

  it("pre-populates and reuses parser cache across repeated virtual calls", async () => {
    const entrySource = [
      "import { add } from './math';",
      "const left = 1;",
      "const right = 2;",
      "export const result = add(left, right);",
    ].join("\n");

    const parser = new OxcParser();
    const tracker = await createTracker(
      {
        virtualFiles: {
          "/virtual/main.ts": entrySource,
          "/virtual/math.ts": "export const add = (a: number, b: number): number => a + b;",
        },
      },
      { parser },
    );

    expect(parser.getCache().size).toBe(2);

    const startPoint = findRangeForFragment(entrySource, "result = add(left, right)");

    await tracker.track({ entryFile: "/virtual/main.ts", startPoint });
    await tracker.track({ entryFile: "/virtual/main.ts", startPoint });

    expect(parser.getCache().size).toBe(2);
  });
});

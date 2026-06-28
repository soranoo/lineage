import { describe, expect, it } from "vitest";

import type {
  AbsolutePath,
  BindingKind,
  CharOffset,
  DependencyEdge,
  DependencyKind,
  DependencyNode,
  EdgeKind,
  FunctionNode,
  IEditor,
  IIssueCollector,
  IgnorePattern,
  IParser,
  IResolver,
  IShaker,
  IssueKind,
  OffsetRange,
  OxcAst,
  OxcResolverOptions,
  OutputMode,
  ParsedFile,
  ResolveResult,
  SeedNode,
  SlicedFile,
  SliceResult,
  SourceText,
  TrackRequest,
  TrackResult,
  TrackerConfig,
  TrackerIssue,
} from "@/index";

import { DependencyTracker, offsetFromLineCol } from "@/index";

/**
 * Ensure key public entry types are available from the package root.
 *
 * @param value Generic value used only to enforce compile-time availability.
 */
const assertType = <T>(value: T): void => {
  void value;
};

describe("package entry exports", () => {
  it("exposes only DependencyTracker and offsetFromLineCol as runtime values", async () => {
    const entryModule = await import("@/index");
    const runtimeExportKeys = Object.keys(entryModule).sort();

    expect(runtimeExportKeys).toEqual(["DependencyTracker", "offsetFromLineCol"]);
    expect(entryModule.DependencyTracker).toBe(DependencyTracker);
    expect(entryModule.offsetFromLineCol).toBe(offsetFromLineCol);
  });

  it("exposes core types from types.ts as type-only package exports", () => {
    const absolutePath: AbsolutePath = "/project/src/index.ts";
    const charOffset: CharOffset = 1;
    const sourceText: SourceText = "const value = 1;";
    const ignorePattern: IgnorePattern = "generated";
    const outputMode: OutputMode = "blank";
    const dependencyKind: DependencyKind = "variable";
    const edgeKind: EdgeKind = "data-flow";
    const issueKind: IssueKind = "unresolved-dependency";
    const bindingKind: BindingKind = "local-variable";
    const offsetRange: OffsetRange = { start: 0, end: 5 };
    const trackerConfig: TrackerConfig = { ignorePatterns: [ignorePattern] };
    const trackRequest: TrackRequest = { entryFile: absolutePath, startPoint: offsetRange };
    const resolveResult: ResolveResult = { kind: "failed" };

    const parsedFile = {
      absolutePath,
      ast: {
        type: "Program",
        body: [],
        sourceType: "module",
        hashbang: null,
        start: 0,
        end: 0,
      },
      source: sourceText,
    } satisfies ParsedFile;

    const dependencyNode = {
      id: `${absolutePath}:0:5`,
      file: absolutePath,
      range: offsetRange,
      label: "value",
      kind: dependencyKind,
      shaken: false,
    } satisfies DependencyNode;

    const dependencyEdge = {
      from: dependencyNode.id,
      to: dependencyNode.id,
      kind: edgeKind,
    } satisfies DependencyEdge;

    const trackerIssue = {
      kind: issueKind,
      message: "issue",
      file: absolutePath,
      range: offsetRange,
      resolution: "leaf",
    } satisfies TrackerIssue;

    const slicedFile = {
      path: absolutePath,
      ms: {
        toString: () => sourceText,
      },
      originalSource: sourceText,
    } satisfies Pick<SlicedFile, "path" | "originalSource"> & { ms: { toString: () => string } };

    const trackResult = {
      files: new Map<AbsolutePath, SlicedFile>(),
      nodes: [dependencyNode],
      edges: [dependencyEdge],
      issues: [trackerIssue],
    } satisfies TrackResult;

    const sliceResult = {
      nodes: [dependencyNode],
      edges: [dependencyEdge],
      visitedRanges: new Set([dependencyNode.id]),
    } satisfies SliceResult;

    const parser: IParser = {
      parse: () => parsedFile,
      getCache: () => new Map([[absolutePath, parsedFile]]),
    };
    const resolver: IResolver = {
      resolve: () => resolveResult,
    };
    const shaker: IShaker = {
      shake: () => new Set<OffsetRange>(),
    };
    const editor: IEditor = {
      apply: () => {},
    };
    const issueCollector: IIssueCollector = {
      add: () => {},
      getAll: () => [],
      clear: () => {},
    };

    assertType<OxcResolverOptions | undefined>(trackerConfig.resolver);
    assertType<OxcAst>(parsedFile.ast);
    assertType<SeedNode | null>(null);
    assertType<FunctionNode | null>(null);
    assertType<TrackRequest>(trackRequest);
    assertType<TrackResult>(trackResult);
    assertType<SliceResult>(sliceResult);
    assertType<SlicedFile | null>(null);
    assertType<DependencyNode>(dependencyNode);
    assertType<DependencyEdge>(dependencyEdge);
    assertType<TrackerIssue>(trackerIssue);
    assertType<OutputMode>(outputMode);
    assertType<DependencyKind>(dependencyKind);
    assertType<EdgeKind>(edgeKind);
    assertType<IssueKind>(issueKind);
    assertType<BindingKind>(bindingKind);
    assertType<ResolveResult>(resolveResult);
    assertType<IParser>(parser);
    assertType<IResolver>(resolver);
    assertType<IShaker>(shaker);
    assertType<IEditor>(editor);
    assertType<IIssueCollector>(issueCollector);
    assertType<OffsetRange>(offsetRange);
    assertType<AbsolutePath>(absolutePath);
    assertType<CharOffset>(charOffset);
    assertType<SourceText>(sourceText);

    expect(typeof DependencyTracker).toBe("function");
    expect(typeof offsetFromLineCol).toBe("function");
    expect(offsetFromLineCol("a\nb", 2, 1)).toBe(2);
  });
});

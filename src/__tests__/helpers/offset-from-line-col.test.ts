import { describe, expect, it } from "vitest";

import type {
  AbsolutePath,
  AstNode,
  CharOffset,
  ColumnNumber,
  DependencyEdge,
  DependencyKind,
  DependencyNode,
  EdgeKind,
  IEditor,
  IIssueCollector,
  IParser,
  IResolver,
  IShaker,
  IgnorePattern,
  IssueKind,
  IssueMessage,
  IssueResolution,
  LineNumber,
  NodeId,
  NodeLabel,
  OffsetRange,
  OxcAst,
  OxcResolverOptions,
  OutputMode,
  ParsedFile,
  ResolveResult,
  SourceText,
  SlicedFile,
  TrackRequest,
  TrackOutputConfig,
  TrackerConfig,
  TrackerIssue,
  TrackResult,
} from "@/types";

import { CyclicResolutionError, ParseError, StartPointNotFoundError } from "@/types";
import { offsetFromLineCol } from "@/helpers/offset-from-line-col";

type _ExportedTypes = {
  AbsolutePath: AbsolutePath;
  AstNode: AstNode;
  NodeId: NodeId;
  CharOffset: CharOffset;
  LineNumber: LineNumber;
  ColumnNumber: ColumnNumber;
  IgnorePattern: IgnorePattern;
  SourceText: SourceText;
  NodeLabel: NodeLabel;
  IssueMessage: IssueMessage;
  OxcAst: OxcAst;
  OxcResolverOptions: OxcResolverOptions;
  OutputMode: OutputMode;
  IssueResolution: IssueResolution;
  OffsetRange: OffsetRange;
  TrackerConfig: TrackerConfig;
  TrackRequest: TrackRequest;
  TrackOutputConfig: TrackOutputConfig;
  TrackResult: TrackResult;
  SlicedFile: SlicedFile;
  DependencyNode: DependencyNode;
  DependencyKind: DependencyKind;
  DependencyEdge: DependencyEdge;
  EdgeKind: EdgeKind;
  TrackerIssue: TrackerIssue;
  IssueKind: IssueKind;
  ResolveResult: ResolveResult;
  ParsedFile: ParsedFile;
  IParser: IParser;
  IResolver: IResolver;
  IShaker: IShaker;
  IEditor: IEditor;
  IIssueCollector: IIssueCollector;
  StartPointNotFoundError: StartPointNotFoundError;
  ParseError: ParseError;
  CyclicResolutionError: CyclicResolutionError;
};

const _typecheck: _ExportedTypes | null = null;

describe("offsetFromLineCol", () => {
  it("maps line 1, col 1 to offset 0", () => {
    expect(offsetFromLineCol("abc", 1, 1)).toBe(0);
  });

  it("maps line 2, col 1 to the first char after the newline", () => {
    const source = "first\nsecond";
    expect(offsetFromLineCol(source, 2, 1)).toBe("first".length + 1);
  });

  it("handles tabs and unicode on multi-line input", () => {
    const source = "a\tb\ncπd\nend";
    expect(offsetFromLineCol(source, 2, 2)).toBe(5);
  });

  it("throws RangeError when line is out of range", () => {
    expect(() => offsetFromLineCol("a\nb", 3, 1)).toThrow(RangeError);
  });

  it("throws RangeError when column is out of range", () => {
    expect(() => offsetFromLineCol("abc", 1, 5)).toThrow(RangeError);
  });

  it("exports all shared types", () => {
    expect(_typecheck).toBeNull();
    expect([StartPointNotFoundError, ParseError, CyclicResolutionError]).toHaveLength(3);
  });
});

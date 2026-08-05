import { describe, expect, it } from "vitest";

import type {
  AbsolutePath,
  LiteralValue,
  ModuleResolutionPlugin,
  ModuleResolutionPluginName,
  ModuleSpecifier,
  NodeId,
  NodeLabel,
  SlicedFile,
  SourceText,
  TrackOutputConfig,
  TrackerIssue,
  UntracedContinuationReason,
  UsageContinuation,
  UsageEdge,
  UsageEdgeKind,
  UsageKind,
  UsageNode,
  UsageNodeLimit,
  UsageRequest,
  UsageResult,
  UsageTrackerConfig,
} from "@/index";

const continuationReason: UntracedContinuationReason = "reassignment";
const usageKind: UsageKind = "untraced-continuation";
const usageEdgeKind: UsageEdgeKind = "continuation";
const nodeId: NodeId = "/project/src/entry.ts:0:5";
const nodeLabel: NodeLabel = "value";
const moduleName: ModuleResolutionPluginName = "test-plugin";
const moduleSpecifier: ModuleSpecifier = "./dependency";
const usageNodeLimit: UsageNodeLimit = 2000;

const _usageTypecheck = {
  config: {
    projectRoot: "/project",
    projectFiles: ["/project/src/entry.ts"],
    virtualFiles: { "/virtual/entry.ts": "export const value = 1;" },
    maxUsageNodes: usageNodeLimit,
  } satisfies UsageTrackerConfig,
  request: {
    entryFile: "/project/src/entry.ts",
    startPoint: { start: 0, end: 5 },
    output: { mode: "blank" },
  } satisfies UsageRequest,
  plugin: {
    name: moduleName,
    tryResolve: ({ calleeText, args, file }) => {
      const _inputs: [SourceText, readonly LiteralValue[], AbsolutePath] = [calleeText, args, file];
      void _inputs;
      return { specifier: moduleSpecifier };
    },
  } satisfies ModuleResolutionPlugin,
  continuation: {
    reason: continuationReason,
    opaque: false,
    continuesAt: {
      file: "/project/src/entry.ts",
      range: { start: 6, end: 11 },
      label: "value",
    },
  } satisfies UsageContinuation,
  node: {
    id: "/project/src/entry.ts:0:5",
    file: "/project/src/entry.ts",
    range: { start: 0, end: 5 },
    label: "value",
    kind: usageKind,
    continuation: {
      reason: "call-argument",
      opaque: false,
    },
  } satisfies UsageNode,
  edge: {
    from: "/project/src/entry.ts:0:5",
    to: "/project/src/entry.ts:6:11",
    kind: usageEdgeKind,
  } satisfies UsageEdge,
  result: {
    files: new Map<AbsolutePath, SlicedFile>(),
    nodes: [],
    edges: [],
    issues: [] as TrackerIssue[],
  } satisfies UsageResult,
  output: { mode: "compact" } satisfies TrackOutputConfig,
  ids: [nodeId, nodeLabel],
};

describe("usage tracking types", () => {
  it("exports every Phase 12 type from the package entry point", () => {
    expect(_usageTypecheck.result.nodes).toEqual([]);
  });
});

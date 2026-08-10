import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildParsedFiles, findNode, toFixturePath, toRange } from "@/__tests__/utils";
import { FakeParser } from "@/__tests__/_fakes/FakeParser";
import { FakeResolver } from "@/__tests__/_fakes/FakeResolver";
import { FakeShaker } from "@/__tests__/_fakes/FakeShaker";
import { walkAst } from "@/helpers";
import { IssueCollector } from "@/issues";
import { BackwardSlicer } from "@/slice";
import type { AbsolutePath, AstNode, ParsedFile, ResolveResult, SourceText } from "@/types";

type ReturnStatementNode = AstNode & { type: "ReturnStatement" };

const isReturnStatement = (node: AstNode): node is ReturnStatementNode =>
  node.type === "ReturnStatement";

const createSlicer = (parsedFiles: Map<AbsolutePath, ParsedFile>): BackwardSlicer =>
  new BackwardSlicer(
    new FakeParser(parsedFiles),
    new FakeResolver(new Map<SourceText, ResolveResult>()),
    new FakeShaker(new Set()),
    new IssueCollector(),
  );

const track = (source: SourceText): ReturnType<BackwardSlicer["slice"]> => {
  const entryFile: AbsolutePath = "/project/entry.ts";
  const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
  const parsed = parsedFiles.get(entryFile);

  if (!parsed) {
    throw new Error("Parsed file missing");
  }

  const returnNode = findNode(
    parsed.ast,
    (node) => isReturnStatement(node) && source.slice(node.start, node.end).includes("return n"),
    "ReturnStatement not found",
  );
  return createSlicer(parsedFiles).slice(entryFile, toRange(returnNode), parsedFiles);
};

const expectStructuralOrigin = (
  result: ReturnType<BackwardSlicer["slice"]>,
  originLabel: SourceText,
): void => {
  const parameter = result.nodes.find((node) => node.kind === "parameter");
  const structuralEdge = result.edges.find((edge) => edge.kind === "structural-origin");
  const origin = result.nodes.find((node) => node.id === structuralEdge?.to);

  expect(parameter).toBeDefined();
  expect(origin).toBeDefined();

  if (!parameter || !origin) {
    return;
  }

  expect(structuralEdge?.from).toBe(parameter.id);
  expect(origin.label).toContain(originLabel);
};

describe("BackwardSlicer structural origins", () => {
  it("finds origins through nested object and array literals", () => {
    expectStructuralOrigin(
      track("const e = { modules: { 2029: (n) => { return n; } } };"),
      "e",
    );
    expectStructuralOrigin(track("const handlers = [(n) => { return n; }];"), "handlers");
  });

  it("finds variable, assignment, class-method, and export origins", () => {
    expectStructuralOrigin(track("const factory = (n) => { return n; };"), "factory");
    expectStructuralOrigin(
      track("const table = { save: function (n) { return n; } };") ,
      "table",
    );
    expectStructuralOrigin(track("let factory; factory = (n) => { return n; };"), "factory");
    expectStructuralOrigin(
      track("class Widget { render(n) { return n; } }"),
      "render(n)",
    );
    expectStructuralOrigin(
      track("export default function (n) { return n; }"),
      "export default",
    );
  });

  it("walks through TypeScript assertion wrappers", () => {
    expectStructuralOrigin(
      track("const table = { save: (n) => { return n; } } satisfies Record<string, unknown>;"),
      "table",
    );
  });

  it("uses a matching call parameter or the nearest literal as fallback", () => {
    const resolved = track(
      "function registerModule(options) { return options; } registerModule({ save: (n) => { return n; } });",
    );
    expectStructuralOrigin(resolved, "options");

    const unresolved = track("registerModule({ save: (n) => { return n; } });");
    expectStructuralOrigin(unresolved, "{ save: (n)");
  });

  it("handles method syntax, computed keys, and deeper literal nesting", () => {
    expectStructuralOrigin(track("const table = { save(n) { return n; } };"), "table");
    expectStructuralOrigin(
      track("const key = 'save'; const table = { [key]: (n) => { return n; } };"),
      "table",
    );
    expectStructuralOrigin(
      track("const table = { one: { two: [{ save: (n) => { return n; } }] } };"),
      "table",
    );
  });

  it("stops at an unnamed merge argument and does not duplicate IIFE edges", () => {
    const merged = track(
      "const merged = Object.assign({}, { save: (n) => { return n; } });",
    );
    expectStructuralOrigin(merged, "{ save: (n)");

    const iife = track("((n) => { return n; })(1);");
    expect(iife.edges.filter((edge) => edge.kind === "structural-origin")).toHaveLength(0);
  });

  it("keeps the fallback to one structural hop", () => {
    const result = track(
      "const factory = (n) => { return n; }; const table = { save: factory };",
    );
    expectStructuralOrigin(result, "factory");
    expect(result.edges.filter((edge) => edge.kind === "structural-origin")).toHaveLength(1);
  });

  it("does not double-add for named exports", () => {
    const result = track("export const factory = (n) => { return n; };");
    expectStructuralOrigin(result, "factory");
    expect(result.edges.filter((edge) => edge.kind === "structural-origin")).toHaveLength(1);
  });

  it("does not invent an origin for a standalone function declaration", () => {
    const result = track("function standalone(n) { return n; }");
    expect(result.edges.some((edge) => edge.kind === "structural-origin")).toBe(false);
  });

  it("finds origins for the real webpack module factories", () => {
    const entryFile = toFixturePath("usage/webpack-bundle-real/structural-origin.js");
    const source = readFileSync(entryFile, "utf8");
    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Webpack fixture missing");
    }

    const returnNodes: ReturnStatementNode[] = [];
    walkAst(parsed.ast, (node) => {
      if (isReturnStatement(node)) {
        returnNodes.push(node);
      }
    });

    expect(returnNodes).toHaveLength(2);

    for (const returnNode of returnNodes) {
      const result = createSlicer(parsedFiles).slice(entryFile, toRange(returnNode), parsedFiles);
      expect(result.nodes.some((node) => node.kind === "parameter" && node.label === "n")).toBe(
        true,
      );
      expectStructuralOrigin(result, "e =");
    }
  });
});
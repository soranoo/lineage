import { describe, expect, it } from "vitest";

import type { AbsolutePath, AstNode, OffsetRange, ParsedFile, SourceText } from "@/types";
import type { ReturnStatement } from "@oxc-project/types";

import { walkAst } from "@/helpers/ast-walker";
import { IssueCollector } from "@/issues/IssueCollector";
import { OxcParser } from "@/parse/OxcParser";
import { BackwardSlicer } from "@/slice/BackwardSlicer";
import { FakeParser } from "@/__tests__/_fakes/FakeParser";
import { FakeResolver } from "@/__tests__/_fakes/FakeResolver";
import { IntraFunctionShaker } from "@/shake/IntraFunctionShaker";

/**
 * Source entry for multi-file parsing.
 */
type SourceEntry = {
  /** Absolute file path for the entry. */
  file: AbsolutePath;
  /** Source text for the entry. */
  source: SourceText;
};

/**
 * Build parsed files from source entries.
 *
 * @param entries Source entries to parse.
 * @returns Map of parsed files keyed by absolute path.
 */
const buildParsedFiles = (entries: SourceEntry[]): Map<AbsolutePath, ParsedFile> => {
  const parser = new OxcParser();
  const parsed = new Map<AbsolutePath, ParsedFile>();

  for (const entry of entries) {
    parsed.set(entry.file, parser.parse(entry.file, entry.source));
  }

  return parsed;
};

/**
 * Find the first AST node matching the predicate.
 *
 * @param root Root AST node.
 * @param predicate Predicate narrowing the node.
 * @param message Error message when not found.
 * @returns Matching AST node.
 */
const findNode = <T extends AstNode>(
  root: AstNode,
  predicate: (node: AstNode) => node is T,
  message: string,
): T => {
  let found: T | null = null;

  walkAst(root, (node) => {
    if (!found && predicate(node)) {
      found = node;
    }
  });

  if (!found) {
    throw new Error(message);
  }

  return found;
};

/**
 * Convert an AST node to an offset range.
 *
 * @param node AST node to convert.
 * @returns Offset range for the node.
 */
const toRange = (node: AstNode): OffsetRange => ({ start: node.start, end: node.end });

/**
 * Check whether a node is a return statement.
 *
 * @param node AST node to inspect.
 * @returns True when the node is a return statement.
 */
const isReturnStatement = (node: AstNode): node is ReturnStatement =>
  node.type === "ReturnStatement";

/**
 * Build a slicer with IntraFunctionShaker and fake dependencies.
 *
 * @param parsedFiles Parsed file map.
 * @returns BackwardSlicer instance.
 */
const createSlicer = (parsedFiles: Map<AbsolutePath, ParsedFile>): BackwardSlicer => {
  const parser = new FakeParser(parsedFiles);
  const resolver = new FakeResolver(new Map());
  const shaker = new IntraFunctionShaker();
  const collector = new IssueCollector();

  return new BackwardSlicer(parser, resolver, shaker, collector);
};

describe("BackwardSlicer + IntraFunctionShaker", () => {
  it("marks shaken nodes for example 2", () => {
    const entryFile: AbsolutePath = "/project/main.js";
    const source = [
      "function compute(x) {",
      "    const log = 'computing ' + x;",
      "    console.log(log);",
      "    const doubled = x * 2;",
      "    const tripled = x * 3;",
      "    return doubled;",
      "}",
    ].join("\n");

    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const seedNode = findNode(parsed.ast, isReturnStatement, "ReturnStatement not found");
    const startPoint = toRange(seedNode);
    const slicer = createSlicer(parsedFiles);

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    const shakenNodes = result.nodes.filter((node) => node.shaken);
    const unshakenNodes = result.nodes.filter((node) => !node.shaken);

    expect(shakenNodes.some((node) => node.label.includes("const log"))).toBe(true);
    expect(shakenNodes.some((node) => node.label.includes("console.log"))).toBe(true);
    expect(shakenNodes.some((node) => node.label.includes("const tripled"))).toBe(true);
    expect(unshakenNodes.some((node) => node.label.includes("doubled = x * 2"))).toBe(true);
    expect(unshakenNodes.some((node) => node.label.includes("return doubled"))).toBe(true);
  });

  it("produces no shaken nodes when all statements are on the return path", () => {
    const entryFile: AbsolutePath = "/project/main.js";
    const source = [
      "function compute(x) {",
      "    const value = x + 1;",
      "    return value;",
      "}",
    ].join("\n");

    const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
    const parsed = parsedFiles.get(entryFile);

    if (!parsed) {
      throw new Error("Parsed file missing");
    }

    const seedNode = findNode(parsed.ast, isReturnStatement, "ReturnStatement not found");
    const startPoint = toRange(seedNode);
    const slicer = createSlicer(parsedFiles);

    const result = slicer.slice(entryFile, startPoint, parsedFiles);

    expect(result.nodes.every((node) => node.shaken === false)).toBe(true);
  });
});

import { assertNever } from "assert-never";
import MagicString from "magic-string";

import { MagicStringEditor } from "@/edit";
import type { IEditor } from "@/edit";
import { walkAst } from "@/helpers";
import type {
  AbsolutePath,
  AstNode,
  DependencyNode,
  OffsetRange,
  OutputKeepNodePredicate,
  OutputMode,
  ParsedFile,
  SlicedFile,
  SliceOutputNode,
  SourceText,
} from "@/types";

/**
 * Build a deduplicated set of keep ranges from node ranges for one file.
 *
 * @param ranges Raw node ranges to keep.
 * @returns Keep-range set compatible with the editor interface.
 */
const buildKeepRangeSet = (ranges: OffsetRange[]): Set<OffsetRange> => {
  const byKey = new Map<SourceText, OffsetRange>();

  for (const range of ranges) {
    byKey.set(`${range.start}:${range.end}`, range);
  }

  return new Set(byKey.values());
};

/**
 * Check whether a container node fully contains a target range.
 *
 * @param container Node that may contain the range.
 * @param range Range to test.
 * @returns True when the range is inside the container.
 */
const containsRange = (container: AstNode, range: OffsetRange): boolean =>
  container.start <= range.start && container.end >= range.end;

/**
 * Check whether a node can define a keep-range boundary.
 *
 * @param node AST node to inspect.
 * @returns True when the node is a statement/declaration boundary.
 */
const isKeepBoundaryNode = (node: AstNode): boolean =>
  node.type.endsWith("Statement") || node.type.endsWith("Declaration");

/**
 * Check whether an AST node is a function expression or declaration.
 *
 * @param node AST node to inspect.
 * @returns True when the node represents a function.
 */
const isFunctionNode = (node: AstNode): boolean =>
  node.type === "ArrowFunctionExpression" ||
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "TSDeclareFunction" ||
  node.type === "TSEmptyBodyFunctionExpression";

/**
 * Select the smallest node span from a non-empty candidate list.
 *
 * @param candidates Candidate nodes.
 * @returns Smallest-span node.
 */
const selectSmallestNode = (candidates: AstNode[]): AstNode => {
  const [first, ...rest] = candidates;

  if (first === undefined) {
    throw new Error("Expected at least one AST node candidate.");
  }

  let smallest = first;

  for (const node of rest) {
    const smallestSize = smallest.end - smallest.start;
    const nodeSize = node.end - node.start;

    if (nodeSize < smallestSize) {
      smallest = node;
    }
  }

  return smallest;
};

/**
 * Expand a node range to its nearest statement/declaration boundary.
 *
 * @param ast AST root for the current file.
 * @param range Node range to expand.
 * @returns Expanded boundary range when found; otherwise the original range.
 */
const expandRangeToBoundary = (ast: AstNode, range: OffsetRange): OffsetRange => {
  const boundaryMatches: AstNode[] = [];
  const exportMatches: AstNode[] = [];

  walkAst(ast, (node) => {
    if (!isKeepBoundaryNode(node) || !containsRange(node, range)) {
      return;
    }

    boundaryMatches.push(node);

    if (
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportDefaultDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      exportMatches.push(node);
    }
  });

  if (exportMatches.length > 0) {
    const selectedExport = selectSmallestNode(exportMatches);
    return { start: selectedExport.start, end: selectedExport.end };
  }

  if (boundaryMatches.length === 0) {
    return { start: range.start, end: range.end };
  }

  const selectedBoundary = selectSmallestNode(boundaryMatches);
  return { start: selectedBoundary.start, end: selectedBoundary.end };
};

/**
 * Find the smallest enclosing function's output boundary for a range.
 *
 * @param ast AST root to inspect.
 * @param range Range whose function body should be preserved.
 * @returns Enclosing function boundary, or null when outside functions.
 */
const findEnclosingFunctionBoundary = (ast: AstNode, range: OffsetRange): OffsetRange | null => {
  const functions: AstNode[] = [];

  walkAst(ast, (node) => {
    if (isFunctionNode(node) && containsRange(node, range)) {
      functions.push(node);
    }
  });

  if (functions.length === 0) {
    return null;
  }

  return expandRangeToBoundary(ast, selectSmallestNode(functions));
};

/**
 * Determine whether a backward dependency node should contribute to output.
 *
 * @param node Dependency node to evaluate.
 * @returns True when the node is an unshaken, output-worthy dependency.
 */
export const isDependencyNodeKeepWorthy = (node: DependencyNode): boolean => {
  if (node.shaken !== false) {
    return false;
  }

  switch (node.kind) {
    case "parameter":
      return false;
    case "start-point":
    case "variable":
    case "function":
    case "call-site":
    case "import":
    case "global":
    case "re-export":
    case "ignored-leaf":
    case "unresolved-leaf":
      return true;
    default:
      return assertNever(node.kind);
  }
};

/**
 * Convert nodes into output keep ranges for one parsed file.
 *
 * @param nodes Nodes discovered for the file.
 * @param parsedFile Parsed source file used for boundary expansion.
 * @param shouldKeepNode Predicate selecting output-worthy nodes.
 * @param keepEnclosingFunctions Whether touched function bodies should remain intact.
 * @returns Keep ranges used by the editor.
 */
const toOutputKeepRanges = <TNode extends SliceOutputNode>(
  nodes: readonly TNode[],
  parsedFile: ParsedFile,
  shouldKeepNode: OutputKeepNodePredicate<TNode>,
  keepEnclosingFunctions: boolean,
): Set<OffsetRange> => {
  const ranges: OffsetRange[] = [];

  for (const node of nodes) {
    if (!shouldKeepNode(node)) {
      continue;
    }

    ranges.push(expandRangeToBoundary(parsedFile.ast, node.range));

    if (keepEnclosingFunctions) {
      const functionBoundary = findEnclosingFunctionBoundary(parsedFile.ast, node.range);

      if (functionBoundary !== null) {
        ranges.push(functionBoundary);
      }
    }
  }

  return buildKeepRangeSet(ranges);
};

/**
 * Assemble edited source files from backward or forward tracking nodes.
 *
 * Nodes may come from several independent tracker calls. Ranges are grouped
 * by file before editing, so overlapping calls produce one merged output per
 * parsed file.
 *
 * @param nodes Accumulated dependency or usage nodes to render.
 * @param parsedFiles Parsed source files keyed by absolute path.
 * @param mode Output mode controlling blank versus compact edits.
 * @param shouldKeepNode Predicate selecting nodes that preserve source text.
 * @param editor Editor used to apply the output transformation.
 * @param keepEnclosingFunctions Whether touched function bodies remain intact.
 * @returns Sliced files keyed by the files represented by the selected nodes.
 */
export const assembleSlicedOutput = <TNode extends SliceOutputNode>(
  nodes: readonly TNode[],
  parsedFiles: ReadonlyMap<AbsolutePath, ParsedFile>,
  mode: OutputMode,
  shouldKeepNode: OutputKeepNodePredicate<TNode>,
  editor: IEditor = new MagicStringEditor(),
  keepEnclosingFunctions = false,
): Map<AbsolutePath, SlicedFile> => {
  const files = new Map<AbsolutePath, SlicedFile>();
  const nodesByFile = new Map<AbsolutePath, TNode[]>();

  for (const node of nodes) {
    const existing = nodesByFile.get(node.file);

    if (existing === undefined) {
      nodesByFile.set(node.file, [node]);
      continue;
    }

    existing.push(node);
  }

  for (const [file, fileNodes] of nodesByFile) {
    const parsedFile = parsedFiles.get(file);

    if (parsedFile === undefined) {
      continue;
    }

    const keepRanges = toOutputKeepRanges(
      fileNodes,
      parsedFile,
      shouldKeepNode,
      keepEnclosingFunctions,
    );
    const ms = new MagicString(parsedFile.source);
    editor.apply(ms, parsedFile.source, keepRanges, mode);

    files.set(file, {
      path: file,
      ms,
      originalSource: parsedFile.source,
    });
  }

  return files;
};

import { assertNever } from "assert-never";
import MagicString from "magic-string";

import type { IEditor } from "@/edit";
import { MagicStringEditor } from "@/edit";
import { walkAst } from "@/helpers";

import type {
  AbsolutePath,
  AstNode,
  DependencyNode,
  ObjectTableSelection,
  OffsetRange,
  OutputRangePlan,
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
 * Find the outermost directly assigned object table containing a nested selection.
 *
 * @param ast AST root to search.
 * @param range Selected source range.
 * @returns The table and selected property, when one exists.
 */
const findAssignedTableProperty = (
  ast: AstNode,
  range: OffsetRange,
): ObjectTableSelection | null => {
  let match: ObjectTableSelection | null = null;

  walkAst(ast, (node, parent) => {
    if (
      node.type !== "ObjectExpression" ||
      !containsRange(node, range) ||
      !(
        (parent?.type === "AssignmentExpression" && parent.right === node) ||
        (parent?.type === "VariableDeclarator" && parent.init === node)
      )
    ) {
      return;
    }

    const property = node.properties.find((candidate) => containsRange(candidate, range));
    if (
      property !== undefined &&
      (match === null || node.end - node.start > match.table.end - match.table.start)
    ) {
      match = { table: node, property };
    }
  });

  return match;
};

/**
 * Check that removing unselected entries cannot discard computed or spread side effects.
 *
 * @param table Object expression to inspect.
 * @returns True when every entry has a static property key.
 */
const isPrunableTable = (table: AstNode): boolean =>
  table.type === "ObjectExpression" &&
  table.properties.every((property) => property.type === "Property" && !property.computed);

/**
 * Find unselected property runs, including their separating commas.
 *
 * @param table Object expression whose properties may be pruned.
 * @param selected Properties that must remain.
 * @returns Source ranges the editor should omit.
 */
const getTablePropertyOmitRanges = (
  table: AstNode,
  selected: ReadonlySet<AstNode>,
): OffsetRange[] => {
  if (table.type !== "ObjectExpression") {
    return [];
  }

  const ranges: OffsetRange[] = [];
  const properties = table.properties;
  let index = 0;
  while (index < properties.length) {
    const current = properties[index];
    if (current === undefined) {
      break;
    }
    if (selected.has(current)) {
      index++;
      continue;
    }

    const first = index;
    while (index < properties.length) {
      const candidate = properties[index];
      if (candidate === undefined || selected.has(candidate)) {
        break;
      }
      index++;
    }
    const previous = properties[first - 1];
    const firstProperty = properties[first];
    const next = properties[index];
    const last = properties[index - 1];
    if (last === undefined || firstProperty === undefined) {
      continue;
    }
    const start = next === undefined && previous !== undefined ? previous.end : firstProperty.start;
    const end = next?.start ?? last.end;
    if (start < end) {
      ranges.push({ start, end });
    }
  }

  return ranges;
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
 * @returns Kept ranges, selected table entries, and any loss of output precision.
 */
const toOutputKeepRanges = <TNode extends SliceOutputNode>(
  nodes: readonly TNode[],
  parsedFile: ParsedFile,
  shouldKeepNode: OutputKeepNodePredicate<TNode>,
  keepEnclosingFunctions: boolean,
): OutputRangePlan => {
  const ranges: OffsetRange[] = [];
  const wholeRanges: OffsetRange[] = [];
  const tables = new Map<AstNode, Set<AstNode>>();
  const precisionLosses: OffsetRange[] = [];

  for (const node of nodes) {
    if (!shouldKeepNode(node)) {
      continue;
    }

    const tableSelection = findAssignedTableProperty(parsedFile.ast, node.range);
    if (tableSelection !== null) {
      // Keep the assignment's statement boundary so pruning entries does not
      // leave behind an isolated function or broken object literal.
      const boundary = expandRangeToBoundary(parsedFile.ast, tableSelection.table);
      ranges.push(boundary);
      if (isPrunableTable(tableSelection.table)) {
        // Several selected nodes can belong to different entries of one table;
        // collect them all before removing any sibling entries.
        const selected = tables.get(tableSelection.table) ?? new Set<AstNode>();
        selected.add(tableSelection.property);
        tables.set(tableSelection.table, selected);
      } else if (
        !precisionLosses.some((loss) => loss.start === boundary.start && loss.end === boundary.end)
      ) {
        // Computed keys and spreads can run code while the object is built;
        // retain the statement and expose the loss of output precision.
        precisionLosses.push(boundary);
      }
    } else {
      // A selected range outside a table entry may require its entire statement.
      // Remember that boundary so sibling pruning cannot erase selected code.
      const boundary = expandRangeToBoundary(parsedFile.ast, node.range);
      ranges.push(boundary);
      wholeRanges.push(boundary);
    }

    if (keepEnclosingFunctions) {
      const functionBoundary = findEnclosingFunctionBoundary(parsedFile.ast, node.range);

      if (functionBoundary !== null) {
        ranges.push(functionBoundary);
      }
    }
  }

  for (const table of tables.keys()) {
    // A whole-statement selection takes precedence over entry-level pruning.
    if (wholeRanges.some((range) => range.start <= table.start && range.end >= table.end)) {
      tables.delete(table);
      const boundary = expandRangeToBoundary(parsedFile.ast, table);
      if (
        !precisionLosses.some((loss) => loss.start === boundary.start && loss.end === boundary.end)
      ) {
        precisionLosses.push(boundary);
      }
    }
  }

  return { keepRanges: buildKeepRangeSet(ranges), tables, precisionLosses };
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

    const { keepRanges, tables, precisionLosses } = toOutputKeepRanges(
      fileNodes,
      parsedFile,
      shouldKeepNode,
      keepEnclosingFunctions,
    );
    const ms = new MagicString(parsedFile.source);
    const omitRanges = new Set<OffsetRange>();
    for (const [table, selected] of tables) {
      for (const range of getTablePropertyOmitRanges(table, selected)) {
        omitRanges.add(range);
      }
    }
    editor.apply(ms, parsedFile.source, keepRanges, mode, omitRanges);

    files.set(file, {
      path: file,
      ms,
      originalSource: parsedFile.source,
      precisionLosses,
    });
  }

  return files;
};

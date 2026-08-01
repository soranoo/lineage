import { readFileSync } from "node:fs";
import path from "node:path";

import { walkAst } from "@/helpers";
import { OxcParser } from "@/parse";
import type {
  AbsolutePath,
  AstNode,
  DependencyEdge,
  OffsetRange,
  OxcAst,
  ParsedFile,
  SourceText,
} from "@/types";

/**
 * Source entry for multi-file parsing.
 */
export type SourceEntry = {
  /** Absolute file path for the entry. */
  file: AbsolutePath;
  /** Source text for the entry. */
  source: SourceText;
};

/**
 * Build a minimal Program AST for tests.
 *
 * @returns Minimal Program AST instance.
 */
export const buildAst = (): OxcAst => ({
  type: "Program",
  body: [],
  sourceType: "module",
  hashbang: null,
  start: 0,
  end: 0,
});

/**
 * Build a ParsedFile for the provided path and source.
 *
 * @param absolutePath Absolute path for the parsed file.
 * @param source Source text to attach to the parsed file.
 * @returns ParsedFile instance for tests.
 */
export const buildParsedFile = (absolutePath: AbsolutePath, source: SourceText): ParsedFile => ({
  absolutePath,
  ast: buildAst(),
  source,
});

/**
 * Parse source text into a ParsedFile.
 *
 * @param source Source text to parse.
 * @param file Absolute path for the parsed file.
 * @returns ParsedFile for the provided source.
 */
export const parseSource = (
  source: SourceText,
  file: AbsolutePath = "/project/src/entry.ts",
): ParsedFile => {
  const parser = new OxcParser();
  return parser.parse(file, source);
};

/**
 * Build parsed files from source entries.
 *
 * @param entries Source entries to parse.
 * @returns Map of parsed files keyed by absolute path.
 */
export const buildParsedFiles = (entries: SourceEntry[]): Map<AbsolutePath, ParsedFile> => {
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
export function findNode<T extends AstNode>(
  root: AstNode,
  predicate: (node: AstNode) => node is T,
  message: string,
): T;
export function findNode(
  root: AstNode,
  predicate: (node: AstNode) => boolean,
  message: string,
): AstNode;
export function findNode(
  root: AstNode,
  predicate: (node: AstNode) => boolean,
  message: string,
): AstNode {
  let found: AstNode | null = null;

  walkAst(root, (node) => {
    if (!found && predicate(node)) {
      found = node;
    }
  });

  if (!found) {
    throw new Error(message);
  }

  return found;
}

/**
 * Convert an AST node to an offset range.
 *
 * @param node AST node to convert.
 * @returns Offset range for the node.
 */
export const toRange = (node: AstNode): OffsetRange => ({ start: node.start, end: node.end });

/**
 * Build a node ID from file and range.
 *
 * @param file Absolute file path.
 * @param range Offset range.
 * @returns Node ID string.
 */
export const buildNodeId = (file: AbsolutePath, range: OffsetRange): SourceText =>
  `${file}:${range.start}:${range.end}`;

/**
 * Test whether an edge exists in the list.
 *
 * @param edges Edge list to search.
 * @param fromId Source node ID.
 * @param toId Target node ID.
 * @param kind Edge kind to match.
 * @returns True when a matching edge exists.
 */
export const hasEdge = (
  edges: DependencyEdge[],
  fromId: SourceText,
  toId: SourceText,
  kind: SourceText,
): boolean => edges.some((edge) => edge.from === fromId && edge.to === toId && edge.kind === kind);

/**
 * Find an offset range for a required source fragment.
 *
 * @param source Source text to search.
 * @param fragment Required fragment that must exist in the source.
 * @returns Offset range spanning the first match of the fragment.
 * @throws {Error} When the fragment cannot be found.
 */
export const findRange = (source: SourceText, fragment: SourceText): OffsetRange => {
  const start = source.indexOf(fragment);

  if (start < 0) {
    throw new Error(`Fragment not found: ${fragment}`);
  }

  return { start, end: start + fragment.length };
};

/**
 * Absolute path to the fixture root folder.
 */
export const fixturesRoot: AbsolutePath = path.resolve(process.cwd(), "src/__tests__/_fixtures");

/**
 * Build an absolute path for a fixture file.
 *
 * @param relativePath Relative fixture file path under the fixture root.
 * @returns Absolute fixture file path.
 */
export const toFixturePath = (relativePath: SourceText): AbsolutePath =>
  path.resolve(fixturesRoot, relativePath);

/**
 * Read fixture source text from disk.
 *
 * @param relativePath Relative fixture file path under the fixture root.
 * @returns UTF-8 fixture source text.
 */
export const readFixtureSource = (relativePath: SourceText): SourceText =>
  readFileSync(toFixturePath(relativePath), "utf8");

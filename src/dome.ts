import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DependencyTracker, offsetFromLineCol } from "@/index";
import type {
  AbsolutePath,
  CharOffset,
  OffsetRange,
  SourceText,
  TrackerIssue,
  TrackResult,
} from "@/types";

/**
 * Demo file descriptor used for temporary project creation.
 */
type DemoFile = {
  /** Relative path under the temporary demo root. */
  relativePath: SourceText;
  /** File source text. */
  source: SourceText;
};

/**
 * Temporary demo project metadata.
 */
type DemoProject = {
  /** Temporary root directory path. */
  rootDir: AbsolutePath;
  /** Absolute entry-file path used for tracking. */
  entryFile: AbsolutePath;
  /** Source text of the entry file. */
  entrySource: SourceText;
};

/**
 * Build demo source files used by the tracker walkthrough.
 *
 * @returns List of files to write into the temporary project.
 */
const buildDemoFiles = (): DemoFile[] => [
  {
    relativePath: "main.ts",
    source: [
      "import { add } from './math.ts';",
      "import { schemaValue } from './generated/schema.ts';",
      "",
      "const base = 10;",
      "const multiplier = 2;",
      "const noise = 999;",
      "",
      "const compute = (input: number): number => {",
      "  const log = `compute ${input}`;",
      "  console.log(log);",
      "  const doubled = input * 2;",
      "  const tripled = input * 3;",
      "  return doubled;",
      "};",
      "",
      "const local = compute(base);",
      "export const finalValue = add(local, multiplier) + schemaValue;",
      "",
      "export { noise };",
    ].join("\n"),
  },
  {
    relativePath: "math.ts",
    source: [
      "export const add = (a: number, b: number): number => a + b;",
      "export const multiply = (a: number, b: number): number => a * b;",
    ].join("\n"),
  },
  {
    relativePath: "generated/schema.ts",
    source: "export const schemaValue = 7;",
  },
];

/**
 * Create a temporary demo project on disk.
 *
 * @returns Demo project metadata with entry file and source.
 */
const createDemoProject = (): DemoProject => {
  const rootDir: AbsolutePath = mkdtempSync(path.join(tmpdir(), "lineage-demo-"));
  const files = buildDemoFiles();

  for (const file of files) {
    const absolutePath: AbsolutePath = path.join(rootDir, file.relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, file.source, "utf8");
  }

  const entryFile: AbsolutePath = path.join(rootDir, "main.ts");
  const entry = files.find((file) => file.relativePath === "main.ts");

  if (!entry) {
    throw new Error("Demo entry source not found.");
  }

  return {
    rootDir,
    entryFile,
    entrySource: entry.source,
  };
};

/**
 * Compute the start-point range for `return doubled;` in the demo source.
 *
 * @param source Entry-file source text.
 * @returns Character offset range for the seed statement.
 */
const resolveStartPointRange = (source: SourceText): OffsetRange => {
  const startLine: CharOffset = 17;
  const startCol: CharOffset = 8;
  const endCol: CharOffset = 64;
  // const startLine: CharOffset = 13;
  // const startCol: CharOffset = 3;
  // const endCol: CharOffset = 18;

  const start = offsetFromLineCol(source, startLine, startCol);
  const end = offsetFromLineCol(source, startLine, endCol);

  return { start, end };
};

/**
 * Print dependency nodes and edges as a compact graph summary.
 *
 * @param result Tracker output to print.
 */
const printGraphSummary = (result: TrackResult): void => {
  console.log("\n=== Nodes ===");
  for (const node of result.nodes) {
    console.log(
      `${node.kind.padEnd(14)} | shaken=${String(node.shaken).padEnd(5)} | ${node.file}:${node.range.start}-${node.range.end}`,
    );
    console.log(`  label: ${node.label.replace(/\n/g, "\\n")}`);
  }

  console.log("\n=== Edges ===");
  for (const edge of result.edges) {
    console.log(`${edge.kind.padEnd(10)} | ${edge.from} -> ${edge.to}`);
  }
};

/**
 * Print all tracker issues.
 *
 * @param issues Issue list from tracker output.
 */
const printIssues = (issues: TrackerIssue[]): void => {
  console.log("\n=== Issues ===");
  if (issues.length === 0) {
    console.log("(none)");
    return;
  }

  for (const issue of issues) {
    console.log(
      `${issue.kind} | resolution=${issue.resolution} | ${issue.file}:${issue.range.start}-${issue.range.end}`,
    );
    console.log(`  message: ${issue.message}`);
    if (issue.matchedPattern !== undefined) {
      console.log(`  matchedPattern: ${String(issue.matchedPattern)}`);
    }
  }
};

/**
 * Print sliced source outputs for all contributing files.
 *
 * @param result Tracker output containing file slices.
 */
const printSlicedOutputs = (result: TrackResult): void => {
  console.log("\n=== Sliced Files ===");
  for (const [filePath, slicedFile] of result.files) {
    console.log(`\n--- ${filePath} ---`);
    console.log(slicedFile.ms.toString());
  }
};

/**
 * Print shaken nodes grouped by file so removed statements are explicit.
 *
 * @param result Tracker output containing shaken node metadata.
 */
const printShakenOutputs = (result: TrackResult): void => {
  console.log("\n=== Shaken Nodes (Removed/Blanked) ===");

  const shakenNodes = result.nodes.filter((node) => node.shaken);
  if (shakenNodes.length === 0) {
    console.log("(none)");
    return;
  }

  const byFile = new Map<AbsolutePath, typeof shakenNodes>();
  for (const node of shakenNodes) {
    const existing = byFile.get(node.file);
    if (existing === undefined) {
      byFile.set(node.file, [node]);
      continue;
    }

    existing.push(node);
  }

  for (const [file, nodes] of byFile) {
    console.log(`\n--- ${file} ---`);
    for (const node of nodes) {
      console.log(`${node.kind} | ${node.range.start}-${node.range.end}`);
      console.log(`  label: ${node.label.replace(/\n/g, "\\n")}`);
    }
  }
};

/**
 * Execute the end-to-end demo from source code to tracker result.
 *
 * @returns Promise that resolves when the demo is complete.
 */
const runDemo = async (): Promise<void> => {
  const project = createDemoProject();
  const startPoint = resolveStartPointRange(project.entrySource);

  console.log("Lineage E2E demo");
  console.log(`Demo root: ${project.rootDir}`);
  console.log(`Entry file: ${project.entryFile}`);
  console.log(
    `Start point: ${startPoint.start}-${startPoint.end} (${project.entrySource.slice(startPoint.start, startPoint.end)})`,
  );

  const blankTracker = new DependencyTracker({ ignorePatterns: ["generated"] });
  const blankResult = await blankTracker.track({
    entryFile: project.entryFile,
    startPoint,
    output: { mode: "blank" },
  });

  console.log("\n######## BLANK MODE ########");
  printGraphSummary(blankResult);
  printIssues(blankResult.issues);
  printShakenOutputs(blankResult);
  printSlicedOutputs(blankResult);

  const compactTracker = new DependencyTracker({ ignorePatterns: ["generated"] });
  const compactResult = await compactTracker.track({
    entryFile: project.entryFile,
    startPoint,
    output: { mode: "compact" },
  });

  console.log("\n######## COMPACT MODE ########");
  printGraphSummary(compactResult);
  printIssues(compactResult.issues);
  printShakenOutputs(compactResult);
  printSlicedOutputs(compactResult);
};

await runDemo();

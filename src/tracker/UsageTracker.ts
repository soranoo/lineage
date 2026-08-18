import { readFileSync } from "node:fs";

import { MagicStringEditor } from "@/edit";
import { assembleSlicedOutput } from "@/tracker/sliceOutput";
import { ProjectContext } from "@/tracker/ProjectContext";
import { ForwardSlicer } from "@/usage/ForwardSlicer";
import type {
  AbsolutePath,
  IEditor,
  IParser,
  ParsedFile,
  SlicedFile,
  SourceText,
  UsageRequest,
  UsageResult,
  UsageTrackerConfig,
} from "@/types";

/** Orchestrates forward usage tracking, project indexing, and optional output. */
export class UsageTracker {
  private readonly context: ProjectContext;
  private readonly parser: IParser;
  private readonly virtualFiles: ReadonlyMap<AbsolutePath, SourceText>;
  private readonly slicer: ForwardSlicer;
  private readonly editor: IEditor;

  /**
   * Create a forward usage tracker.
   *
   * @param config Usage and project-index configuration.
   * @param context Optional shared parser/resolver/project-index context.
   * @param editor Optional source editor used for requested output.
   */
  constructor(config: UsageTrackerConfig = {}, context?: ProjectContext, editor?: IEditor) {
    this.context = context ?? new ProjectContext(config);
    this.parser = this.context.getParser();
    this.virtualFiles = this.context.getVirtualFiles();
    this.slicer = new ForwardSlicer(
      this.parser,
      this.context.getProjectIndex(config),
      config.maxUsageNodes,
    );
    this.editor = editor ?? new MagicStringEditor();
  }

  /**
   * Execute one direct-reference forward usage scan.
   *
   * @param request Usage request containing the declaration and optional output mode.
   * @returns Usage graph, issues, and optional edited files.
   */
  readonly track = (request: UsageRequest): UsageResult => {
    const parsedFiles = this.ensureEntryParsed(request.entryFile);
    const sliceResult = this.slicer.slice(request.entryFile, request.startPoint, parsedFiles);
    const files =
      request.output === undefined
        ? new Map<AbsolutePath, SlicedFile>()
        : assembleSlicedOutput(
            sliceResult.nodes,
            parsedFiles,
            request.output.mode ?? "blank",
            () => true,
            this.editor,
          );

    return {
      files,
      nodes: sliceResult.nodes,
      edges: sliceResult.edges,
      issues: sliceResult.issues,
    };
  };

  /** Parse the entry when it was outside the indexer's configured file set. */
  private readonly ensureEntryParsed = (
    entryFile: AbsolutePath,
  ): Map<AbsolutePath, ParsedFile> => {
    const parsedFiles = this.parser.getCache();

    if (!parsedFiles.has(entryFile)) {
      const source = this.virtualFiles.get(entryFile) ?? readFileSync(entryFile, "utf8");
      this.parser.parse(entryFile, source);
    }

    return parsedFiles;
  };
}
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { IgnoreFilter } from "@/resolve/IgnoreFilter";
import type { AbsolutePath, ProjectScanConfig } from "@/types";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/** Enumerates source files from disk, explicit lists, and virtual files. */
export class ProjectFileScanner {
  /**
   * Enumerate the configured project files, excluding paths matched by `ignoreFilter`.
   *
   * @param config Project file sources.
   * @param ignoreFilter Filter applied to every returned path.
   * @returns Unique absolute or virtual paths in deterministic order.
   * @throws {Error} When `projectRoot` does not exist or is not a directory.
   */
  readonly scan = (config: ProjectScanConfig, ignoreFilter: IgnoreFilter): AbsolutePath[] => {
    return this.scanAll(config).filter((filePath) => ignoreFilter.match(filePath) === null);
  };

  /**
   * Enumerate source candidates before applying ignore filtering.
   *
   * Project indexing uses this view to parse ignored files for their outgoing
   * imports while separately suppressing those files as importer results.
   *
   * @param config Project file sources.
   * @returns Unique source paths in deterministic order.
   * @throws {Error} When `projectRoot` does not exist or is not a directory.
   */
  readonly scanAll = (config: ProjectScanConfig): AbsolutePath[] => {
    const candidates = new Set<AbsolutePath>();

    for (const filePath of this.collectDiskFiles(config.projectRoot)) {
      candidates.add(filePath);
    }

    for (const filePath of config.projectFiles ?? []) {
      candidates.add(filePath);
    }

    for (const filePath of Object.keys(config.virtualFiles ?? {})) {
      candidates.add(filePath);
    }

    return [...candidates].sort();
  };

  /**
   * Discover supported source files below a root directory.
   *
   * @param projectRoot Optional root directory to scan.
   * @returns Supported source paths, or an empty list when no root is configured.
   * @throws {Error} When the configured root does not exist or is not a directory.
   */
  private readonly collectDiskFiles = (projectRoot?: AbsolutePath): AbsolutePath[] => {
    if (projectRoot === undefined) {
      return [];
    }

    let rootStats: ReturnType<typeof statSync>;
    try {
      rootStats = statSync(projectRoot);
    } catch {
      throw new Error(`Project root does not exist: ${projectRoot}`);
    }

    if (!rootStats.isDirectory()) {
      throw new Error(`Project root is not a directory: ${projectRoot}`);
    }

    const entries = readdirSync(projectRoot, { recursive: true, withFileTypes: true });
    const files: AbsolutePath[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      files.push(path.resolve(entry.parentPath, entry.name));
    }

    return files;
  };
}

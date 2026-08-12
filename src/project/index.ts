import type { AbsolutePath, ExportedName, ImporterEntry } from "@/types";

/** Provides reverse-import queries to the forward slicer. */
export interface IProjectIndex {
	/**
	 * Find direct and transitive importers of an exported binding.
	 *
	 * @param sourceFile Absolute path of the exporting module.
	 * @param exportedName Exported binding to query.
	 * @returns Importer entries in graph traversal order.
	 */
	readonly findImporters: (
		sourceFile: AbsolutePath,
		exportedName: ExportedName,
	) => ImporterEntry[];
}

export { ImportGraph } from "@/project/ImportGraph";
export { ProjectIndexer } from "@/project/ProjectIndexer";

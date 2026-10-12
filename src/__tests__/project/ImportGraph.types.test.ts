import { assertNever } from "assert-never";
import { describe, expect, it } from "vitest";

import type { ImporterEntry, ReExportEntry } from "@/types";

const describeEntry = (entry: ImporterEntry | ReExportEntry): string => {
  switch (entry.kind) {
    case "import":
      return entry.localAlias;
    case "named":
    case "default":
    case "namespace":
    case "export-all":
      return entry.exportedName;
    default:
      return assertNever(entry);
  }
};

describe("ImportGraph shared types", () => {
  it("keeps graph entries structurally typed", () => {
    const importer: ImporterEntry = {
      kind: "import",
      importerFile: "/project/consumer.ts",
      exportedName: "value",
      localAlias: "alias",
    };
    const reExport: ReExportEntry = {
      kind: "named",
      reExporterFile: "/project/barrel.ts",
      sourceFile: "/project/source.ts",
      importedName: "value",
      exportedName: "publicValue",
    };

    expect(describeEntry(importer)).toBe("alias");
    expect(describeEntry(reExport)).toBe("publicValue");
  });
});

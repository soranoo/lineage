import { describe, expect, it } from "vitest";

import { collectExports, collectImports, collectSpecifiers } from "@/helpers/module-boundary";
import { OxcParser } from "@/parse";
import type { AbsolutePath, ParsedFile, SourceText } from "@/types";

const file: AbsolutePath = "/project/module.ts";

const parse = (source: SourceText): ParsedFile => new OxcParser().parse(file, source);

describe("module boundary helpers", () => {
  it("collects ESM and CommonJS specifiers once", () => {
    const parsed = parse(
      "import value from './esm'; export { value as renamed } from './esm'; " +
        "require('./common'); const other = require('./other');",
    );

    expect(collectSpecifiers(parsed.ast)).toEqual(["./esm", "./common", "./other"]);
  });

  it("records export-star boundaries", () => {
    const parsed = parse("export * from './all'; export * as namespace from './named';");

    expect(collectImports(parsed.ast)).toEqual([
      {
        kind: "re-export",
        specifier: "./all",
        importedName: "*",
        localAlias: "*",
        exportedName: "*",
        reExportKind: "export-all",
      },
      {
        kind: "re-export",
        specifier: "./named",
        importedName: "*",
        localAlias: "namespace",
        exportedName: "namespace",
        reExportKind: "namespace",
      },
    ]);
  });

  it("records CommonJS namespace and destructured bindings", () => {
    const parsed = parse(
      "require('./bare'); const namespace = require('./namespace'); " +
        "const { value, other: alias } = require('./named');",
    );

    expect(collectImports(parsed.ast)).toEqual([
      {
        kind: "import",
        specifier: "./namespace",
        importedName: "*",
        localAlias: "namespace",
      },
      {
        kind: "import",
        specifier: "./named",
        importedName: "value",
        localAlias: "value",
      },
      {
        kind: "import",
        specifier: "./named",
        importedName: "other",
        localAlias: "alias",
      },
    ]);
  });

  it("collects ESM and CommonJS exports", () => {
    const parsed = parse(
      "export const esm = 1; export { esm as renamed }; " +
        "module.exports = { cjs, shorthand }; exports.extra = value;",
    );

    expect(collectExports(parsed.ast)).toEqual([
      { exportedName: "esm", localName: "esm" },
      { exportedName: "renamed", localName: "esm" },
      { exportedName: "cjs", localName: "cjs" },
      { exportedName: "shorthand", localName: "shorthand" },
      { exportedName: "extra", localName: "value" },
    ]);
  });
});

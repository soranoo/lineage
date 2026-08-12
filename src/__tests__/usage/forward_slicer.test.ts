import { describe, expect, it } from "vitest";

import { FakeParser } from "@/__tests__/_fakes/FakeParser";
import { FakeProjectIndex } from "@/__tests__/_fakes/FakeProjectIndex";
import { buildParsedFiles, findRange } from "@/__tests__/utils";
import type { AbsolutePath, ImporterEntry, UsageNode } from "@/types";
import { ForwardSlicer } from "@/usage/ForwardSlicer";

const entryFile: AbsolutePath = "/project/entry.ts";

const sliceSource = (source: string, fragment: string, projectIndex = new FakeProjectIndex()) => {
  const parsedFiles = buildParsedFiles([{ file: entryFile, source }]);
  const parser = new FakeParser(parsedFiles);
  const slicer = new ForwardSlicer(parser, projectIndex);
  return slicer.slice(entryFile, findRange(source, fragment), parsedFiles);
};

const continuationNodes = (nodes: UsageNode[]) =>
  nodes.filter((node) => node.kind === "untraced-continuation");

describe("ForwardSlicer", () => {
  it("reports reassignment without scanning the destination binding", () => {
    const source = "const a = 1; const b = a; console.log(b);";
    const result = sliceSource(source, "const a = 1");

    expect(continuationNodes(result.nodes)).toEqual([
      expect.objectContaining({
        continuation: expect.objectContaining({
          reason: "reassignment",
          opaque: false,
          continuesAt: expect.objectContaining({ label: "b" }),
        }),
      }),
    ]);
    expect(result.nodes.some((node) => node.label === "console.log(b)")).toBe(false);
  });

  it("classifies destructure, property-write, spread, and return sinks", () => {
    const source =
      "function run(a) { const { value } = a; target.value = a; const copy = { ...a }; return a; }";
    const result = sliceSource(source, "a");
    const reasons = continuationNodes(result.nodes).map((node) => node.continuation?.reason);

    expect(reasons).toEqual(["destructure", "property-write", "spread", "return-value"]);
    expect(continuationNodes(result.nodes).map((node) => node.continuation?.opaque)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it("finds a local call parameter but does not enqueue it", () => {
    const source = "const a = 1; f(a); function f(parameter) { console.log(parameter); }";
    const result = sliceSource(source, "const a = 1");

    expect(continuationNodes(result.nodes)).toEqual([
      expect.objectContaining({
        continuation: expect.objectContaining({
          reason: "call-argument",
          opaque: false,
          continuesAt: expect.objectContaining({ label: "parameter" }),
        }),
      }),
    ]);
    expect(result.nodes.some((node) => node.label === "console.log(parameter)")).toBe(false);
  });

  it("marks unresolved call arguments opaque", () => {
    const source = "const a = 1; external(a);";
    const result = sliceSource(source, "const a = 1");

    expect(continuationNodes(result.nodes)[0]?.continuation).toEqual(
      expect.objectContaining({ reason: "call-argument", opaque: true }),
    );
  });

  it("classifies invocation separately from passing a callable value", () => {
    const source = "const getUser = makeUserFetcher(); getUser(); doSomething(getUser);";
    const result = sliceSource(source, "const getUser = makeUserFetcher");
    const reasons = continuationNodes(result.nodes).map((node) => node.continuation?.reason);

    expect(reasons).toEqual(["invoked", "call-argument"]);
  });

  it("follows exported bindings through importer aliases", () => {
    const source = "export const a = 1;";
    const importerFile: AbsolutePath = "/project/importer.ts";
    const importerSource = "import { a as alias } from './entry'; console.log(alias);";
    const parsedFiles = buildParsedFiles([
      { file: entryFile, source },
      { file: importerFile, source: importerSource },
    ]);
    const importer: ImporterEntry = {
      kind: "import",
      importerFile,
      exportedName: "a",
      localAlias: "alias",
    };
    const projectIndex = new FakeProjectIndex(new Map([["/project/entry.ts:a", [importer]]]));
    const result = new ForwardSlicer(new FakeParser(parsedFiles), projectIndex).slice(
      entryFile,
      findRange(source, "export const a"),
      parsedFiles,
    );

    expect(result.nodes.map((node) => node.kind)).toEqual([
      "start-point",
      "export-boundary",
      "import-usage",
      "read-reference",
    ]);
    expect(result.nodes.some((node) => node.label === "alias")).toBe(true);
    expect(result.edges.some((edge) => edge.kind === "import")).toBe(true);
  });

  it("follows a re-export chain to the final importer", () => {
    const hubFile: AbsolutePath = "/project/hub.ts";
    const consumerFile: AbsolutePath = "/project/consumer.ts";
    const entrySource = "export const a = 1;";
    const hubSource = "export { a } from './entry';";
    const consumerSource = "import { a } from './hub'; console.log(a);";
    const parsedFiles = buildParsedFiles([
      { file: entryFile, source: entrySource },
      { file: hubFile, source: hubSource },
      { file: consumerFile, source: consumerSource },
    ]);
    const projectIndex = new FakeProjectIndex(
      new Map([
        [
          "/project/entry.ts:a",
          [
            { kind: "import", importerFile: hubFile, exportedName: "a", localAlias: "a" },
            { kind: "import", importerFile: consumerFile, exportedName: "a", localAlias: "a" },
          ],
        ],
      ]),
    );

    const result = new ForwardSlicer(new FakeParser(parsedFiles), projectIndex).slice(
      entryFile,
      findRange(entrySource, "export const a"),
      parsedFiles,
    );

    expect(result.nodes.filter((node) => node.kind === "import-usage")).toHaveLength(2);
    expect(result.nodes.some((node) => node.file === consumerFile && node.label === "a")).toBe(
      true,
    );
  });

  it("follows CommonJS exports and destructured require aliases", () => {
    const source = "const answer = 1; exports.answer = answer;";
    const importerFile: AbsolutePath = "/project/importer.ts";
    const importerSource = "const { answer: local } = require('./entry'); console.log(local);";
    const parsedFiles = buildParsedFiles([
      { file: entryFile, source },
      { file: importerFile, source: importerSource },
    ]);
    const projectIndex = new FakeProjectIndex(
      new Map([
        [
          "/project/entry.ts:answer",
          [{ kind: "import", importerFile, exportedName: "answer", localAlias: "local" }],
        ],
      ]),
    );

    const result = new ForwardSlicer(new FakeParser(parsedFiles), projectIndex).slice(
      entryFile,
      findRange(source, "const answer"),
      parsedFiles,
    );

    expect(result.nodes.some((node) => node.kind === "export-boundary")).toBe(true);
    expect(result.nodes.some((node) => node.kind === "import-usage")).toBe(true);
    expect(result.nodes.some((node) => node.file === importerFile && node.label === "local")).toBe(
      true,
    );
  });

  it("stops a re-export cycle through the visited binding key", () => {
    const source = "export const a = 1;";
    const importerFile: AbsolutePath = "/project/importer.ts";
    const importerSource = "export { a } from './entry';";
    const parsedFiles = buildParsedFiles([
      { file: entryFile, source },
      { file: importerFile, source: importerSource },
    ]);
    const projectIndex = new FakeProjectIndex(
      new Map([
        [
          "/project/entry.ts:a",
          [{ kind: "import", importerFile, exportedName: "a", localAlias: "a" }],
        ],
        [
          "/project/importer.ts:a",
          [{ kind: "import", importerFile: entryFile, exportedName: "a", localAlias: "a" }],
        ],
      ]),
    );
    const result = new ForwardSlicer(new FakeParser(parsedFiles), projectIndex).slice(
      entryFile,
      findRange(source, "export const a"),
      parsedFiles,
    );

    expect(result.nodes.filter((node) => node.kind === "import-usage")).toHaveLength(1);
  });

  it("emits a cap issue when importer fan-out exceeds the configured limit", () => {
    const importerFile: AbsolutePath = "/project/importer.ts";
    const source = "export const a = 1;";
    const importerSource = "import { a } from './entry'; console.log(a);";
    const parsedFiles = buildParsedFiles([
      { file: entryFile, source },
      { file: importerFile, source: importerSource },
    ]);
    const projectIndex = new FakeProjectIndex(
      new Map([
        [
          "/project/entry.ts:a",
          [
            {
              kind: "import",
              importerFile,
              exportedName: "a",
              localAlias: "a",
            },
          ],
        ],
      ]),
    );
    const slicer = new ForwardSlicer(new FakeParser(parsedFiles), projectIndex, 2);

    const result = slicer.slice(entryFile, findRange(source, "export const a"), parsedFiles);

    expect(result.issues).toEqual([
      expect.objectContaining({ kind: "usage-cap-reached", resolution: "leaf" }),
    ]);
  });
});

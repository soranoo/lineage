import path from "node:path";

import { describe, expect, it } from "vitest";

import { IgnoreFilter } from "@/resolve/IgnoreFilter";
import { ProjectFileScanner } from "@/resolve/ProjectFileScanner";
import type { AbsolutePath, SourceText } from "@/types";

const fixtureRoot: AbsolutePath = path.resolve("src/__tests__/_fixtures/usage/project-scan");

const scanner = new ProjectFileScanner();

const sorted = (paths: AbsolutePath[]): AbsolutePath[] =>
  [...paths].map((filePath) => filePath.toLowerCase()).sort();

describe("ProjectFileScanner", () => {
  it("recursively returns supported source files", () => {
    const files = scanner.scan({ projectRoot: fixtureRoot }, new IgnoreFilter([]));

    expect(sorted(files)).toEqual(
      sorted([
        path.join(fixtureRoot, "nested", "component.tsx"),
        path.join(fixtureRoot, "nested", "runtime.js"),
        path.join(fixtureRoot, "entry.ts"),
        path.join(fixtureRoot, "ignored.ts"),
        path.join(fixtureRoot, "plain.jsx"),
      ]),
    );
  });

  it("excludes custom and implicit ignored paths", () => {
    const files = scanner.scan(
      { projectRoot: fixtureRoot },
      new IgnoreFilter(["ignored", /node_modules/]),
    );

    expect(files.some((file) => file.includes("ignored"))).toBe(false);
    expect(files.some((file) => file.includes("node_modules"))).toBe(false);
  });

  it("returns explicitly supplied files after ignore filtering", () => {
    const files = scanner.scan(
      {
        projectFiles: [
          path.join(fixtureRoot, "entry.ts"),
          path.join(fixtureRoot, "ignored.ts"),
          path.join(fixtureRoot, "plain.jsx"),
        ],
      },
      new IgnoreFilter(["ignored"]),
    );

    expect(sorted(files)).toEqual(
      sorted([path.join(fixtureRoot, "entry.ts"), path.join(fixtureRoot, "plain.jsx")]),
    );
  });

  it("returns virtual file keys without touching disk", () => {
    const virtualPath = "/virtual/project/entry.ts";
    const virtualFiles: Record<AbsolutePath, SourceText> = {
      [virtualPath]: "export const value = 1;",
    };

    expect(scanner.scan({ virtualFiles }, new IgnoreFilter([]))).toEqual([virtualPath]);
  });

  it("unions root files and virtual file keys", () => {
    const virtualPath = "/virtual/project/virtual.ts";
    const files = scanner.scan(
      {
        projectRoot: fixtureRoot,
        virtualFiles: { [virtualPath]: "export const value = 1;" },
      },
      new IgnoreFilter([]),
    );

    expect(files).toContain(virtualPath);
    expect(files.map((filePath) => filePath.toLowerCase())).toContain(
      path.join(fixtureRoot, "entry.ts").toLowerCase(),
    );
  });

  it("throws a descriptive error when the project root is missing", () => {
    expect(() =>
      scanner.scan({ projectRoot: path.join(fixtureRoot, "missing") }, new IgnoreFilter([])),
    ).toThrow(/project root.*does not exist/i);
  });
});

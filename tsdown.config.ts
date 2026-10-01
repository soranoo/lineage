import { readFileSync } from "node:fs";

import { defineConfig } from "tsdown";
import type { Rolldown } from "tsdown";

/** Package fields used to decide which dependencies stay external to the bundle. */
interface PackageJson {
  /** Runtime dependencies listed in package.json. */
  dependencies?: Record<string, string>;
}

const packageJson: PackageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

/**
 * Create a plugin that imports raw files and Markdown as source text.
 * @returns A plugin that turns matching files into string exports.
 */
const rawText = (): Rolldown.Plugin => {
  return {
    name: "raw-text",
    /**
     * Load files requested with `?raw` as string exports.
     * @param id Module ID passed to the build plugin.
     * @returns A string-export module for a `?raw` request, or undefined otherwise.
     */
    load(id) {
      if (id.endsWith("?raw")) {
        const path = id.slice(0, -"?raw".length);
        return `export default ${JSON.stringify(readFileSync(path, "utf8"))}`;
      }
    },
    /**
     * Transform Markdown source into a string export.
     * @param code Source text passed to the build plugin.
     * @param id Module ID used to recognize Markdown files.
     * @returns A string-export module for Markdown, or undefined for another file type.
     */
    transform(code, id) {
      if (id.endsWith(".md")) {
        return { code: `export default ${JSON.stringify(code)}`, map: null };
      }
    },
  };
};

export default defineConfig({
  entry: [
    "src/**/*.ts",
    "!src/**/*.d.ts",

    // ignore test files
    "!src/**/__tests__/**",
    "!src/**/*.test.ts",
    "!src/**/*.spec.ts",
  ],
  plugins: [rawText()],
  unbundle: true,
  platform: "neutral",
  format: ["esm"],
  dts: true,
  sourcemap: false,
  clean: true,
  outDir: "./dist",
  deps: {
    neverBundle: [...Object.keys(packageJson.dependencies ?? {}), /^node:/],
    onlyBundle: false,
  },
});

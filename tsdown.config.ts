import { readFileSync } from "node:fs";

import { defineConfig } from "tsdown";
import type { Rolldown } from "tsdown";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as {
  dependencies?: Record<string, string>;
};

const rawText = (): Rolldown.Plugin => {
  return {
    name: "raw-text",
    load(id) {
      if (id.endsWith("?raw")) {
        const path = id.slice(0, -"?raw".length);
        return `export default ${JSON.stringify(readFileSync(path, "utf8"))}`;
      }
    },
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

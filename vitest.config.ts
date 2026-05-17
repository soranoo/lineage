import path from "node:path";
import { defineConfig } from "vitest/config";

const __dirname = import.meta.dir;

export default defineConfig({
  test: {
    includeSource: ["src/**/*.{ts}"],
    include: ["src/**/*.{test,spec}.{ts}"],
    coverage: {
      provider: "v8",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});

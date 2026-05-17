import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    includeSource: ["src/**/*.{ts}"],
    include: ["src/**/*.{test,spec}.{ts}"],
    coverage: {
      provider: "v8",
    },
  },
});

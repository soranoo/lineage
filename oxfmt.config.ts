import { defineConfig } from "oxfmt";

export default defineConfig({
  singleQuote: false,
  ignorePatterns: [],
  sortImports: {
    order: "asc",
    ignoreCase: true,
    newlinesBetween: true,
    internalPattern: ["@/**"],
    groups: [
      ["type-builtin", "builtin"],
      ["type-external", "external"],
      ["type-internal", "internal"],
      ["style"],
      ["unknown"],
    ],
  },
});

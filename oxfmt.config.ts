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
      ["builtin", "type-builtin"],
      ["external", "type-external"],
      ["internal", "type-internal"],
      ["style"],
      ["unknown"],
    ],
  },
});

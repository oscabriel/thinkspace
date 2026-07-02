import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, react],
  ignorePatterns: core.ignorePatterns,
  rules: {
    // Intentional barrel hubs (domain adapters, db schema) are architectural seams.
    "oxc/no-barrel-file": "off",
    // Async-port implementations legitimately have await-free async methods.
    "require-await": "off",
  },
});

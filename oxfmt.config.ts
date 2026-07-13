import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // DESIGN.md's YAML metadata block isn't recognized as front matter (an HTML comment
  // precedes the opening ---), so the Markdown formatter would corrupt it.
  ignorePatterns: [...(ultracite.ignorePatterns ?? []), "DESIGN.md"],
});

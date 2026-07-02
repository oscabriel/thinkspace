export const dependencyRules = [
  {
    layer: "domain",
    mayImport: ["zod"],
    mustNotImport: [
      "@cloudflare/agents",
      "@cloudflare/think",
      "@cloudflare/shell",
      "drizzle-orm",
      "hono",
      "wrangler",
    ],
  },
  {
    layer: "adapters",
    mayImport: ["domain seams", "runtime SDKs"],
    mustNotImport: ["UI routes"],
  },
  {
    layer: "transport edges",
    mayImport: ["domain seams", "edge translators"],
    mustNotImport: [
      "D1 SQL directly",
      "R2 buckets directly",
      "Think SDK directly",
    ],
  },
] as const;

export type DependencyRules = typeof dependencyRules;

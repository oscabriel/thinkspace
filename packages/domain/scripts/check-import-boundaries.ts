import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { dependencyRules } from "../src/dependency-rules";

interface ImportUse {
  readonly file: string;
  readonly specifier: string;
}

interface BoundaryViolation {
  readonly file: string;
  readonly message: string;
  readonly specifier: string;
}

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const packageDirectory = join(scriptDirectory, "..");
const sourceDirectory = join(packageDirectory, "src");

const getRule = (layer: string) => {
  const rule = dependencyRules.find((candidate) => candidate.layer === layer);
  if (rule === undefined) {
    throw new Error(`Missing dependency rule for layer: ${layer}`);
  }
  return rule;
};

const domainRule = getRule("domain");
const adapterRule = getRule("adapters");
const transportRule = getRule("transport edges");

const listTypeScriptFiles = (directory: string): readonly string[] => {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      files.push(...listTypeScriptFiles(path));
      continue;
    }

    if (entry.endsWith(".ts")) {
      files.push(path);
    }
  }

  return files;
};

const importSpecifiers = (file: string): readonly ImportUse[] => {
  const source = readFileSync(file, "utf8");
  const imports: ImportUse[] = [];
  const staticImportPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\sfrom\s*)?["']([^"']+)["']/g;
  const dynamicImportPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(staticImportPattern)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      imports.push({ file, specifier });
    }
  }

  for (const match of source.matchAll(dynamicImportPattern)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      imports.push({ file, specifier });
    }
  }

  return imports;
};

const relativeSourcePath = (file: string): string =>
  relative(sourceDirectory, file).split(sep).join("/");

const isNodeBuiltin = (specifier: string): boolean =>
  specifier.startsWith("node:");

const isExternal = (specifier: string): boolean =>
  !specifier.startsWith(".") &&
  !specifier.startsWith("/") &&
  !isNodeBuiltin(specifier);

const matchesPackage = (specifier: string, packageName: string): boolean =>
  specifier === packageName || specifier.startsWith(`${packageName}/`);

const isDomainLayerFile = (file: string): boolean =>
  !relativeSourcePath(file).startsWith("adapters/");

const isAdapterLayerFile = (file: string): boolean =>
  relativeSourcePath(file).startsWith("adapters/");

const isTransportLayerFile = (file: string): boolean => {
  const path = relativeSourcePath(file);
  return path.startsWith("edges/") || path.startsWith("transport/");
};

const relativeTargetPath = (use: ImportUse): string =>
  relative(sourceDirectory, resolve(dirname(use.file), use.specifier))
    .split(sep)
    .join("/");

const isAdapterTarget = (use: ImportUse): boolean => {
  const target = relativeTargetPath(use);
  return target === "adapters" || target.startsWith("adapters/");
};

const checkDomainImport = (use: ImportUse): BoundaryViolation | null => {
  if (!isExternal(use.specifier)) {
    return isAdapterTarget(use)
      ? {
          file: use.file,
          message: "domain layer must not import or re-export adapter modules",
          specifier: use.specifier,
        }
      : null;
  }

  for (const forbidden of domainRule.mustNotImport) {
    if (matchesPackage(use.specifier, forbidden)) {
      return {
        file: use.file,
        message: `domain layer must not import ${forbidden}`,
        specifier: use.specifier,
      };
    }
  }

  return domainRule.mayImport.includes(use.specifier)
    ? null
    : {
        file: use.file,
        message: `domain layer external import is not allowlisted (${domainRule.mayImport.join(", ")})`,
        specifier: use.specifier,
      };
};

const checkAdapterImport = (use: ImportUse): BoundaryViolation | null => {
  const importsUiRoute =
    use.specifier.includes("apps/web") ||
    use.specifier.includes("apps/server") ||
    matchesPackage(use.specifier, "@thinkspace/ui");

  return importsUiRoute
    ? {
        file: use.file,
        message: `adapter layer must not import ${adapterRule.mustNotImport.join(", ")}`,
        specifier: use.specifier,
      }
    : null;
};

const checkTransportImport = (use: ImportUse): BoundaryViolation | null => {
  const forbiddenPackages = [
    "@cloudflare/agents",
    "@cloudflare/shell",
    "@cloudflare/think",
    "drizzle-orm",
  ];
  const matchedForbidden = forbiddenPackages.find((packageName) =>
    matchesPackage(use.specifier, packageName)
  );

  return matchedForbidden === undefined
    ? null
    : {
        file: use.file,
        message: `transport edge must not import ${transportRule.mustNotImport.join(", ")}`,
        specifier: use.specifier,
      };
};

const violations = listTypeScriptFiles(sourceDirectory).flatMap((file) =>
  importSpecifiers(file).flatMap((use) => {
    const checks: BoundaryViolation[] = [];

    if (isDomainLayerFile(file)) {
      const violation = checkDomainImport(use);
      if (violation !== null) {
        checks.push(violation);
      }
    }

    if (isAdapterLayerFile(file)) {
      const violation = checkAdapterImport(use);
      if (violation !== null) {
        checks.push(violation);
      }
    }

    if (isTransportLayerFile(file)) {
      const violation = checkTransportImport(use);
      if (violation !== null) {
        checks.push(violation);
      }
    }

    return checks;
  })
);

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(
      `${relative(packageDirectory, violation.file)} imports ${violation.specifier}: ${violation.message}`
    );
  }

  process.exit(1);
}

console.log("Domain import-boundary checks passed.");

/**
 * The modules `workers/edge` reads at RUNTIME must stay free of runtime
 * imports (issue #1285).
 *
 * The edge Worker is bundled: a single value import from a module that imports
 * zod drags all 79 of zod's files into every isolate it starts, which is what
 * `AGENT_PATHS` and `DEFAULT_IDENTITY_POLICY` did before they were extracted
 * into their own modules. `workers/edge/bundle-smoke/entry-bundle.test.ts`
 * measures the built artifact; this gate fails one package earlier, on the
 * line that would cause it, and says which module lost the property.
 *
 * The scan covers all four shapes a module can be loaded by, not just the
 * `… from "…"` one: a side-effect `import "zod";` carries no `from` clause at
 * all, and `import("zod")` / `require("zod")` are calls. Reading only the
 * `from` form would report green on exactly the lines this gate exists to
 * catch (PR #1310 review).
 *
 * It is a pattern scan and not a parse because TypeScript 7.0.2 — the Go port
 * this repo pins — exposes no JS compiler API at all (`typescript` resolves to
 * `lib/version.cjs`, whose only exports are `version` and `versionMajorMinor`,
 * so there is no `createSourceFile` to call). Two consequences are deliberate:
 * the static patterns are anchored at the start of a line, where a doc-comment
 * line (`*`) or a line comment (`//`) cannot reach, while the call patterns are
 * not anchored and so also see a specifier written inside a comment. That
 * direction is the safe one — a false alarm costs one reworded comment, a
 * false green is the defect.
 *
 * `import type` / `export type` are the allowed forms: TypeScript erases them,
 * so they reach no bundle. An inline-`type` clause
 * (`import { type z } from "zod"`) is NOT allowed and is deliberately
 * reported — Node's type stripping leaves `import {} from "zod"` behind, which
 * still loads the module.
 *
 * test-type: unit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every contract module `workers/edge/src` takes a VALUE from. `jwt.ts` and
 * `oidc-github.ts` are the deliberate exceptions: they import jose, which the
 * Worker's own identity code loads anyway, so no bundle grows for them.
 */
const WORKER_READ_MODULES = [
  "src/agent-paths.ts",
  "src/agent-tool-schemas.ts",
  "src/constants.ts",
  "src/identity-policy.ts",
  "src/internal-binding.ts",
];

/** `import … from "x"` and `export … from "x"`, `type` forms excluded. The
 * `from` clause is required so `export const HEADER = "X-User-Id";` is not
 * read as a load. */
const FROM_LOAD = /^[ \t]*(?:import|export)\s+(?!type[\s{*])[^;]*?\bfrom\s*["']([^"']+)["']/gm;

/** `import "x";` — the side-effect form, which has no `from` clause. */
const SIDE_EFFECT_LOAD = /^[ \t]*import\s*["']([^"']+)["']/gm;

/** `import("x")` and `require("x")` — the call forms, at any depth. */
const CALL_LOAD = /\b(?:import|require)\s*\(\s*["']([^"']+)["']/g;

/** Every module this source loads when it is evaluated. */
function runtimeImports(source: string): string[] {
  const patterns = [FROM_LOAD, SIDE_EFFECT_LOAD, CALL_LOAD];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1] ?? ""));
}

function moduleSource(module: string): string {
  return readFileSync(new URL(`../${module}`, import.meta.url), "utf8");
}

describe("the contract modules the edge Worker reads at runtime", () => {
  it.each(WORKER_READ_MODULES)("loads %s without executing an import", (module) => {
    expect(runtimeImports(moduleSource(module))).toStrictEqual([]);
  });
});

describe("the scan behind that gate", () => {
  it("catches a side-effect import, which carries no `from` clause", () => {
    expect(runtimeImports('import "zod";\n')).toStrictEqual(["zod"]);
  });

  it("catches a dynamic import inside a function body", () => {
    expect(runtimeImports('export async function schema() {\n  return await import("zod");\n}\n')).toStrictEqual(["zod"]);
  });

  it("catches a require call", () => {
    expect(runtimeImports('const { z } = require("zod");\n')).toStrictEqual(["zod"]);
  });

  it("catches a value re-export", () => {
    expect(runtimeImports('export { z } from "zod";\n')).toStrictEqual(["zod"]);
  });

  it("catches a star re-export", () => {
    expect(runtimeImports('export * from "zod";\n')).toStrictEqual(["zod"]);
  });

  it("catches an inline-`type` clause, which still leaves a load behind", () => {
    expect(runtimeImports('import { type ZodType } from "zod";\n')).toStrictEqual(["zod"]);
  });

  it("catches an import whose clause spans several lines", () => {
    expect(runtimeImports('import {\n  z,\n  type ZodType,\n} from "zod";\n')).toStrictEqual(["zod"]);
  });

  it("lets a type-only import through", () => {
    expect(runtimeImports('import type { ZodType } from "zod";\n')).toStrictEqual([]);
  });

  it("lets a type-only re-export through", () => {
    expect(runtimeImports('export type { ZodType } from "zod";\n')).toStrictEqual([]);
  });

  it("lets a string-valued constant through, which has no `from` clause", () => {
    expect(runtimeImports('export const USER_IDENTITY_HEADER = "X-User-Id";\n')).toStrictEqual([]);
  });

  it("lets a local export with no specifier through", () => {
    expect(runtimeImports("const answer = 42;\nexport { answer };\n")).toStrictEqual([]);
  });

  it("does not read prose in a doc comment as an import", () => {
    expect(runtimeImports(' * Keep this module import-free: no `import "zod"` here.\n')).toStrictEqual([]);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const WRANGLER = read("../wrangler.toml");
const ENTRY = read("../src/entry.ts");
const ENVIRONMENTS = ["", "env.production.", "env.staging."] as const;

/** Every class name any environment binds a Durable Object to. */
function boundClasses(): string[] {
  return [...WRANGLER.matchAll(/^class_name = "([^"]+)"$/gm)].map((match) => match[1] ?? "");
}

/** The `[[<prefix>migrations]]` tags that declare `className` as new. */
function migrationTagsFor(className: string): string[] {
  const blocks = [...WRANGLER.matchAll(/\[\[(?:env\.\w+\.)?migrations\]\]\ntag = "(v\d+)"\nnew_sqlite_classes = \[([^\]]*)\]/g)];
  return blocks.filter((block) => (block[2] ?? "").includes(`"${className}"`)).map((block) => block[1] ?? "");
}

void test("every Durable Object class the config binds is exported by the Worker entry", () => {
  const unexported = [...new Set(boundClasses())].filter((name) => !new RegExp(`export (?:class ${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\})`).test(ENTRY));
  assert.deepEqual(unexported, [], "wrangler resolves class_name against src/entry.ts's exports");
});

void test("retired RunSweeper has no active namespace binding", () => {
  assert.doesNotMatch(WRANGLER, /name = "RUN_SWEEPER"/);
});

void test("AgentSession is bound in every environment, once each", () => {
  const bindings = [...WRANGLER.matchAll(/name = "AGENT_SESSION"\nclass_name = "AgentSession"/g)];
  assert.equal(bindings.length, ENVIRONMENTS.length);
});

void test("AgentSession is declared new in every environment's migration chain", () => {
  assert.deepEqual(migrationTagsFor("AgentSession"), ["v4", "v4", "v4"]);
});

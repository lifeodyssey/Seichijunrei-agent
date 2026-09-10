/**
 * Emit an OpenAPI 3.1 JSON spec from the Catalog oRPC contract.
 *
 * Output: packages/contract/openapi.json
 * The Python client is generated / typed from this spec.
 *
 * Run: npm run emit:openapi
 */

import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import type { AgentPath } from "../src/agent-paths.js";
import { AGENT_PATHS } from "../src/agent-paths.js";
import { catalogContract } from "../src/contract.js";
import type { ApiDocument, WireOperation } from "../src/operation-set.js";
import { usersContract } from "../src/users-contract.js";

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

type Contract = Parameters<OpenAPIGenerator["generate"]>[0];
type GenerateOptions = Parameters<OpenAPIGenerator["generate"]>[1];

type GeneratedSpec = Awaited<ReturnType<typeof generator.generate>>;

function describeEmission(contract: Contract, spec: GeneratedSpec): void {
  const methods = Object.keys(contract);
  const schemas = Object.keys(spec.components?.schemas ?? {});
  process.stdout.write(`Methods: ${methods.join(", ")}\n`);
  process.stdout.write(`Schemas: ${schemas.join(", ") || "(inlined)"}\n`);
}

function resolveOutPath(filename: string): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", filename);
}

function writeSpec(spec: object, filename: string): void {
  const outPath = resolveOutPath(filename);
  writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${outPath}\n`);
}

async function emitOpenApi(
  contract: Contract,
  filename: string,
  options: GenerateOptions,
): Promise<void> {
  const spec = await generator.generate(contract, options);
  writeSpec(spec, filename);
  describeEmission(contract, spec);
}

await emitOpenApi(catalogContract, "openapi.json", {
  info: {
    title: "Animichi Catalog Service",
    version: "0.1.0",
    description:
      "Read methods of the TS Catalog service, consumed by the Python Agent service.",
  },
});

// The Users document is emitted from the complete users service contract —
// the same object the Users worker's `implement(usersContract)` router mounts.
// A phantom procedure (present in the contract but absent from the mounted
// router) would still surface here, so the Users-side parity check in
// workers/users/test/operation-parity.worker.test.ts is what closes that gap.
await emitOpenApi(usersContract, "users-openapi.json", {
  info: {
    title: "Animichi Users Service",
    version: "0.1.0",
    description: "User-domain routes of the TS Users service, consumed by apps/web.",
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
  },
});

// The Agent boundary document: emitted from the AGENT_PATHS inventory
// (CONTRACT-1 #938), the same inventory the edge route tables reference. The
// Python-side parity check in apps/agent asserts these operations equal the
// FastAPI router's mounted operations.
function agentOperation(entry: AgentPath): WireOperation {
  return {
    summary: entry.summary,
    ...(entry.runtime ? { "x-runtime": entry.runtime } : {}),
    responses: { "200": { description: "Successful response" } },
  };
}

function agentPaths(): ApiDocument["paths"] {
  const paths: ApiDocument["paths"] = {};
  for (const entry of AGENT_PATHS) {
    paths[entry.path] = { [entry.method.toLowerCase()]: agentOperation(entry) };
  }
  return paths;
}

function emitAgentOpenApi(): ApiDocument {
  return {
    openapi: "3.1.0",
    info: { title: "Animichi Agent Service", version: "0.1.0" },
    paths: agentPaths(),
  };
}

writeSpec(emitAgentOpenApi(), "agent-openapi.json");
process.stdout.write("Agent methods: " + AGENT_PATHS.map((entry) => `${entry.method} ${entry.path}`).join(", ") + "\n");

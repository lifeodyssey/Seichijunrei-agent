import * as pulumi from "@pulumi/pulumi";
import type { Built } from "./harness.ts";

export const RUNTIME_KEYS = [
  "DEEPSEEK_API_KEY", "MIMO_API_KEY", "ZEN_GO_API_KEY",
  "GOOGLE_MAPS_API_KEY", "LOGFIRE_TOKEN", "TURNSTILE_SECRET", "ANON_ID_SECRET",
];

export function runtimeConfig(): Record<string, string> {
  return Object.fromEntries([
    ["animichi-neon-secrets:cloudflareAccountId", "account-fixture"],
    ["animichi-neon-secrets:secretsStoreId", "store-fixture"],
    ["animichi-neon-secrets:anonymousAccessEnabled", "true"],
    ...RUNTIME_KEYS.map((name) => [`animichi-neon-secrets:${name}`, `fixture-${name}`]),
  ]);
}

function installMocks(stack: string, built: Built[]): void {
  pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      built.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}-id`, state: args.inputs };
    },
    call: (args: pulumi.runtime.MockCallArgs) => args.inputs,
  }, "animichi-neon-secrets", stack, false);
}

export async function buildRuntimeSecrets(stack: string, config = runtimeConfig()): Promise<Built[]> {
  const built: Built[] = [];
  installMocks(stack, built);
  pulumi.runtime.setAllConfig(config);
  const program = await import("../database-access/runtime-secrets.ts");
  await new Promise((resolve) => program.edgeRuntimeSecretNames.apply(resolve));
  return built;
}

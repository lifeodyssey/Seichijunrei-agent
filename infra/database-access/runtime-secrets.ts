import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

const config = new pulumi.Config();
const accountId = config.require("cloudflareAccountId");
const storeId = config.require("secretsStoreId");
const suffix = pulumi.getStack() === "prod" ? "_PROD" : "";
const names = [
  "DEEPSEEK_API_KEY", "MIMO_API_KEY", "ZEN_GO_API_KEY",
  "GOOGLE_MAPS_API_KEY", "LOGFIRE_TOKEN",
  ...(config.requireBoolean("anonymousAccessEnabled") ? ["TURNSTILE_SECRET", "ANON_ID_SECRET"] : []),
];

function requiredRuntimeSecret(name: string): pulumi.Output<string> {
  return config.requireSecret(name).apply((value) => {
    if (value.trim().length === 0) throw new Error(`Empty runtime secret: ${name}`);
    return value;
  });
}

const secrets = names.map((name) => new cloudflare.SecretsStoreSecret(`${name}${suffix}`, {
  accountId,
  storeId,
  name: `${name}${suffix}`,
  value: requiredRuntimeSecret(name),
  scopes: ["workers"],
}, name === "ANON_ID_SECRET" ? { retainOnDelete: true } : undefined));

export const edgeRuntimeSecretNames = pulumi.all(secrets.map((secret) => secret.name));

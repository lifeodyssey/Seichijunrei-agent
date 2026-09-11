import { parsePreflightMetadata } from "../src/preflight-metadata";
import { productionChain } from "./fixtures/selected-chain";
import { metadata } from "./preflight-fixtures";
import { DSN, FIXED_NOW } from "./http-apply.helpers";
import type { FakeSql } from "./fake-sql";

export function selectedMetadata(body: unknown = metadata) {
  const selected = parsePreflightMetadata(JSON.stringify(body));
  if (!selected) throw new Error("invalid selected test metadata");
  return selected;
}

export function selectedInput(db: FakeSql) {
  return { dsn: DSN, source: productionChain, connect: db.connect, now: () => FIXED_NOW };
}

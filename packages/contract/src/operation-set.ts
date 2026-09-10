/**
 * API operation sets — the shared vocabulary for OpenAPI/runtime parity.
 *
 * One "operation" is an HTTP method bound to a route template (e.g.
 * `GET /v1/users/saved-routes`). Both generated OpenAPI documents and oRPC
 * contracts reduce to this same shape, which is what makes "the generated
 * surface equals the mounted surface" a machine check (issue #1005 AC1).
 *
 * Two extraction paths are provided:
 *  - `operationsFromOpenApi` walks a generated OpenAPI document's `paths`;
 *  - `operationsFromContractRouter` reads each oRPC contract procedure's
 *    route definition. Flat routers only: a nested router value fails loudly
 *    rather than being silently skipped.
 *
 * The wire-shape types (`WireSchema` / `WireOperation` / `ApiDocument`) are a
 * deliberate structural mirror of the emitted JSON — deliberately minimal, so
 * both the emitter and the diff/vet tooling read and write the same shape.
 */

import { isContractProcedure } from "@orpc/contract";

/** One advertised API operation: an HTTP method bound to a route template. */
export interface ApiOperation {
  readonly method: string;
  readonly path: string;
}

/** Structural mirror of one JSON schema node in an emitted document. */
export interface WireSchema {
  readonly type?: string;
  readonly properties?: Record<string, WireSchema>;
  readonly required?: readonly string[];
  readonly items?: WireSchema;
  readonly enum?: readonly unknown[];
  readonly anyOf?: readonly WireSchema[];
  readonly $ref?: string;
}

/** JSON media-type content, structurally mirroring `content.application/json`. */
export interface WireContent {
  readonly "application/json"?: { readonly schema?: WireSchema };
}

/** One operation response, structurally mirroring `responses[status]`. */
export interface WireResponse {
  readonly description?: string;
  readonly content?: WireContent;
}

/** Structural mirror of one emitted OpenAPI operation. */
export interface WireOperation {
  readonly "x-runtime"?: "edge";
  readonly summary?: string;
  readonly deprecated?: boolean;
  readonly "x-sunset"?: string;
  readonly security?: readonly unknown[];
  readonly requestBody?: {
    readonly required?: boolean;
    readonly content?: WireContent;
  };
  readonly responses: Readonly<Record<string, WireResponse>>;
}

/** Structural mirror of an emitted OpenAPI document's operation surface. */
export interface ApiDocument {
  readonly openapi?: string;
  readonly info?: unknown;
  readonly paths: Record<string, Record<string, WireOperation>>;
}

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
] as const;

/** Canonical string key for an operation, e.g. `"GET /v1/users/saved-routes"`. */
export function operationKey(operation: ApiOperation): string {
  return `${operation.method} ${operation.path}`;
}

/** Deterministic operation ordering by canonical key. */
export function sortOperations(operations: readonly ApiOperation[]): ApiOperation[] {
  return [...operations].sort((a, b) => (operationKey(a) < operationKey(b) ? -1 : 1));
}

/** Extract the operation set from a generated OpenAPI document. */
export function operationsFromOpenApi(document: ApiDocument): ApiOperation[] {
  const operations: ApiOperation[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    operations.push(...operationsForPath(item, path));
  }
  return operations;
}

/** The operations declared under one path item, in the standard method order. */
function operationsForPath(item: Record<string, WireOperation>, path: string): ApiOperation[] {
  const operations: ApiOperation[] = [];
  for (const method of HTTP_METHODS) {
    const operation = item[method];
    if (operation !== undefined) {
      operations.push({ method: method.toUpperCase(), path });
    }
  }
  return operations;
}

/** Extract the operation set from a flat oRPC contract (procedures only). */
export function operationsFromContractRouter(
  router: Readonly<Record<string, unknown>>,
): ApiOperation[] {
  const operations: ApiOperation[] = [];
  for (const [name, procedure] of Object.entries(router)) {
    operations.push(procedureOperation(name, procedure));
  }
  return operations;
}

/** One procedure's route as an operation; a non-procedure or routeless entry
 * fails loudly — a nested router can never be silently skipped. */
function procedureOperation(name: string, procedure: unknown): ApiOperation {
  if (!isContractProcedure(procedure)) {
    throw new Error(
      `contract router entry "${name}" is not a procedure; only flat contract routers are supported`,
    );
  }
  const { method, path } = routedMethodPath(name, procedure);
  return { method: method.toUpperCase(), path };
}

/** The oRPC route definition carried by a contract procedure. */
function routeOf(procedure: unknown): { method: unknown; path: unknown } {
  return (procedure as { "~orpc": { route: { method: unknown; path: unknown } } })["~orpc"].route;
}

function routedMethodPath(
  name: string,
  procedure: unknown,
): { method: string; path: string } {
  const { method, path } = routeOf(procedure);
  if (typeof method !== "string" || typeof path !== "string") {
    throw new Error(`contract procedure "${name}" is missing its HTTP method or path route`);
  }
  return { method, path };
}

/** Restrict a contract to the procedures actually mounted by a service router.
 * A mounted procedure name that is absent from the contract fails loudly — a
 * router can never outrun its contract. */
/** A mounted procedure's contract entry; a missing definition fails loudly. */
function mountedProcedure(
  contract: Readonly<Record<string, unknown>>,
  name: string,
): unknown {
  const procedure = contract[name];
  if (procedure === undefined) {
    throw new Error(`mounted procedure "${name}" has no contract definition`);
  }
  return procedure;
}

export function contractSubset(
  contract: Readonly<Record<string, unknown>>,
  mountedNames: readonly string[],
): Record<string, unknown> {
  const subset: Record<string, unknown> = {};
  for (const name of mountedNames) {
    subset[name] = mountedProcedure(contract, name);
  }
  return subset;
}

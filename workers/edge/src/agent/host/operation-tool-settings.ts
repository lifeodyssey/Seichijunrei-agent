import { LatLng } from "@animichi/contract/models";
import { createContextKey, withContextValue, type Context } from "@earendil-works/pi-agent-core/harness/context";
import { value, type Session } from "@earendil-works/pi-agent-core/harness/session";
import type { PilgrimageToolContext } from "@animichi/agent/tools";
import { z } from "zod";
import type { NativeSessionResources } from "./native-bootstrap.ts";
import type { OperationCredentials } from "./configured-admission.ts";
import type { ModelAdmissionRequest } from "../admission/types.ts";

type OperationTools = Pick<PilgrimageToolContext, "locale" | "origin" | "translation">;
const operationTools = createContextKey<OperationTools>("native operation tool settings");
const inputSchema = z.object({ locale: z.enum(["ja", "zh", "en"]), origin: LatLng.optional() }).strict();
const inputAddress = (operationId: string) => value<unknown>("animichi.operation.input", operationId);

/** A public native application scalar, committed before accept; no credential enters durable storage. */
export async function persistOperationInput(session: Session, operationId: string, request: ModelAdmissionRequest, context: Context) {
  const input = { locale: request.locale, ...(request.origin ? { origin: request.origin } : {}) };
  await session.setValue(inputAddress(operationId), inputSchema.parse(input), context);
}

export function requireOperationTools(context: Context): OperationTools {
  const settings = context.value(operationTools);
  if (!settings) throw new Error("The native operation tool settings are unavailable");
  return settings;
}

/** Re-read stable input on every drive, including cold recovery; ephemeral Models never fall back across payers. */
export async function operationToolsContext(resources: NativeSessionResources, credentials: OperationCredentials, session: Session, operationId: string, context: Context) {
  const row = await resources.db.orm.public.AgentAdmission.where({ sessionId: session.metadata.id, operationId }).first();
  if (!row) throw new Error("The native operation admission is unavailable");
  const input = inputSchema.parse((await session.getValue(inputAddress(operationId), context))?.value);
  const caller = credentials.get(operationId);
  const translation = row.payer === "byok"
    ? caller && { models: caller.models, model: caller.model, payer: "byok" as const }
    : resources.server.available ? { models: resources.server.models, model: resources.server.model, payer: "platform" as const } : undefined;
  return withContextValue(operationTools, { ...input, translation }, context);
}

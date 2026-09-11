import { Latitude, Longitude, type LatLng } from "@animichi/contract/models";
import type { ModelAdmissionRequest } from "../agent/admission/types.ts";
import { byokCredentialIn } from "../agent/byok/byok-headers.ts";
import type { ByokCredentialParts } from "../agent/byok/byok-credential.ts";
import { SelectionRequest } from "@animichi/agent/selection";
import { z } from "zod";
import { ChatEnvelopeError, chatTurnText, type Locale } from "./chat-envelope.ts";
import type { TurnIdentity } from "./agent-turn.ts";
export const MESSAGE_MAX_CHARS = 4_000;
const HEADER_KEY_MAX_CHARS = 200;
export interface NativeSubmission extends ModelAdmissionRequest { byok?: ByokCredentialParts; selection: SelectionRequest | null }
function payerFor(identity: TurnIdentity, byok?: ByokCredentialParts): ModelAdmissionRequest["payer"] {
  if (byok) return "byok";
  return identity.userType === "anonymous" || identity.userId.startsWith("anon_") ? "anon" : "user";
}
/**
 * A key the caller supplies in a header, or null when they supplied none
 * (EG-09, issue #1343). Blank counts as ABSENT — `""` is not nullish, so a
 * present-but-empty header would otherwise become a real key: the empty
 * `client_message_id` lands in `messages_session_client_message_id`'s partial
 * unique index and every later empty-id turn in that session resolves to the
 * first message as a "replay". Over the bound is a refusal rather than a
 * truncation: a key this long is not a key the caller can have meant.
 */
function boundedHeaderKey(headers: Headers, name: string, max: number, locale: Locale): string | null {
  const named = headers.get(name)?.trim() ?? "";
  if (named === "") return null;
  if (named.length > max) throw new ChatEnvelopeError("invalid_body", locale);
  return named;
}

async function submittedPayload(request: Request, locale: Locale): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ChatEnvelopeError("invalid_body", locale);
  }
}

/**
 * One submission out of one request. `x-turn-id` is the web's per-send turn
 * identifier (`apps/web/src/features/chat/session-headers.ts`) and therefore
 * the intake's dedupe key: a regenerate after a drop carries the same one, so
 * it resolves to the turn already committed instead of opening a second.
 *
 * A body carrying `selected_point_ids` or `selected_candidate_ids` is a
 * DETERMINISTIC selection (#1288) and may therefore have no utterance at all —
 * `apps/web` sends a part-less marker for a point recompute. The two facts are
 * read in that order for exactly that reason.
 */
export async function submissionOf(
  request: Request, identity: TurnIdentity, locale: Locale, maxChars: number = MESSAGE_MAX_CHARS,
): Promise<NativeSubmission> {
  const payload = await submittedPayload(request, locale);
  const byok = byokCredentialIn(request.headers) ?? undefined;
  const selection = selectionIn(payload, locale);
  return {
    sessionId: boundedHeaderKey(request.headers, "x-session-id", HEADER_KEY_MAX_CHARS, locale) ?? crypto.randomUUID(),
    identityId: identity.userId,
    payer: payerFor(identity, byok),
    clientMessageId: boundedHeaderKey(request.headers, "x-turn-id", HEADER_KEY_MAX_CHARS, locale) ?? crypto.randomUUID(),
    text: chatTurnText(payload, locale, maxChars, selection === null),
    locale,
    origin: submittedOrigin(payload, locale),
    byok,
    selection,
  };
}


const SelectionEnvelope = z.object({
  selected_point_ids: z.unknown().optional(), selected_candidate_ids: z.unknown().optional(),
  clarification_id: z.unknown().optional(), origin_lat: z.unknown().optional(),
  origin_lng: z.unknown().optional(), origin: z.unknown().optional(),
});

/** Validate the external product fields directly against the native typed selection request. */
function selectionIn(payload: unknown, locale: Locale): SelectionRequest | null {
  const envelope = SelectionEnvelope.safeParse(payload);
  if (!envelope.success) return null;
  const fields = envelope.data;
  const points = Object.hasOwn(fields, "selected_point_ids");
  const candidates = Object.hasOwn(fields, "selected_candidate_ids");
  if (!points && !candidates) return null;
  if (points && candidates) throw new ChatEnvelopeError("invalid_body", locale);
  const request = points ? { of: "points", pointIds: fields.selected_point_ids, origin: selectedOrigin(fields), locale }
    : { of: "candidates", candidateIds: fields.selected_candidate_ids, clarificationId: fields.clarification_id, locale };
  const parsed = SelectionRequest.safeParse(request);
  if (!parsed.success) throw new ChatEnvelopeError("invalid_body", locale);
  return parsed.data;
}

function selectedOrigin(payload: z.infer<typeof SelectionEnvelope>) {
  if (typeof payload.origin_lat === "number" && typeof payload.origin_lng === "number") return `${String(payload.origin_lat)},${String(payload.origin_lng)}`;
  return typeof payload.origin === "string" ? payload.origin.trim() || null : null;
}

const SharedCoordinates = z.object({ origin_lat: Latitude.optional(), origin_lng: Longitude.optional() })
  .refine((input) => (input.origin_lat === undefined) === (input.origin_lng === undefined));

function submittedOrigin(payload: unknown, locale: Locale): LatLng | undefined {
  const parsed = SharedCoordinates.safeParse(payload);
  if (!parsed.success) throw new ChatEnvelopeError("invalid_body", locale);
  const { origin_lat: lat, origin_lng: lng } = parsed.data;
  return lat === undefined || lng === undefined ? undefined : { lat, lng };
}

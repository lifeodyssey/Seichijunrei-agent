/**
 * The Vercel AI SDK chat envelope one `POST /v1/chat` carries, read into the
 * single fact the agent tier needs from it: the text of the visitor's newest
 * message (W1-7 #1256).
 *
 * A PORT of `apps/agent/src/animichi/interfaces/routes/chat_body.py`, not a new
 * shape. `apps/web` sends the same body to the same path whichever tier answers
 * it (`useChat` owns the envelope), so the reader has to agree with Python's on
 * all three of its rules: the LAST `role: "user"` message is the turn, its
 * `parts` are concatenated in order, and a part that is not `{type: "text"}` is
 * a 422 rather than a silently dropped attachment. Older messages are history
 * the transcript already holds — they are read past, never re-committed.
 *
 * The two refusals keep Python's localized wire (`_INPUT_MESSAGES` in
 * `agents/error_messages.py`) because the web renders `detail` verbatim.
 *
 * Pure: no bindings, no clock, no database.
 */
import { z } from "zod";

/** The locales the input refusals are authored in; anything else reads `ja`. */
const LOCALES = ["ja", "zh", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Why an envelope could not become a turn, keyed like Python's `InputError`. */
export type ChatEnvelopeRefusal =
  | "message_too_long"
  | "non_text_message"
  | "empty_message"
  | "invalid_body";

const REFUSAL_MESSAGES: Readonly<Record<ChatEnvelopeRefusal, Readonly<Record<Locale, string>>>> = {
  message_too_long: {
    ja: "メッセージが長すぎます。短くしてもう一度お試しください。",
    zh: "消息太长了，请缩短后重试。",
    en: "Your message is too long. Please shorten it and try again.",
  },
  non_text_message: {
    ja: "テキストメッセージを入力してください。",
    zh: "请输入文字消息。",
    en: "Please enter a text message.",
  },
  // Python let an empty envelope through as `text: ""`; this tier COMMITS the
  // user message before anything runs, so an empty turn would be a transcript
  // row with nothing in it. Refused with the same words as a non-text part —
  // from the visitor's side it is the same mistake.
  empty_message: {
    ja: "テキストメッセージを入力してください。",
    zh: "请输入文字消息。",
    en: "Please enter a text message.",
  },
  // `chat_body.py::chat_validation_detail` answers an unparsable body with this
  // exact untranslated string, in every locale. Kept as it is: the web shows
  // `detail` verbatim and this is the one it already knows.
  invalid_body: { ja: "invalid JSON body", zh: "invalid JSON body", en: "invalid JSON body" },
};

/** An envelope that cannot become a turn, carrying the words the client shows. */
export class ChatEnvelopeError extends Error {
  readonly refusal: ChatEnvelopeRefusal;
  readonly detail: string;

  constructor(refusal: ChatEnvelopeRefusal, locale: Locale) {
    super(refusal);
    this.name = "ChatEnvelopeError";
    this.refusal = refusal;
    this.detail = REFUSAL_MESSAGES[refusal][locale];
  }
}

/** The `x-locale` header, defaulted the way the container defaults it. */
export function requestLocale(raw: string | null): Locale {
  return LOCALES.find((known) => known === raw) ?? "ja";
}

const ChatEnvelope = z.object({ messages: z.array(z.unknown()).optional() });
const UserMessage = z.object({ role: z.literal("user"), parts: z.unknown().optional() });
const TextParts = z.array(z.object({ type: z.literal("text"), text: z.string() }));

/** Only the newest user message supplies input; caller-provided history has no write authority. */
function newestUserMessage(payload: unknown) {
  const envelope = ChatEnvelope.safeParse(payload);
  if (!envelope.success) return undefined;
  return (envelope.data.messages ?? []).flatMap((message) => {
    const parsed = UserMessage.safeParse(message);
    return parsed.success ? [parsed.data] : [];
  }).at(-1);
}

function messageText(message: z.infer<typeof UserMessage>, locale: Locale): string {
  const parsed = TextParts.safeParse(message.parts);
  if (!parsed.success) throw new ChatEnvelopeError("non_text_message", locale);
  return parsed.data.map((part) => part.text).join("");
}

/**
 * The text of the turn this envelope submits, refused when it is empty or
 * longer than `maxChars` (the `MESSAGE_MAX_CHARS` ceiling, S1.12).
 *
 * `utterable` is what a SELECTION turn changes (#1288). `apps/web` submits a
 * point recompute as a PART-LESS user message on purpose — "no new user
 * utterance", `use-chat-session.ts`'s `recomputeMarker` — and Python let it
 * through as `text: ""` and then declined to persist a user row for it
 * (`persistence.py`, #273 T1). This tier commits the user row before anything
 * runs, so the row exists either way; what it must not do is refuse the
 * submission. An empty text stays refused for an ORDINARY turn, where it is
 * still a transcript row with nothing in it.
 */
export function chatTurnText(payload: unknown, locale: Locale, maxChars: number, utterable = true): string {
  const message = newestUserMessage(payload);
  if (message === undefined) return refusedWhenUtterable("", locale, utterable);
  const text = messageText(message, locale);
  if (text.length > maxChars) throw new ChatEnvelopeError("message_too_long", locale);
  if (text === "") return refusedWhenUtterable("", locale, utterable);
  return text;
}

/** An empty turn: refused when the submission had nothing else to say. */
function refusedWhenUtterable(text: string, locale: Locale, utterable: boolean): string {
  if (utterable) throw new ChatEnvelopeError("empty_message", locale);
  return text;
}

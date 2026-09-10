/**
 * The three model families a BYOK credential can name, and what each one is
 * on the wire (W2-3 #1289, spec §四 S5 + Appendix D).
 *
 * TWO VOCABULARIES MEET HERE, and they are deliberately not merged. The
 * FAMILY is what the caller sends — `openai-compatible` / `anthropic` /
 * `gemini`, the strings `apps/web`'s `byok-storage.ts` puts in
 * `X-BYOK-Provider` and Python's `byok_models.py` accepts. The PROVIDER is
 * what `src/agent/egress/` allowlists — `openai` / `anthropic` / `google`.
 * The table binds the product's credential vocabulary to the native provider
 * and its permitted endpoint.
 *
 * GEMINI RIDES THE OPENAI-COMPATIBLE API, which is a measurement and not a
 * preference: pi-ai's `google-generative-ai` adapter throws "Custom fetch is
 * not supported by the Google Generative AI adapter"
 * (`node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js:33`)
 * the moment an injected fetch is handed to it, so the egress guard cannot
 * hang on that adapter at all. Google publishes the same models on an
 * OpenAI-compatible surface at the SAME host, so the family is driven through
 * `/v1beta/openai/` instead (spike Appendix D, carried into this card by
 * spec §四's "spike 产出的两条实现硬要求").
 *
 * `anthropic-messages`, by contrast, DOES take an injected fetch — it threads
 * `options.fetch` into the SDK client it constructs
 * (`dist/api/anthropic-messages.js:368,663,722`) — so that family keeps its
 * native dialect. `test/native-host-models.test.ts` proves it by driving a real
 * pi round trip for both families through a scripted socket.
 */
import type { ByokProvider } from "../egress/provider-allowlist.ts";

export const BYOK_FAMILIES = ["openai-compatible", "anthropic", "gemini"] as const;

/** The `X-BYOK-Provider` vocabulary, exactly as the web and Python spell it. */
export type ByokFamily = (typeof BYOK_FAMILIES)[number];

/** The pi api adapters a BYOK model can be driven through. */
export type ByokApi = "openai-completions" | "anthropic-messages";

export interface ByokDialect {
  /** The egress allowlist family this maps onto. */
  readonly provider: ByokProvider;
  /** The pi adapter, chosen for whether it accepts an injected fetch. */
  readonly api: ByokApi;
  /** The fixed endpoint, or `null` when the caller supplies one. */
  readonly baseUrl: string | null;
  /** The model used when `X-BYOK-Model` is absent, or `null` when required. */
  readonly defaultModel: string | null;
  readonly contextWindow: number;
  readonly maxTokens: number;
}

/**
 * The two default model ids are ported verbatim from
 * `apps/agent/src/animichi/config/byok_defaults.py`; the openai-compatible
 * family has none for the reason that file gives — there is no safe default
 * across arbitrary endpoints.
 */
export const BYOK_DIALECTS: Readonly<Record<ByokFamily, ByokDialect>> = {
  "openai-compatible": {
    provider: "openai",
    api: "openai-completions",
    baseUrl: null,
    defaultModel: null,
    contextWindow: 128_000,
    maxTokens: 16_384,
  },
  anthropic: {
    provider: "anthropic",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-5",
    contextWindow: 200_000,
    maxTokens: 16_384,
  },
  gemini: {
    provider: "google",
    api: "openai-completions",
    // The TRAILING SLASH is load-bearing: the OpenAI SDK joins its path onto
    // the base, so without it the request would leave as `/v1beta/chat/…`
    // instead of `/v1beta/openai/chat/completions`. Measured, not assumed.
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.5-flash",
    contextWindow: 1_048_576,
    maxTokens: 16_384,
  },
};

/** The named family, or `null` — an unknown id is never defaulted to one. */
export function byokFamilyOf(value: unknown): ByokFamily | null {
  return BYOK_FAMILIES.find((known) => known === value) ?? null;
}

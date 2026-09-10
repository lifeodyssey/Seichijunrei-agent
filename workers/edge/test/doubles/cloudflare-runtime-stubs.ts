/**
 * Bundling-only stand-ins for workerd's `cloudflare:*` built-in modules.
 *
 * The runtime-container-secrets test bundles `src/entry.ts` with esbuild to
 * execute `RuntimeContainer` under plain Node. On the native host, entry also
 * exports SessionAgent, whose `agents` SDK graph imports workerd-only built-ins
 * (`cloudflare:workers`, `cloudflare:email`) that neither esbuild nor Node can
 * resolve. The test never touches those exports, so these shims exist purely
 * to let the module graph evaluate; they must satisfy the SDK's static shape
 * (classes it extends at module scope, plus its `exports` object). The marker
 * member keeps each stand-in honest if one ever surfaces in a diagnostic.
 */

export class DurableObject {
  readonly stubModule = "cloudflare:workers";
}

export class RpcTarget {
  readonly stubModule = "cloudflare:workers";
}

export class EmailMessage {
  readonly stubModule = "cloudflare:email";
}

export const exports = {};

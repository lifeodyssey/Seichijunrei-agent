# pi-ai `.lazy` api subpaths produce a dead bundle under esbuild — upstream report

Card #1246 (W0-S3). This file is the **filing copy** of an upstream bug report: the text below is
written to be pasted into an issue as-is. Filing it is the owner's call.

- **Upstream repo**: `github.com/earendil-works/pi`
- **Proposed title**: `pi-ai: bundling an api/*.lazy subpath emits models.js as an uninitialised __esm chunk (ModelsImpl is not a constructor)`
- **Our guard while it is open**: `workers/edge/bundle-smoke/` — the entrypoint carries the
  workaround, and `pnpm --filter edge-worker run test:bundle-smoke` bundles it and **executes** the
  artifact in workerd. It is a segment of the `edge-worker` package's own `test` script, so it runs
  in `CI / affected (edge-worker)` and, whenever a changed file selects that package, in
  `scripts/local-gates/pre-push-affected.sh` (contract: `docs/ops/local-gates.md`).

---

## Summary

Importing `@earendil-works/pi-ai/api/<id>.lazy` from a bundle entry makes esbuild emit
`dist/models.js` as a lazily-initialised `__esm` chunk, but the entry scope never receives the
matching `init_models()` call. The first `createModels()` at runtime throws:

```
TypeError: ModelsImpl is not a constructor
```

The bundle builds clean. Nothing detects this until the bundle is executed — and pi's own
`scripts/check-browser-smoke.mjs` builds without executing, so upstream CI cannot see it either.

## Environment

- `@earendil-works/pi-ai@0.84.4` (with `@earendil-works/pi-agent-core@0.84.4`)
- esbuild **0.28.2** and **0.28.1** — reproduced on both (this card, 2026-09-02)
- wrangler **4.127.1** (embedded esbuild) — reproduced by the earlier pi research probe
- Target: Cloudflare Workers / workerd. Also reproduces when the same bundle is executed by Node,
  so it is not a workerd-specific defect.
- Running the published `dist` directly under Node (unbundled) works fine.

## Reproduction

```js
// entry-lazy.js
import { createModels } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

export default {
  fetch() {
    const models = createModels({ providers: {} });
    return new Response(JSON.stringify({ ok: typeof models, api: typeof openAICompletionsApi }));
  },
};
```

```sh
esbuild entry-lazy.js --bundle --format=esm --conditions=workerd,worker,browser --outfile=out.mjs
node -e "import('./out.mjs').then(m => m.default.fetch()).catch(e => console.log(e.message))"
# → ModelsImpl is not a constructor
```

Same command with the entry's second import changed to the **eager**
`@earendil-works/pi-ai/api/openai-completions` (and `stream` in place of `openAICompletionsApi`)
returns `200` normally.

## What the emitted bundle shows

With the `.lazy` import, esbuild wraps every pi-ai module in `__esm` initialisers. The tail of the
bundle is:

```js
// node_modules/@earendil-works/pi-ai/dist/api/openai-completions.lazy.js
init_lazy();
var openAICompletionsApi = () => lazyApi(() => Promise.resolve().then(() => (init_openai_completions(), openai_completions_exports)));

// entry-lazy.js
var entry_lazy_default = {
  fetch() {
    const models = createModels({ providers: {} });   // ← models.js was never initialised
    ...
```

`init_models()` is defined (it is called from `init_openai_completions()` and friends) but the entry
section, which depends on `models.js` **directly** through its own `@earendil-works/pi-ai` import,
gets no `init_models()` call. `ModelsImpl` is therefore still in its TDZ hole when
`createModels()` runs.

Without the `.lazy` import the bundle contains **no** `__esm` wrappers at all: the whole graph is
emitted eagerly in dependency order and the problem cannot arise.

## Impact

Any bundled consumer (Workers, browser, edge runtimes) that follows the documented `.lazy` api
subpath ships an artifact that dies on first use. The failure is invisible to type-checking, to
unit tests that import source modules, and to build-only smoke checks.

## Workarounds

1. **Verified here, and what our gate ships.** Import the eager api module — `@earendil-works/pi-ai/api/openai-completions` — and pass the
   module namespace as the provider `api`. Costs the eager SDK weight in the bundle (~440 KiB for
   the openai-completions path); irrelevant for a Worker.
2. Go through the provider factory module `@earendil-works/pi-ai/providers/<id>` — the shape pi's
   own smoke entry uses. Reported executable by the earlier research probe; not re-verified here.

## Suggested upstream fix

Two independent asks:

- **The defect**: either stop routing `.lazy` subpaths in a way that puts `models.js` into a lazy
  chunk group the entry cannot initialise, or (if this is an esbuild bug rather than a packaging
  one) reduce it to a minimal esbuild case and file it there — the missing entry-scope
  `init_models()` for a module the entry imports directly looks like an esbuild chunk-ordering bug,
  but the `.lazy` indirection is what triggers it.
- **The blind spot**: make `check:browser-smoke` **execute** the bundle it builds, not just build
  it. One `fetch()` through the artifact would have caught this.

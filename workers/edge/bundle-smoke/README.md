# Edge bundle smoke tests

Run `pnpm --filter edge-worker run test:bundle-smoke` from the repository root.
`pnpm --filter edge-worker test` and the existing affected edge lane include it.

`pi-harness.test.ts` proves S1 (#1537) against the published
`@earendil-works/pi-agent-core@0.85.1` and `@earendil-works/chord@0.85.1`.
The `pi-agent-core-smoke` and `pi-ai-smoke` npm aliases are test dependencies:
they install the official packages directly while production remains on 0.84.4.
The frozen workspace lock also fixes core's chord, pi-ai and telemetry dependencies
at 0.85.1. Tests never download packages or resolve a version at runtime.

Wrangler's CLI builds the fixture with `deploy --dry-run --metafile`; its official
`createTestHarness` then executes **that same emitted artifact** in local workerd.
The fixture uses the public `MemorySessionRepo`, `AgentHarness.create`, `lanes`
and `close` APIs. `fauxProvider` supplies the SDK model declaration; no turn is
driven and no model request leaves the runtime. The test checks the actual module
graph for chord and the absence of esbuild, and checks the emitted bytes for the
esbuild marker. `smol-toml`, the parser used by Wrangler, compares the fixture's
compatibility settings with the deployed edge configuration.

For the CLI import-and-call check, from `workers/edge`:

```sh
pnpm exec wrangler dev --config bundle-smoke/pi-harness.wrangler.json --local
```

One request to its reported loopback address must return HTTP 200 with
`{"open":[],"lanes":[]}`. Stop the local server afterward. This fixture has no
cloud bindings or production deployment wiring.

## Measured bundle cost

Measured on 2026-09-09 with Wrangler 4.114.0, Node 26.8.1, and base
`fd73fbd532ef4d151a027ab8c93e9f2ea9304dab`. All size builds use the fixture's
edge compatibility settings, without minification; gzip uses level 6.

| Smoke artifact | Bytes | Gzip bytes |
|---|---:|---:|
| Existing `pi-kernel.worker.ts` (0.84.4) | 562,121 | 98,770 |
| New `pi-harness.worker.ts` (0.85.1) | 1,237,291 | 196,610 |
| Increase against existing smoke baseline | 675,170 | 97,840 |

Both entries were built directly with the official Wrangler CLI. The baseline
drives a model turn; the new fixture constructs and inspects a harness. This is
the requested smoke comparison, not the incremental cost of identical behavior.

A separate comparison retains the new harness alongside the complete edge:

| Artifact | Bytes | Gzip bytes |
|---|---:|---:|
| Existing complete edge entry | 2,680,648 | 502,376 |
| Edge entry plus retained harness fixture export | 3,144,082 | 588,069 |
| Increase | 463,434 | 85,693 |

The size-only entry imports and re-exports the existing edge, adds the fixture as
the named `harnessSmoke` export, and preserves the edge default export. It retains
both SDK versions, so this measures coexistence rather than predicting the later
runtime replacement. Neither artifact contains an esbuild marker. The standalone
0.85.1 fixture reports 1,208.29 KiB / gzip 192.00 KiB from Wrangler.

## Mutation evidence

- Restoring the old 0.84.4 fixture makes the runtime assertion fail with HTTP 500:
  `HarnessNotImplemented: AgentHarness.lanes is not implemented yet`.
- Adding `export { bundleFacets } from "@earendil-works/chord/bundler"` makes the
  artifact assertion fail on `node_modules/esbuild/lib/main.js`.
- Restoring the fixture makes all seven bundle smoke tests pass again.

These checks prove import, construction, inspection, cleanup and bundle contents.
They do not establish durable storage, replay, tools, provider transport or a
production migration to the new harness.

import { fileURLToPath } from 'node:url';

import type { BaselineLocation } from '../gate/baseline-store.ts';

/**
 * Which record a staging run is judged against — and, since #1515, which one a
 * capture writes.
 *
 * The layer and the model are PINNED here rather than exposed as flags. The
 * comparison this package exists to make is "the TS runner on staging against
 * the committed `agent_eval_v3` record", and a gate whose baseline can be
 * pointed elsewhere on the command line can always be made to pass by pointing
 * it somewhere easier. Changing which record is read — or written — is a change
 * to this file, in a diff someone reads.
 *
 * THE NAME USED TO SAY `PYTHON_BASELINE_*`, and it stopped being true on
 * 2026-09-08: the owner's decision on #1303 makes the TS tier's own uncapped
 * staging run the baseline every later run is judged against, and drops the
 * Python-versus-TS paired comparison (#1480). What these constants name is the
 * baseline's IDENTITY — the layer it was run at and the model the deploy that
 * answered is configured with — which was never a fact about Python.
 *
 * The VALUE did not move with the name, and that is why the rename crossed no
 * language boundary: the 2026-09-07 refresh had already put the record on
 * staging's own endpoint, and `workers/edge/wrangler.toml`'s
 * `DEFAULT_AGENT_MODEL` names this same string. So the filename below is
 * unchanged, `baseline_oracle.py`'s `STALE_MODEL` still agrees with it, and the
 * oracle's pinned rows are untouched.
 *
 * These names are what `baselinePath` flattens into
 * `baselines/agent_l4_trajectory_openai-mimo-v2.5-https---api.xiaomimimo.com-v1.json`
 * — `:`, `@` and `/` each become `-`.
 */
export const BASELINES_DIR = fileURLToPath(new URL('../../baselines/', import.meta.url));

/** `run_agent_eval._trajectory_target().layer` — the tier the record is written from. */
export const BASELINE_LAYER = 'agent_l4_trajectory';

/** `run_agent_eval._trajectory_target().tier` — the same target's `tier` field,
 * which is the record's own column and not part of its path. Pinned here so a
 * capture stamps the tier the run was made at rather than one a flag chose. */
export const BASELINE_TIER = 'trajectory';

/** The model the record's numbers were produced against.
 *
 * The staging deploy answers with whatever model it is configured with and
 * publishes none of it on the wire, so this is the baseline's identity — an
 * assertion about the deploy `workers/edge/wrangler.toml` describes, not a
 * claim the TS turns' own responses made.
 *
 * It moved off `https://opencode.ai/zen/go/v1` on 2026-09-07 (#1303). That
 * gateway now answers 400 `MissingSessionID` — "Request is missing
 * x-opencode-session and cannot be routed efficiently" — to every request from
 * every key, and nothing in `apps/agent`'s model construction sends that
 * header. The direct endpoint is the same `mimo-v2.5` and is what staging's own
 * `DEFAULT_AGENT_MODEL` names, so the record shares an endpoint with the turns
 * it describes rather than only a model name. */
export const BASELINE_MODEL = 'openai:mimo-v2.5@https://api.xiaomimimo.com/v1';

export function baselineLocation(): BaselineLocation {
  return {
    layer: BASELINE_LAYER,
    modelId: BASELINE_MODEL,
    baselinesDir: BASELINES_DIR,
  };
}

import type { Env, MigratorDeps } from "./create-app";
import { productionSelected } from "./lock";
import type { SelectedExecutor } from "./selected-migration";

export function selectedExecutor(env: Env, deps: MigratorDeps): SelectedExecutor {
  if (deps.selected !== undefined) return deps.selected;
  if (env.MIGRATOR_APPLY_LOCK === undefined) throw new Error("migrator apply lock not configured");
  return productionSelected(env.MIGRATOR_APPLY_LOCK);
}

// #1051 / #1124 — migrator Worker composition root (wrangler main). Wires the
// default HTTP apply + fixed-name lock DO. MigrationContainer stays exported
// until staging proof (#1124 frozen: do not delete [[containers]] in this PR).
import { createMigratorApp } from "./create-app";
import { MigratorApplyLock } from "./apply-lock";
import { MigrationContainer } from "./container";

export { MigratorApplyLock };
export { MigrationContainer };
export { createMigratorApp, type Env, type MigratorDeps } from "./create-app";

export default createMigratorApp();

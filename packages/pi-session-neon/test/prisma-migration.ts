import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const packageRoot = fileURLToPath(new URL("../", import.meta.url));

export function prisma(args: string[], cwd = packageRoot) {
  return promisify(execFile)("pnpm", ["exec", "prisma", ...args, "--json"], {
    cwd, env: { ...process.env, DO_NOT_TRACK: "1" }, maxBuffer: 5 * 1024 * 1024,
  });
}

export function migrate(dsn: string, cwd = packageRoot, target?: string) {
  const selection = target === undefined ? [] : ["--to", target];
  return prisma(["db", "migrate", "--db", dsn, ...selection], cwd);
}

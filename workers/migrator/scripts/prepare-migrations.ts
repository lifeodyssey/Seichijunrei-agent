import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Copy Prisma's native artifacts beside Wrangler's already-built entry. */
export async function prepareMigrations(bundleDirectory: string): Promise<void> {
  const target = resolve(bundleDirectory);
  await mkdir(target, { recursive: true });
  await cp(fileURLToPath(import.meta.resolve("@animichi/pi-session-neon/migrations")), `${target}/migrations`, {
    recursive: true, errorOnExist: true, force: false,
  });
  await cp(fileURLToPath(import.meta.resolve("@animichi/pi-session-neon/contract")), `${target}/contract.json`, {
    errorOnExist: true, force: false,
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  if (destination === undefined || process.argv.length !== 3) throw new Error("usage: prepare-migrations.ts <bundle-directory>");
  await prepareMigrations(destination);
}

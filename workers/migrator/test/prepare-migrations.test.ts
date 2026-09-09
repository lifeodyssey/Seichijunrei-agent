import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { prepareMigrations } from "../scripts/prepare-migrations";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true }))); });

async function snapshot(directory: string) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  return Promise.all(files.map(async (entry) => [join(entry.parentPath, entry.name).slice(directory.length),
    await readFile(join(entry.parentPath, entry.name), "utf8")]));
}

it("copies the complete native graph and contract without translating their bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-migration-assets-"));
  temporary.push(directory);
  await prepareMigrations(directory);
  const source = fileURLToPath(import.meta.resolve("@animichi/pi-session-neon/migrations"));
  expect(await snapshot(join(directory, "migrations"))).toEqual(await snapshot(source));
  expect(await readFile(join(directory, "contract.json"), "utf8")).toBe(
    await readFile(fileURLToPath(import.meta.resolve("@animichi/pi-session-neon/contract")), "utf8"));
});

it("refuses to overwrite an already prepared migration graph", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-migration-assets-"));
  temporary.push(directory);
  await prepareMigrations(directory);
  await expect(prepareMigrations(directory)).rejects.toMatchObject({ code: "ERR_FS_CP_EEXIST" });
});

import { cp, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import contractJson from "../src/contract.json" with { type: "json" };
import { packageRoot, prisma } from "./prisma-migration.ts";

export async function futureContract() {
  const directory = await mkdtemp(join(tmpdir(), "pi-future-contract-"));
  await Promise.all(["src", "migrations", "prisma.config.ts", "package.json"].map((path) => cp(join(packageRoot, path), join(directory, path), { recursive: true })));
  await symlink(fileURLToPath(new URL("../../../node_modules", import.meta.url)), join(directory, "node_modules"));
  const path = join(directory, "src/contract.prisma");
  await writeFile(path, (await readFile(path, "utf8")).replace("model PiSession {", "model PiSession {\n  futureField String? @map(\"future_field\")"));
  await prisma(["contract", "emit"], directory);
  await prisma(["migration", "plan", "--from", contractJson.storage.storageHash, "--name", "future_test_only"], directory);
  return directory;
}

import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { createStorageConformance, type StorageFixture } from "@earendil-works/pi-agent-core/harness/session/testing";
import { NeonStorage } from "@animichi/pi-session-neon";
import { serviceDatabase, SESSION_ID } from "./postgres.ts";

function storageFixture(): Promise<StorageFixture> {
  const storage = new NeonStorage(serviceDatabase, { sessionId: SESSION_ID });
  return Promise.resolve({
    storage,
    async [Symbol.asyncDispose]() { await storage.close(BACKGROUND_CONTEXT); },
  });
}

for (const conformance of createStorageConformance(storageFixture)) {
  void test(`Storage: ${conformance.group}: ${conformance.name}`, () => conformance.run());
}

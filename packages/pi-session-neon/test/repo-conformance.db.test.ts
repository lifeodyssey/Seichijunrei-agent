import { test } from "node:test";
import {
  createSessionRepoConformance,
  createSessionRepoForkBehaviorConformance,
  createSessionRepoForkConformance,
  createSessionRepoForkCoordinationConformance,
  createSessionRepoForkDestinationReservationConformance,
  createSessionRepoForkSourceSnapshotConformance,
  createSessionRepoLifecycleConformance,
  createSessionRepoMessageConformance,
  createSessionRepoOwnershipConformance,
} from "@earendil-works/pi-agent-core/harness/session/testing";
import { NeonSessionRepo } from "@animichi/pi-session-neon";
import { database, serviceDatabase } from "./postgres.ts";

async function repository() {
  await database.orm.public.PiSession.where({}).deleteAll();
  return new NeonSessionRepo(serviceDatabase);
}

const suites = {
  createSessionRepoConformance,
  createSessionRepoForkBehaviorConformance,
  createSessionRepoForkConformance,
  createSessionRepoForkCoordinationConformance,
  createSessionRepoForkDestinationReservationConformance,
  createSessionRepoForkSourceSnapshotConformance,
  createSessionRepoLifecycleConformance,
  createSessionRepoMessageConformance,
  createSessionRepoOwnershipConformance,
};

for (const [suite, factory] of Object.entries(suites)) {
  for (const conformance of factory(repository)) {
    void test(`${suite}: ${conformance.group}: ${conformance.name}`, () => conformance.run());
  }
}

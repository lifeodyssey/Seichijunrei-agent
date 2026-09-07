/**
 * A `PrefixSeeding` that refuses, and the requests it was handed (#1436).
 *
 * The four refusals `session-prefix.ts` maps onto statuses — a session that is
 * not the caller's, one that has already taken a turn, one with a live run, and
 * a seeded run that cannot be written — are all raised by the Neon adapters
 * behind `withAgentDatabase`, where only a lane that boots PostgreSQL can reach
 * them. This is the port in FRONT of them, so a case names the refusal and
 * reads the caller's status back.
 *
 * It records as well as refuses, because "the data plane was never reached" is
 * the property every refusal decided before it has to assert, and a count is
 * how the hop's own 400s say it.
 */
import type { PrefixSeedingRequest } from "../../src/agent/session/prefix-seeding.ts";
import type { PrefixSeeding } from "../../src/agent/session/session-prefix.ts";

export interface RefusingSeeding {
  readonly seeding: PrefixSeeding;
  /** Every request the hop handed the seeding, oldest first. */
  readonly requests: PrefixSeedingRequest[];
}

export function makeRefusingSeeding(refusal: Error): RefusingSeeding {
  const requests: PrefixSeedingRequest[] = [];
  const seeding: PrefixSeeding = (request) => {
    requests.push(request);
    return Promise.reject(refusal);
  };
  return { seeding, requests };
}

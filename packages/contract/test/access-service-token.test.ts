/**
 * The Cloudflare Access service token, as every automated caller reads it
 * (D3 #1369).
 *
 * The load-bearing case is the half-set environment. Access answers a request
 * with one header exactly as it answers a request with none — a 302 to the
 * identity provider — so a caller that sends half a token gets a login page
 * where it expected JSON and reads it as a broken deploy. Silence there is the
 * defect; a refusal naming the missing variable is the fix.
 *
 * test-type: unit (pure function over a supplied environment; no process env,
 * no network, no clock).
 */
import { describe, expect, it } from "vitest";

import {
  ACCESS_CLIENT_ID_HEADER,
  ACCESS_CLIENT_ID_VAR,
  ACCESS_CLIENT_SECRET_HEADER,
  ACCESS_CLIENT_SECRET_VAR,
  PartialAccessServiceTokenError,
  accessServiceTokenFrom,
  accessServiceTokenHeaders,
} from "../src/access-service-token.ts";

/** A complete token, as ESC hands one to a job. */
function makeTokenEnvironment(): Record<string, string> {
  return { CF_ACCESS_CLIENT_ID: "id.access", CF_ACCESS_CLIENT_SECRET: "not-a-real-secret" };
}

describe("the variable and header names", () => {
  it("are the ones ESC publishes and Access checks", () => {
    // Pinned rather than inlined at each call site: the ESC environment maps its
    // keys to these variable names and Cloudflare matches these header names, so
    // a typo in either is a lockout with no other red anywhere.
    expect([ACCESS_CLIENT_ID_VAR, ACCESS_CLIENT_SECRET_VAR]).toStrictEqual([
      "CF_ACCESS_CLIENT_ID",
      "CF_ACCESS_CLIENT_SECRET",
    ]);
    expect([ACCESS_CLIENT_ID_HEADER, ACCESS_CLIENT_SECRET_HEADER]).toStrictEqual([
      "CF-Access-Client-Id",
      "CF-Access-Client-Secret",
    ]);
  });
});

describe("a complete token", () => {
  it("is read off the two variables", () => {
    expect(accessServiceTokenFrom(makeTokenEnvironment())).toStrictEqual({
      clientId: "id.access",
      clientSecret: "not-a-real-secret",
    });
  });

  it("is presented as exactly the two headers Access reads", () => {
    expect(accessServiceTokenHeaders(makeTokenEnvironment())).toStrictEqual({
      "CF-Access-Client-Id": "id.access",
      "CF-Access-Client-Secret": "not-a-real-secret",
    });
  });
});

describe("an environment that declares no token", () => {
  it("is the ordinary local case, not an error", () => {
    // A laptop pointed at `wrangler dev` is behind no Access application. If
    // this threw, every local run would have to invent a credential.
    expect(accessServiceTokenFrom({})).toBeNull();
  });

  it("presents no headers, so a caller can spread the result unconditionally", () => {
    expect(accessServiceTokenHeaders({})).toStrictEqual({});
  });
});

describe("half a token", () => {
  it.each([
    ["only the id is set", { CF_ACCESS_CLIENT_ID: "id.access" }, "CF_ACCESS_CLIENT_SECRET"],
    ["only the secret is set", { CF_ACCESS_CLIENT_SECRET: "s3cret" }, "CF_ACCESS_CLIENT_ID"],
    [
      "the secret is exported empty",
      { CF_ACCESS_CLIENT_ID: "id.access", CF_ACCESS_CLIENT_SECRET: "" },
      "CF_ACCESS_CLIENT_SECRET",
    ],
    [
      "the id is exported empty",
      { CF_ACCESS_CLIENT_ID: "", CF_ACCESS_CLIENT_SECRET: "s3cret" },
      "CF_ACCESS_CLIENT_ID",
    ],
  ])("is refused when %s, naming the missing variable", (_case, environment, missing) => {
    expect(() => accessServiceTokenFrom(environment)).toThrow(PartialAccessServiceTokenError);
    expect(() => accessServiceTokenHeaders(environment)).toThrow(missing);
  });

  it("is never presented as a one-header request", () => {
    // The failure this exists to prevent, stated as the outcome rather than the
    // mechanism: whatever the refusal is spelled as, no half-token may leave
    // this module as headers.
    expect(() => accessServiceTokenHeaders({ CF_ACCESS_CLIENT_ID: "id.access" })).toThrow();
  });
});

/**
 * The credential automation presents to Cloudflare Access (D3 #1369).
 *
 * Access checks a service token as two request headers, and it checks them
 * TOGETHER: a request carrying one of the pair is exactly as unauthenticated as
 * one carrying neither, and the answer to both is a redirect to the identity
 * provider's login page. That answer is an HTML document with a 302 in front of
 * it, so a caller that sent half a token does not see "unauthorized" — it sees a
 * login page where it expected JSON, and reads it as a broken deploy. Refusing
 * the half-set environment by name is what turns that afternoon into one line.
 *
 * Deliberately import-free, for the same reason `staging-prefix-path.ts` is: its
 * consumers are a Playwright config, a Node lane door and (through them) the
 * eval runner, none of which should load zod to learn two header names.
 *
 * The values themselves come from the Pulumi stack output of
 * `infra/src/staging-access.ts`, carried into the ESC environment
 * `lifeodyssey/animichi/staging` by the `pulumi-stacks` provider. Nothing copies
 * them by hand and nothing checks them in.
 */

/** The environment variable the client id arrives in, CI and laptop alike. */
export const ACCESS_CLIENT_ID_VAR = "CF_ACCESS_CLIENT_ID";

/** The environment variable the client secret arrives in. */
export const ACCESS_CLIENT_SECRET_VAR = "CF_ACCESS_CLIENT_SECRET";

/** The header Access reads the client id from. */
export const ACCESS_CLIENT_ID_HEADER = "CF-Access-Client-Id";

/** The header Access reads the client secret from. */
export const ACCESS_CLIENT_SECRET_HEADER = "CF-Access-Client-Secret";

/** One Cloudflare Access service token, both halves present. */
export interface AccessServiceToken {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Half a service token was declared, which Access answers with a login page. */
export class PartialAccessServiceTokenError extends Error {
  constructor(missing: string, present: string) {
    super(
      `${missing} is unset while ${present} is set: a Cloudflare Access service token is both ` +
        `headers or neither, and half of one is refused at the door as an anonymous request`,
    );
    this.name = "PartialAccessServiceTokenError";
  }
}

/** An environment, as `process.env` presents one. */
export type TokenEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * The token an environment declares, or `null` when it declares none.
 *
 * `null` is the ordinary local case — a laptop pointed at `wrangler dev` is
 * behind no Access application — so an absent token is not an error. An
 * INCOMPLETE one always is.
 */
export function accessServiceTokenFrom(environment: TokenEnvironment): AccessServiceToken | null {
  const clientId = environment[ACCESS_CLIENT_ID_VAR];
  const clientSecret = environment[ACCESS_CLIENT_SECRET_VAR];
  if (clientId === undefined || clientId === "") return refuseHalf(clientSecret);
  if (clientSecret === undefined || clientSecret === "") {
    throw new PartialAccessServiceTokenError(ACCESS_CLIENT_SECRET_VAR, ACCESS_CLIENT_ID_VAR);
  }
  return { clientId, clientSecret };
}

/** The id was absent: fine if the secret was too, a refusal otherwise. */
function refuseHalf(clientSecret: string | undefined): null {
  if (clientSecret === undefined || clientSecret === "") return null;
  throw new PartialAccessServiceTokenError(ACCESS_CLIENT_ID_VAR, ACCESS_CLIENT_SECRET_VAR);
}

/**
 * The headers that token is presented as — empty when the environment declares
 * none, so a caller can spread the result unconditionally.
 */
export function accessServiceTokenHeaders(
  environment: TokenEnvironment,
): Readonly<Record<string, string>> {
  const token = accessServiceTokenFrom(environment);
  if (token === null) return {};
  return {
    [ACCESS_CLIENT_ID_HEADER]: token.clientId,
    [ACCESS_CLIENT_SECRET_HEADER]: token.clientSecret,
  };
}

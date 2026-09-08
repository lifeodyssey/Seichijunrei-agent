/** The account's Access identity providers, as this door reads them.
 *
 * Its own file because the rule below is about the ACCOUNT, not about staging:
 * the provider it selects is an account-level object shared with every Access
 * application on the account, and `staging-access.ts` only references it.
 *
 * An earlier revision declared a `ZeroTrustAccessIdentityProvider` instead, and
 * `stage-foundation` answered the create with
 * `POST /accounts/{id}/access/identity_providers 409 Conflict`: the account's
 * One-time PIN provider already existed, made for another project's Access
 * application, and Cloudflare permits exactly one per account. What talked that
 * revision into creating it was a read that answered `[]` — the shape Cloudflare
 * returns (`200`, never `403`) to a token lacking "Access: Organizations,
 * Identity Providers, and Groups Read", which is indistinguishable from an
 * account with no login methods and is why the refusal below names that
 * permission beside the dashboard step. The same revision had already written
 * the rule it broke: an account-level resource does not belong to the staging
 * stack once another Access consumer shares it, because two owners fight over
 * one object on every apply.
 */

/** One identity provider, reduced to what the door has to decide with. */
export interface AccountIdentityProvider {
  id: string;
  type: string;
}

/** Both ways an account can fail to offer the one provider this door needs. */
const NO_ONE_TIME_PIN =
  "this Cloudflare account reports no onetimepin identity provider: create the One-time PIN " +
  "login method under Zero Trust → Settings → Authentication, and check the Cloudflare API " +
  'token carries "Access: Organizations, Identity Providers, and Groups Read" — without it the ' +
  "list reads empty (200 + []) rather than forbidden";

/**
 * The one One-time PIN provider on the account, or a refusal.
 *
 * Cloudflare allows a single OTP provider per account, so ≠1 is not a choice
 * between candidates — it is the account not being in the state this door needs.
 * Picking from the list anyway would put an arbitrary login method on staging's
 * front page, so both directions fail closed, before any apply.
 */
export function oneTimePinIdentityProviderId(providers: AccountIdentityProvider[]): string {
  const found = providers.filter((provider) => provider.type === "onetimepin");
  if (found.length === 1) return found[0].id;
  if (found.length === 0) throw new Error(NO_ONE_TIME_PIN);
  throw new Error(`this account reports ${found.length} onetimepin providers; Access allows one`);
}

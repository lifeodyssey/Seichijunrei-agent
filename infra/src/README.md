# infra/src — Pulumi module layout

Thin composition root is `../index.ts` (stable public exports for topology tests).

| Module | Owns |
|--------|------|
| `config.ts` | `pulumi.Config`, stack, accountId, bucket name helpers, `webRoutesEnabled` |
| `buckets.ts` | Catalog media + map tiles R2 buckets |
| `web-routes.ts` | Flag-gated Custom Domains, edge Worker routes, www + legacy DNS redirects |
| `hardening.ts` | Prod zone DNSSEC, CAA, API rate limit, HSTS |
| `staging.ts` | Staging WAF gate, IP helpers, per-host config settings |
| `staging-access.ts` | The staging Cloudflare Access service token (D3 #1369) and the two outputs ESC imports |
| `access-identity-provider.ts` | Which of the ACCOUNT's Access identity providers the staging door offers, and why ≠1 is refused |
| `outputs.ts` | Stack outputs (bucket names, Access service token) |

## TODOs left intentionally

- R2 lifecycle / retain policies → #521

Routes belong to Pulumi; Worker code and bindings belong to Wrangler.

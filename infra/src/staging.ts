import * as cloudflare from "@pulumi/cloudflare";
import { config, stack, webRoutesEnabled } from "./config.ts"

// ── Staging: per-host config settings (CI smoke) ─────────────────────────────
// Cloudflare Access is the staging hostname's protection (`staging-access.ts`).
// The WAF's browser-facing defenses would fight it here: a Browser Integrity
// Check (BIC) or Security Level challenge on the staging host makes the
// Playwright smoke suite (and any curl) answer a challenge instead of the app.
// One zone-scoped ruleset turns both off for the staging hostname only — every
// other hostname on the zone keeps the defaults. Gated on the web routes so
// preview stacks stay clean: this is meaningful only where the staging hostname
// actually serves the app.
//
// This file used to declare a second, larger ruleset as well: the WAF custom
// rule that blocked staging traffic carrying neither an allowlisted source IP,
// the `animichi_staging` cookie, nor the `x-staging-key` header. D3 (#1369)
// deleted it. Two reasons it could not be the door: a WAF rule only sees
// hostnames on the zone, so the two `*.workers.dev` origins CD smoke-tests were
// never behind it (#539); and the credential was a static string this
// repository had to keep in sync across a stack config and a GitHub secret,
// with a mismatch locking CI out. Access owns both problems now.

if (webRoutesEnabled && stack === "staging") {
  const settingsZoneId = config.require("cloudflareZoneId");
  const settingsDomain = config.require("stagingDomain");

  new cloudflare.Ruleset("staging-http-config-settings", {
    zoneId: settingsZoneId,
    name: "staging http config settings",
    kind: "zone",
    phase: "http_config_settings",
    description: "Per-host config overrides for the staging hostname.",
    rules: [
      {
        action: "set_config",
        expression: `http.host eq "${settingsDomain}"`,
        description:
          "staging: CI smoke must not be browser-challenged; Cloudflare Access owns protection here",
        enabled: true,
        actionParameters: {
          bic: false,
          securityLevel: "essentially_off",
        },
      },
    ],
  });
}

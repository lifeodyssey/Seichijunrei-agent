#!/usr/bin/env ruby
# frozen_string_literal: true

# What the delivery pipeline is allowed to hold (card C1 / #1364). This is the
# credential half of the retired `test_database_credential_boundary.rb`,
# `test_secret_provisioning_contract.rb` and `test_cd_esc_token_source_contract.rb`,
# rewritten for the workflow that replaced their subject:
#
#   identity   the Pulumi Cloud login is the personal-token exchange an
#              individual-edition organization can actually mint, scoped to one
#              user. That every such job declares the `environment:` its OIDC
#              subject needs is a repository-wide rule, so it lives in
#              `test_workflow_invariants.rb` with the other meta-invariants
#   esc        each stage opens its own environment and exports only the names
#              it publishes with, never the action's export-everything default.
#              The one non-publishing exception is `smoke`, which opens the
#              Cloudflare Access service token and nothing else (D3 #1369).
#              That each opened name is then checked for emptiness is a
#              repository-wide rule in `test_workflow_invariants.rb`;
#              `NEON_API_KEY` reaches the jobs that hold a reader for it and no
#              other. What the list cannot promise is that a value stays out
#              of the job: `pulumi/esc-action` publishes every
#              `environmentVariables` entry as a step output whatever the list
#              says, so ADR 0003 rests on the runtime secrets living under
#              `pulumiConfig` instead (card D4), not on this allowlist
#   publish    every Wrangler deploy authenticates with the token ESC just
#              opened. wrangler-action assigns
#              `process.env.CLOUDFLARE_API_TOKEN = getInput("apiToken")`
#              unconditionally, so an omitted input blanks the exported value
#   retired    nothing the Pulumi Cloud migration removed comes back
#   runtime    CI uploads no Worker secret by any of the three routes that
#              exist — `wrangler secret bulk`, wrangler-action's `secrets:`
#              input, or simply naming one in the workflow
#   database   CI holds no database credential at all: every environment reaches
#              the data plane through the migrator Worker on the job's own OIDC
#              identity (decision 6; C3 / #1365 removed the last one)
#
# `cd.yml`'s job graph is `test_cd_shape_contract.rb`, not this file.
#
# Usage: ruby .github/scripts/test_cd_credential_boundary_contract.rb [REPO_ROOT]

require_relative "workflow_document"

CD_FILE = File.join(repository_root, ".github", "workflows", "cd.yml")
WRANGLER_ACTION = "cloudflare/wrangler-action"
AUTH_ACTION = "pulumi/auth-actions"
ESC_ACTION = "pulumi/esc-action"
PULUMI_ACTION = "pulumi/actions"
# What reads Neon's control plane. `neonctl` takes the key from the environment,
# so the job running the staging baseline reset needs it; a `pulumi up` does not
# (the provider is constructed from the `neonApiKey` stack config), but the
# production promotion still opens it alongside the publish token, so a stack
# apply stays a legal reason to hold it. Anything else asking for the key is a
# stage widening itself.
NEON_CLI = /neonctl|reset-staging-baseline\.sh/
# The publish token every stage needs, and the Neon control-plane key only the
# jobs that run a Pulumi stack do. Together they are the whole Pulumi plane —
# an ESC export naming anything else is a value this file has no business in.
PUBLISH_TOKEN = "CLOUDFLARE_API_TOKEN"
NEON_CONTROL_PLANE = "NEON_API_KEY"
PULUMI_PLANE = [PUBLISH_TOKEN, NEON_CONTROL_PLANE].freeze
# The Cloudflare Access service token the staging smoke probe presents at
# staging's front door (D3 #1369). Not the Pulumi plane at all: it authenticates
# a READ of a deployed surface, publishes nothing, and exists only because
# staging has no login of its own. `smoke` is the one job with a reason to hold
# it — anywhere else it is a job widening itself, which is what this pairing
# with a job name is for. `smoke` correspondingly holds NEITHER Pulumi-plane
# name: it deploys nothing.
ACCESS_SERVICE_TOKEN = %w[CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET].freeze
SMOKE_JOB = "smoke"
WRANGLER_API_TOKEN = "${{ env.CLOUDFLARE_API_TOKEN }}"
# An individual-edition organization cannot mint organization or team tokens —
# the 2026-09-05 probe answered `401 … Org tokens are not supported for non
# enterprise organizations`. The issuer policy is written against this pair.
PULUMI_TOKEN_TYPE = "urn:pulumi:token-type:access_token:personal"
PULUMI_SCOPE = "user:lifeodyssey"
# Retired by the Pulumi Cloud migration (#1077/#1078): the state backend, the
# passphrase that encrypted it, the R2 keys that reached it, and the separate
# Pulumi-plane Cloudflare token the promotion script used to rename.
RETIRED_CREDENTIALS = %w[PULUMI_BACKEND_URL PULUMI_CONFIG_PASSPHRASE R2_ACCESS_KEY_ID
                         R2_SECRET_ACCESS_KEY CLOUDFLARE_PULUMI_API_TOKEN].freeze
# The eight edge runtime secrets the retired `sync-edge-runtime-secrets.sh`
# pushed on every edge deploy. They belong to Pulumi and the Secrets Store now
# (spec §七 #17, card D4); CI must not name them at all.
RUNTIME_SECRETS = %w[DEEPSEEK_API_KEY MIMO_API_KEY ZEN_GO_API_KEY SUPABASE_DB_URL
                     GOOGLE_MAPS_API_KEY LOGFIRE_TOKEN TURNSTILE_SECRET ANON_ID_SECRET].freeze
# Any credential whose name says "database" — NEON_DATABASE_URL was the last
# one, and MIGRATOR_DATABASE_URL arriving through an ESC export instead of the
# Secrets Store would be the same mistake under a newer name. A pattern, not a
# list, and deliberately blind to where the value would come from: since #1367
# there is no `secrets.` context left to anchor on, so the name itself is the
# only thing worth matching.
DATABASE_CREDENTIAL = /\b[A-Z][A-Z0-9_]*DATABASE[A-Z0-9_]*\b/

@log = ViolationLog.new
@cd = WorkflowDocument.load(CD_FILE)
@source = File.read(CD_FILE)

def steps_using(action)
  @cd.jobs.each_key.flat_map do |job|
    @cd.steps_of(job).select { |step| step["uses"].to_s.start_with?("#{action}@") }.map { |step| [job, step] }
  end
end

def assert_pulumi_login_is_the_only_token_type_this_org_can_mint
  steps_using(AUTH_ACTION).each do |job, step|
    @log.unless_true(step.dig("with", "requested-token-type") == PULUMI_TOKEN_TYPE,
                     "cd.yml:#{job}: the Pulumi login must request #{PULUMI_TOKEN_TYPE}")
    @log.unless_true(step.dig("with", "scope") == PULUMI_SCOPE,
                     "cd.yml:#{job}: the exchanged token must be scoped to #{PULUMI_SCOPE}")
  end
end

def neon_control_plane_jobs
  cli_jobs = @cd.jobs.each_key.select do |job|
    @cd.steps_of(job).any? { |step| step["run"].to_s.match?(NEON_CLI) }
  end
  (steps_using(PULUMI_ACTION).map(&:first) + cli_jobs).uniq
end

# What a job is allowed to ask ESC for: the Pulumi plane everywhere, plus the
# Access service token in `smoke` alone.
def esc_allowance(job)
  job == SMOKE_JOB ? PULUMI_PLANE + ACCESS_SERVICE_TOKEN : PULUMI_PLANE
end

def assert_esc_exports_only_what_its_stage_publishes_with
  neon_jobs = neon_control_plane_jobs
  steps_using(ESC_ACTION).each do |job, step|
    exports = esc_exported_names(step)
    allowed = esc_allowance(job)
    @log.unless_true(!exports.empty? && (exports - allowed).empty?,
                     "cd.yml:#{job}: ESC must export a non-empty subset of #{allowed.join(', ')}, " \
                     "never the export-everything default (got #{exports.join(', ')})")
    next unless exports.include?(NEON_CONTROL_PLANE)

    @log.unless_true(neon_jobs.include?(job),
                     "cd.yml:#{job}: #{NEON_CONTROL_PLANE} belongs to the jobs that hold a reader for it")
  end
end

# The positive half. The two assertions above bound what `smoke` MAY hold; on
# their own, a smoke job that opened nothing at all satisfies both — and then
# probes staging bare, gets the Access login page, and reports a broken deploy
# for every push. So the job is required to open exactly this pair.
def assert_smoke_opens_the_front_door_credential
  opened = steps_using(ESC_ACTION).select { |job, _step| job == SMOKE_JOB }
                                  .flat_map { |_job, step| esc_exported_names(step) }
  @log.unless_true(opened.sort == ACCESS_SERVICE_TOKEN.sort,
                   "cd.yml:#{SMOKE_JOB}: must open #{ACCESS_SERVICE_TOKEN.join(', ')} from ESC — " \
                   "staging is behind Cloudflare Access and a bare probe reads the login page as a " \
                   "broken deploy (got #{opened.empty? ? 'nothing' : opened.join(', ')})")
end

# The other direction of the same pairing. The allowance above stops another job
# from EXPORTING the token; this stops one from naming it at all — an `env:`
# block, a `with:` input or a `run` line reaching for it would hold the same
# credential without ever going through `esc_exported_names`.
#
# The WHOLE job mapping, not `steps_of` (CodeRabbit on PR #1520). `steps_of` is
# `jobs.<job>.steps`, so a job-level `env:` — the shortest way to lift a
# credential into every step at once — sat outside the scan while the comment
# above claimed to cover it. Stringifying the job covers `env`, `container`,
# `services`, `defaults` and anything a later schema adds, at the cost of
# nothing: YAML comments are not in the parsed document, so a job that merely
# MENTIONS the name in prose is not a false positive.
def assert_the_access_token_stays_inside_the_smoke_job
  ACCESS_SERVICE_TOKEN.each do |name|
    holders = @cd.jobs.each_key.select { |job| @cd.dig("jobs", job).to_s.include?(name) }
    @log.unless_true(holders == [SMOKE_JOB],
                     "cd.yml: #{name} is staging's front-door credential and belongs to " \
                     "#{SMOKE_JOB} alone (held by #{holders.empty? ? 'nothing' : holders.join(', ')})")
  end
end

# The one place a publishing job could quietly fall back to something other
# than the token it just opened.
def assert_wrangler_publishes_on_the_opened_token
  steps_using(WRANGLER_ACTION).each do |job, step|
    @log.unless_true(step.dig("with", "apiToken") == WRANGLER_API_TOKEN,
                     "cd.yml:#{job}: Wrangler must authenticate with #{WRANGLER_API_TOKEN}")
    @log.unless_true(steps_using(ESC_ACTION).any? { |esc_job, esc| esc_job == job && esc_exported_names(esc).include?(PUBLISH_TOKEN) },
                     "cd.yml:#{job}: publishes without opening #{PUBLISH_TOKEN} from ESC")
  end
end

def assert_retired_credentials_stay_retired
  named = RETIRED_CREDENTIALS.select { |name| @source.include?(name) }
  @log.unless_true(named.empty?, "cd.yml: Pulumi Cloud replaced these (#{named.join(', ')})")
end

def assert_no_runtime_secret_upload
  @log.unless_true(!@source.include?("secret bulk"), "cd.yml: CI must never bulk-upload Worker secrets")
  @log.unless_true(steps_using(WRANGLER_ACTION).none? { |_job, step| step.fetch("with", {}).key?("secrets") },
                   "cd.yml: wrangler-action's `secrets:` input uploads runtime secrets")
  named = RUNTIME_SECRETS.select { |name| @source.include?(name) }
  @log.unless_true(named.empty?, "cd.yml: runtime secrets belong to Pulumi, not CI (#{named.join(', ')})")
end

def assert_ci_holds_no_database_credential
  named = @source.scan(DATABASE_CREDENTIAL).uniq
  @log.unless_true(named.empty?,
                   "cd.yml: the database is reachable only through the migrator (#{named.join(', ')})")
end

def main
  assert_pulumi_login_is_the_only_token_type_this_org_can_mint
  assert_esc_exports_only_what_its_stage_publishes_with
  assert_smoke_opens_the_front_door_credential
  assert_the_access_token_stays_inside_the_smoke_job
  assert_wrangler_publishes_on_the_opened_token
  assert_retired_credentials_stay_retired
  assert_no_runtime_secret_upload
  assert_ci_holds_no_database_credential
  @log.report("CD credential boundary: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__

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
#              That each opened name is then checked for emptiness is a
#              repository-wide rule in `test_workflow_invariants.rb`;
#              `NEON_API_KEY` reaches the two jobs that run a Pulumi stack and
#              no other. What the list cannot promise is that a value stays out
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
# The publish token every stage needs, and the Neon control-plane key only the
# jobs that run a Pulumi stack do. Together they are the whole Pulumi plane —
# an ESC export naming anything else is a value this file has no business in.
PUBLISH_TOKEN = "CLOUDFLARE_API_TOKEN"
NEON_CONTROL_PLANE = "NEON_API_KEY"
PULUMI_PLANE = [PUBLISH_TOKEN, NEON_CONTROL_PLANE].freeze
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

def assert_esc_exports_only_what_its_stage_publishes_with
  pulumi_jobs = steps_using(PULUMI_ACTION).map(&:first)
  steps_using(ESC_ACTION).each do |job, step|
    exports = esc_exported_names(step)
    @log.unless_true(!exports.empty? && (exports - PULUMI_PLANE).empty?,
                     "cd.yml:#{job}: ESC must export a non-empty subset of #{PULUMI_PLANE.join(', ')}, " \
                     "never the export-everything default (got #{exports.join(', ')})")
    next unless exports.include?(NEON_CONTROL_PLANE)

    @log.unless_true(pulumi_jobs.include?(job),
                     "cd.yml:#{job}: #{NEON_CONTROL_PLANE} belongs to the jobs that run a Pulumi stack")
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
  assert_wrangler_publishes_on_the_opened_token
  assert_retired_credentials_stay_retired
  assert_no_runtime_secret_upload
  assert_ci_holds_no_database_credential
  @log.report("CD credential boundary: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__

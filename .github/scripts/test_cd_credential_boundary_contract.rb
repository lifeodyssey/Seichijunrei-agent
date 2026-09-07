#!/usr/bin/env ruby
# frozen_string_literal: true

# What the delivery pipeline is allowed to hold (card C1 / #1364). This is the
# credential half of the retired `test_database_credential_boundary.rb`,
# `test_secret_provisioning_contract.rb` and `test_cd_esc_token_source_contract.rb`,
# rewritten for the workflow that replaced their subject:
#
#   identity   the Pulumi Cloud login is the personal-token exchange an
#              individual-edition organization can actually mint, scoped to one
#              user; ESC exports exactly the two Pulumi-plane names rather than
#              the action's export-everything default, which is what keeps
#              ADR 0003 ("no runtime DSN or model key in ESC") structural
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
ESC_EXPORTS = "CLOUDFLARE_API_TOKEN,NEON_API_KEY"
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
# Any secret whose name says "database" — NEON_DATABASE_URL was the last one,
# and MIGRATOR_DATABASE_URL arriving through GitHub instead of the Secrets Store
# would be the same mistake under a newer name. A pattern, not a list: the point
# is that no such secret exists here, whatever it is called next.
DATABASE_CREDENTIAL = /secrets\.[A-Z_]*DATABASE[A-Z_]*/

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

def assert_esc_exports_exactly_the_pulumi_plane
  steps_using(ESC_ACTION).each do |job, step|
    @log.unless_true(step.dig("with", "export-environment-variables") == ESC_EXPORTS,
                     "cd.yml:#{job}: ESC must export exactly #{ESC_EXPORTS}, never the default (ADR 0003)")
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
  assert_esc_exports_exactly_the_pulumi_plane
  assert_retired_credentials_stay_retired
  assert_no_runtime_secret_upload
  assert_ci_holds_no_database_credential
  @log.report("CD credential boundary: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__

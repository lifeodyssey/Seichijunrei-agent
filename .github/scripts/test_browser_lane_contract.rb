#!/usr/bin/env ruby
# frozen_string_literal: true

# The browser lane of the pull-request pipeline (card B4 / #1362).
#
#   selection   the web / e2e / deps filters select the job
#   scripts     it runs the browser package's own lint, typecheck and test,
#               which serve the emitted Worker themselves (the `webServer` in
#               e2e/playwright.config.ts) — no composite in between
#   staging     when the suite is pointed at staging instead of the emitted
#               Worker, it must present the Cloudflare Access service token
#               (D3 #1369). That is a header pair, not a cookie, so it rides on
#               `use.extraHTTPHeaders`; a suite that dropped it would answer
#               every navigation with the identity provider's login page and
#               report the app broken. And because `extraHTTPHeaders` is
#               unconditional, the pair must be scoped to the TARGET — a config
#               that spread it regardless would send staging's real service
#               token to whatever is listening on a laptop port, which is the
#               asymmetry `workers/edge/api-test/lane-origin.ts` already
#               refuses — and `extraHTTPHeaders` rides `context.request` too, so
#               a live cross-origin call (`web-neon-login.spec.ts` signs in
#               against the Neon Auth origin) would carry it off the staging
#               host entirely. Playwright's config is not executed by any unit
#               lane, so this reads it the way the lane contracts above read the
#               workflow
#
# `animichi-e2e` is one of the three projects `test_ci_workflow_contract.rb`
# requires the affected matrix to subtract, so nothing in that matrix can see
# this package: these assertions are the whole of what stands between its specs
# and a silently dark lane. Card B2 opened this seam with
# `test_agent_lane_contract.rb` for the Python lane; C1 (#1364) followed it here
# and in `test_schema_lane_contract.rb` when the shared file went over 300 lines.
#
# Usage: ruby .github/scripts/test_browser_lane_contract.rb [REPO_ROOT]

require_relative "workflow_document"

CI_FILE = File.join(repository_root, ".github", "workflows", "pr-verification.yml")
# The browser lane (card B4 / #1362). `animichi-e2e` is outside the affected
# matrix, so these are the only assertions standing between its specs and
# a silently dark lane: the `plan` filters that select the job, and the package
# scripts it runs. The retired composite must not come back — the served-Worker
# half of the lane lives in e2e/playwright.config.ts now.
BROWSER_FILTERS = %w[web e2e deps].freeze
BROWSER_SCRIPTS = %w[lint typecheck test].freeze
RETIRED_BROWSER_COMPOSITE = "cross-stack-e2e"
# The suite's own credential for a staging target (D3 #1369). The names live in
# `packages/contract/src/access-service-token.ts`, which is why the config must
# import them rather than spell either header for itself.
PLAYWRIGHT_CONFIG = File.join(repository_root, "e2e", "playwright.config.ts")
ACCESS_TOKEN_MODULE = '@animichi/contract/access-service-token'
ACCESS_TOKEN_READER = "accessServiceTokenHeaders(process.env)"
# The target discriminator: the reader is reached only off the loopback, and a
# token declared while the run points at the loopback is refused rather than
# dropped — a silently dropped credential is how an operator who forgot to
# repoint E2E_WEB_BASE_URL spends an afternoon reading an Access login page.
ACCESS_TOKEN_LANE_GUARD = "if (isLoopbackTarget(baseUrl)) throw new Error(loopbackRefusal());"
ACCESS_TOKEN_LOOPBACK_REFUSAL = /function loopbackRefusal\(\): string \{/
# `use.extraHTTPHeaders` is context-wide: it rides `context.request` calls too,
# and `web-neon-login.spec.ts` posts a live sign-in to the Neon Auth origin
# through exactly that API. Scoping the token to `baseUrl` alone therefore
# scoped nothing (PR #1498 review). Every base-URL variable the suite reads has
# to be the same host as the target, or the run is refused before it starts.
CROSS_ORIGIN_REFUSAL = "if (foreign.length > 0) throw new Error(crossOriginRefusal(foreign));"
# Kept in step with `rg -o 'process\.env\.[A-Z0-9_]+' e2e`: any variable naming
# an origin the browser can reach must be in the config's own list.
CROSS_ORIGIN_VARS = %w[NEON_AUTH_BASE_URL VITE_NEON_AUTH_BASE_URL].freeze
# One definition of "this machine", in the package that owns the credential.
LOOPBACK_RULE_MODULE = "isLoopbackHostname"

@log = ViolationLog.new
@ci = WorkflowDocument.load(CI_FILE)

def browser_step_source
  @ci.steps_of("e2e").map { |step| "#{step['uses']}#{step['run']}" }.join("\n")
end

def assert_browser_lane_is_selected_by_the_plan
  condition = @ci.dig("jobs", "e2e", "if").to_s
  BROWSER_FILTERS.each do |filter|
    @log.unless_true(condition.include?("needs.plan.outputs.#{filter} == 'true'"),
                     "pr-verification.yml:e2e: must run when the `#{filter}` filter matched")
  end
end

def assert_browser_lane_runs_the_package
  source = browser_step_source
  @log.unless_true(source.include?('pnpm --filter animichi-e2e run "$script"'),
                   "pr-verification.yml:e2e: must run the browser package's own scripts")
  @log.unless_true(looped_scripts(source) == BROWSER_SCRIPTS,
                   "pr-verification.yml:e2e: must run exactly #{BROWSER_SCRIPTS.join(', ')} " \
                   "(got #{looped_scripts(source).join(', ')})")
  @log.unless_true(!source.include?(RETIRED_BROWSER_COMPOSITE),
                   "pr-verification.yml:e2e: the retired #{RETIRED_BROWSER_COMPOSITE} composite is back")
end

def assert_the_suite_presents_the_staging_access_token
  config = File.read(PLAYWRIGHT_CONFIG)
  @log.unless_true(config.include?(ACCESS_TOKEN_MODULE),
                   "e2e/playwright.config.ts: must read the Access service token from #{ACCESS_TOKEN_MODULE}")
  @log.unless_true(config.include?(ACCESS_TOKEN_READER),
                   "e2e/playwright.config.ts: must resolve the token from the process environment")
  @log.unless_true(config.match?(/extraHTTPHeaders:\s*accessHeaders/),
                   "e2e/playwright.config.ts: the token must ride on use.extraHTTPHeaders, " \
                   "or every staging navigation answers with the Access login page")
  assert_the_token_is_scoped_to_a_staging_target(config)
  assert_the_token_cannot_leave_the_target_origin(config)
end

def assert_the_token_is_scoped_to_a_staging_target(config)
  @log.unless_true(config.include?(ACCESS_TOKEN_LANE_GUARD),
                   "e2e/playwright.config.ts: the token must be read only for a non-loopback target, " \
                   "or a local run sends staging's service token to whatever is on that port")
  @log.unless_true(config.match?(ACCESS_TOKEN_LOOPBACK_REFUSAL),
                   "e2e/playwright.config.ts: a token declared against a loopback target must be " \
                   "refused by name, not silently dropped")
  @log.unless_true(config.include?(LOOPBACK_RULE_MODULE),
                   "e2e/playwright.config.ts: \"this machine\" must come from #{LOOPBACK_RULE_MODULE} " \
                   "in #{ACCESS_TOKEN_MODULE}, not a second spelling that can disagree")
end

def assert_the_token_cannot_leave_the_target_origin(config)
  @log.unless_true(config.include?(CROSS_ORIGIN_REFUSAL),
                   "e2e/playwright.config.ts: use.extraHTTPHeaders is context-wide — the run must be " \
                   "refused when a configured origin sits off the target host")
  declared = cross_origin_vars_of(config)
  CROSS_ORIGIN_VARS.each do |name|
    @log.unless_true(declared.include?(name),
                     "e2e/playwright.config.ts: #{name} names an origin the browser reaches, so it " \
                     "must be in CROSS_ORIGIN_BASE_URL_VARS (got #{declared.join(', ')})")
  end
end

# The names inside the config's OWN list, not anywhere in the file: several of
# these variables also appear in `webServer.env`, so a bare `include?` stayed
# green when a name was deleted from the list that matters.
def cross_origin_vars_of(config)
  literal = config[/const CROSS_ORIGIN_BASE_URL_VARS = \[(.*?)\]/m, 1]
  return [] if literal.nil?

  literal.scan(/"([A-Z0-9_]+)"/).flatten
end

def main
  assert_browser_lane_is_selected_by_the_plan
  assert_browser_lane_runs_the_package
  assert_the_suite_presents_the_staging_access_token
  @log.report("browser lane contract: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__

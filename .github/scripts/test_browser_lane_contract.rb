#!/usr/bin/env ruby
# frozen_string_literal: true

# The browser lane of the pull-request pipeline (card B4 / #1362).
#
#   selection   the web / e2e / deps filters select the job
#   scripts     it runs the browser package's own lint, typecheck and test,
#               which serve the emitted Worker themselves (the `webServer` in
#               e2e/playwright.config.ts) — no composite in between
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

def main
  assert_browser_lane_is_selected_by_the_plan
  assert_browser_lane_runs_the_package
  @log.report("browser lane contract: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__

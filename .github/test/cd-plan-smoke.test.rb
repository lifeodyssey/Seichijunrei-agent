# SUT: cd.yml plan accepts a deployment baseline only after the actual staging smoke step succeeded.
require "minitest/autorun"
require "psych"

class CdPlanSmokeTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CD_FILE = File.join(ROOT, ".github", "workflows", "cd.yml")
  STAGING_JOB = "stage"
  STAGE_JOB_NAME = "CD / staging"
  SMOKE_STEP = "staging smoke"
  SMOKE_LOOKUP = %(select(.name == "#{STAGE_JOB_NAME}") | .steps[]? | select(.name == "#{SMOKE_STEP}"))

  def setup
    @cd = Psych.safe_load(File.read(CD_FILE), aliases: true)
  end

  def run_text(job)
    @cd.dig("jobs", job, "steps").to_a.map { |step| step["run"] }.compact.join("\n")
  end

  def smoke_step
    @cd.dig("jobs", STAGING_JOB, "steps").to_a.find { |step| step["name"] == SMOKE_STEP }.to_h
  end

  def commands_of(job)
    run_text(job).lines.grep_v(/\A\s*#/).join
  end

  def test_plan_reads_the_smoke_step_by_name
    assert(@cd.dig("jobs", STAGING_JOB, "name") == STAGE_JOB_NAME,
                     "cd.yml:#{STAGING_JOB}: `name` must stay `#{STAGE_JOB_NAME}` — `plan` reads it " \
                     "back off the API, and a rename empties that lookup instead of failing it")
    assert(!smoke_step.empty?,
                     "cd.yml:#{STAGING_JOB}: the probe's step must stay named `#{SMOKE_STEP}` — that " \
                     "name is the second hop of `plan`'s lookup, not decoration")
    assert(commands_of("plan").include?(SMOKE_LOOKUP),
                     "cd.yml:plan: must select the probe with `#{SMOKE_LOOKUP}` — a comment naming the " \
                     "job and the step is not the lookup, and a misspelt selector returns empty rather " \
                     "than red")
  end
end

# SUT: cd.yml plan chooses a completed, ancestral release baseline and rejects superseded heads.
require "minitest/autorun"
require "psych"

class CdPlanTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CD_FILE = File.join(ROOT, ".github", "workflows", "cd.yml")
  ZERO_SHA = "0000000000000000000000000000000000000000"
  HEAD_GUARD = "git ls-remote origin refs/heads/main"
  DEPLOYED_QUERY = %r{actions/workflows/cd\.yml/runs\?[^"']*\bstatus=completed\b}
  PAGED_QUERY = /\bpage=\$\{?page\}?/
  PAGE_LOOP = /for page in ([\d ]+); do/
  ACCEPTED_BASES = ['head_descends_from "$run_head"', 'head_descends_from "$base"'].freeze
  ANCESTOR_CHECK = "git merge-base --is-ancestor"

  def setup
    @cd = Psych.safe_load(File.read(CD_FILE), aliases: true)
    @source = File.read(CD_FILE)
  end

  def test_push_to_main_is_the_only_trigger
    triggers = (@cd["on"] || @cd[true])
    assert(triggers.keys == ["push"],
                     "cd.yml: `push` must be the only trigger (got #{triggers.keys.join(', ')})")
    assert(triggers.dig("push", "branches") == ["main"], "cd.yml: only main deploys")
    assert(triggers.dig("push", "tags").nil?, "cd.yml: a tag trigger is a second deployment path")
  end

  def plan_script
    @cd.dig("jobs", "plan", "steps").to_a.map { |step| step["run"] }.compact.join("\n")
  end

  def test_plan_selects_completed_ancestral_runs
    assert(plan_script.match?(DEPLOYED_QUERY) && plan_script.include?("head_sha"),
                     "cd.yml:plan: must base its range on a completed run's head, not on the previous push")
    assert(plan_script.match?(PAGED_QUERY) && plan_script[PAGE_LOOP, 1].to_s.split.size > 1,
                     "cd.yml:plan: must scan more than one page, under a literal cap — one page may hold no green smoke")
    assert(plan_script.include?(ANCESTOR_CHECK) && ACCEPTED_BASES.all? { |call| plan_script.include?(call) },
                     "cd.yml:plan: both candidate bases must be ones this head descends from, not merely resolvable ones")
  end

  def test_plan_has_safe_fallbacks_and_rejects_superseded_heads
    assert(plan_script.include?("$EVENT_BEFORE"),
                     "cd.yml:plan: must fall back to `github.event.before` when no candidate run qualifies")
    assert(@cd.dig("jobs", "plan", "permissions").to_h["actions"] == "read",
                     "cd.yml:plan: reading the Actions API needs `actions: read` on the job")
    assert(plan_script.include?(ZERO_SHA),
                     "cd.yml:plan: must fall back off a zero `before` instead of failing the push")
    assert(plan_script.include?(HEAD_GUARD),
                     "cd.yml:plan: must refuse a head origin/main has already moved past")
  end

  def test_plan_exposes_the_selected_packages_and_deploy_units
    %w[packages deploy].each do |output|
      assert(@cd.dig("jobs", "plan", "outputs").to_h.key?(output),
                       "cd.yml:plan: must publish the `#{output}` output")
    end
  end
end

# SUT: cd.yml publication steps invoke the official Wrangler action with sealed, versioned artifacts.
require "minitest/autorun"
require "psych"
require "json"

class CdPublishTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CD_FILE = File.join(ROOT, ".github", "workflows", "cd.yml")
  WRANGLER_ACTION = "cloudflare/wrangler-action"
  DEPLOY_TAG = "--tag sha-${{ github.sha }}"
  SEALED_BUNDLE = "--no-bundle"
  DEPLOY_TARGETS = { "stage" => "staging", "promote-production" => "production" }.freeze
  PUBLISH_COMMAND = /wrangler deploy\b/
  DRY_RUN = /(?:\A|\s)--dry-run(?:\s|\z)/
  COMMAND_SEPARATOR = /\n|&&|\|\||;/
  SHELL_COMMENT = /\s#.*\z/

  def setup
    @cd = Psych.safe_load(File.read(CD_FILE), aliases: true)
  end

  def steps_using(job, action)
    @cd.dig("jobs", job, "steps").to_a.select { |step| step["uses"].to_s.start_with?("#{action}@") }
  end

  def run_text(job)
    @cd.dig("jobs", job, "steps").to_a.map { |step| step["run"] }.compact.join("\n")
  end

  def deploy_steps
    @cd.fetch("jobs").each_key.flat_map { |job| steps_using(job, WRANGLER_ACTION).map { |step| [job, step] } }
  end

  def pinned_wrangler
    JSON.parse(File.read(File.join(ROOT, "package.json"))).dig("devDependencies", "wrangler")
  end

  def test_deploys_pin_wrangler
    version = pinned_wrangler
    assert(!version.nil?, "package.json: the workspace must pin a Wrangler version")
    deploy_steps.each do |job, step|
      assert(step.dig("with", "wranglerVersion") == version,
                       "cd.yml:#{job}: publishing must use the pinned Wrangler #{version}")
    end
  end

  def worker_deploy_commands
    deploy_steps.map { |job, step| [job, step.dig("with", "command").to_s] }
                .select { |_job, command| command.start_with?("deploy ") }
  end

  def test_deploys_tag_the_version
    assert(!deploy_steps.empty?, "cd.yml: no job publishes a Worker")
    worker_deploy_commands.each do |job, command|
      assert(command.include?(DEPLOY_TAG),
                       "cd.yml:#{job}: every publish must tag its version #{DEPLOY_TAG}")
    end
  end

  def test_deploys_publish_the_sealed_bundle
    worker_deploy_commands.each do |job, command|
      assert(command.include?(SEALED_BUNDLE),
                       "cd.yml:#{job}: every publish must ship the sealed artifact (#{SEALED_BUNDLE})")
    end
  end

  def test_deploys_name_their_own_environment
    DEPLOY_TARGETS.each do |job, environment|
      commands = steps_using(job, WRANGLER_ACTION).map { |step| step.dig("with", "command").to_s }
      assert(commands.all? { |command| command.include?("--env #{environment}") },
                       "cd.yml:#{job}: every publish here must target --env #{environment}")
    end
  end

  def shell_commands(job)
    run_text(job).gsub(/\\\n\s*/, " ").split(COMMAND_SEPARATOR).map { |command| command.sub(SHELL_COMMENT, "").strip }
  end

  def shell_publishes(job)
    shell_commands(job).select { |command| command.match?(PUBLISH_COMMAND) && !command.match?(DRY_RUN) }
  end

  def assert_shell_publish_obeys(job, environment, command)
    assert(command.include?("--env #{environment}"),
                     "cd.yml:#{job}: a shell publish here must target --env #{environment}")
    assert(command.include?(DEPLOY_TAG),
                     "cd.yml:#{job}: a shell publish here must tag its version #{DEPLOY_TAG}")
  end

  def test_shell_publishes_obey_the_same_rules
    @cd.fetch("jobs").each_key do |job|
      environment = DEPLOY_TARGETS[job]
      shell_publishes(job).each do |command|
        assert(!environment.nil?, "cd.yml:#{job}: this job must not publish a Worker at all")
        assert_shell_publish_obeys(job, environment, command)
      end
    end
  end
end

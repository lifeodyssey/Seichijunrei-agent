# SUT: pr-verification.yml selected-package gates and the workflow-wide Postgres image tag.
require "minitest/autorun"
require "psych"

class PrVerificationAffectedTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CI_FILE = File.join(ROOT, ".github", "workflows", "pr-verification.yml")
  PACKAGE_SCRIPTS = %w[lint typecheck test test:integration].freeze
  MATRIX_TOOLCHAINS = [
    ["@animichi/eval", "uv python install"],
    ["catalog", "ariga/setup-atlas"],
    ["catalog", "docker build -f apps/agent/docker/test-postgres/Dockerfile"],
    ["infra", "pulumi/actions"]
  ].freeze
  def setup
    @ci = Psych.safe_load(File.read(CI_FILE), aliases: true)
  end

  def test_matrix_guard
    assert(@ci.dig("jobs", "affected", "if").to_s.include?("needs.plan.outputs.packages != '[]'"),
                     "pr-verification.yml: affected must not start on an empty matrix")
    assert(@ci.dig("jobs", "affected", "strategy", "matrix", "package").to_s
                        .include?("needs.plan.outputs.packages"),
                     "pr-verification.yml: the matrix must be the plan job's package list")
  end

  def matrix_step_source
    @ci.dig("jobs", "affected", "steps").to_a.map { |step| step["run"] }.compact.join("\n")
  end

  def matrix_scripts
    matrix_step_source[/^\s*for script in ([^;]+); do/, 1].to_s.split
  end

  def test_matrix_runs_package_scripts
    assert(matrix_step_source.include?('pnpm --filter "$PACKAGE" run --if-present "$script"'),
                     "pr-verification.yml: the matrix must run the package's own scripts")
    assert(matrix_scripts == PACKAGE_SCRIPTS,
                     "pr-verification.yml: the matrix must run exactly #{PACKAGE_SCRIPTS.join(', ')} " \
                     "(got #{matrix_scripts.join(', ')})")
  end

  def provisions?(step, package, tool)
    step.is_a?(Hash) && step["if"].to_s.include?(package) && "#{step['uses']}#{step['run']}".include?(tool)
  end

  def test_matrix_provisions_toolchains
    MATRIX_TOOLCHAINS.each do |package, tool|
      assert(@ci.dig("jobs", "affected", "steps").to_a.any? { |step| provisions?(step, package, tool) },
                       "pr-verification.yml: `#{package}` needs a matrix step providing #{tool}")
    end
  end
end

class PrVerificationPostgresImageTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  IMAGE_DECLARATION = "packages/test-postgres/postgres-image.env"
  IMAGE_BUILD = "docker build -f apps/agent/docker/test-postgres/Dockerfile"
  IMAGE_REFERENCE = '"$TEST_POSTGRES_IMAGE"'
  DECLARED_IMAGE = File.read(File.join(ROOT, IMAGE_DECLARATION))[/^TEST_POSTGRES_IMAGE=(.+)$/, 1].to_s.strip

  def setup
    @ci = Psych.safe_load(File.read(File.join(ROOT, ".github/workflows/pr-verification.yml")), aliases: true)
  end

  def image_build_runs
    @ci.fetch("jobs").keys.flat_map { |job| @ci.dig("jobs", job, "steps").to_a }
       .map { |step| step["run"] }.compact.select { |run| run.include?(IMAGE_BUILD) }
  end

  def built_tag(run)
    run[/#{Regexp.escape(IMAGE_BUILD)} -t (\S+) \./, 1].to_s
  end

  def resolves_the_declared_tag?(run)
    return true if built_tag(run) == DECLARED_IMAGE

    built_tag(run) == IMAGE_REFERENCE && run.include?(". #{IMAGE_DECLARATION}")
  end

  def test_image_builds_resolve_one_tag
    assert(!image_build_runs.empty?,
                     "pr-verification.yml: nothing builds the offline Postgres image any more")
    image_build_runs.each do |run|
      assert(resolves_the_declared_tag?(run),
                       "pr-verification.yml: the image build tagged #{built_tag(run)} neither sources " \
                       "#{IMAGE_DECLARATION} nor names the tag it declares (#{DECLARED_IMAGE})")
    end
  end

end

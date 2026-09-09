# SUT: cd.yml Pulumi/ESC and publish steps keep each credential within its owning job and purpose.
require "minitest/autorun"
require "psych"

class CdCredentialsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CD_FILE = File.join(ROOT, ".github", "workflows", "cd.yml")
  WRANGLER_ACTION = "cloudflare/wrangler-action"
  AUTH_ACTION = "pulumi/auth-actions"
  ESC_ACTION = "pulumi/esc-action"
  PULUMI_ACTION = "pulumi/actions"
  NEON_CLI = /neonctl|reset-staging-baseline\.sh/
  PUBLISH_TOKEN = "CLOUDFLARE_API_TOKEN"
  NEON_CONTROL_PLANE = "NEON_API_KEY"
  PULUMI_PLANE = [PUBLISH_TOKEN, NEON_CONTROL_PLANE].freeze
  ACCESS_SERVICE_TOKEN = %w[CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET].freeze
  STAGING_JOB = "stage"
  STAGING_UNION = (PULUMI_PLANE + ACCESS_SERVICE_TOKEN).freeze
  PUBLISHING_STEPS = ["Deploy the migrator Worker", "Deploy the catalog Worker",
                      "Deploy the users Worker", "Deploy the edge Worker",
                      "Deploy the web Worker"].freeze
  RESET_STEP = "Reset the staging schema baseline"
  SMOKE_STEP = "staging smoke"
  SMOKE_SCRIPT = /staging-smoke-check\.sh/
  STAGING_CREDENTIALS = ([[PUBLISH_TOKEN, [PUBLISHING_STEPS, %r{cloudflare/wrangler-action@}]],
                          [NEON_CONTROL_PLANE, [[RESET_STEP], NEON_CLI]]] +
                         ACCESS_SERVICE_TOKEN.map { |name| [name, [[SMOKE_STEP], SMOKE_SCRIPT]] }).to_h.freeze
  WRANGLER_API_TOKEN = "${{ env.CLOUDFLARE_API_TOKEN }}"
  PULUMI_TOKEN_TYPE = "urn:pulumi:token-type:access_token:personal"
  PULUMI_SCOPE = "user:lifeodyssey"
  RETIRED_CREDENTIALS = %w[PULUMI_BACKEND_URL PULUMI_CONFIG_PASSPHRASE R2_ACCESS_KEY_ID
                           R2_SECRET_ACCESS_KEY CLOUDFLARE_PULUMI_API_TOKEN].freeze
  RUNTIME_SECRETS = %w[DEEPSEEK_API_KEY MIMO_API_KEY ZEN_GO_API_KEY SUPABASE_DB_URL
                       GOOGLE_MAPS_API_KEY LOGFIRE_TOKEN TURNSTILE_SECRET ANON_ID_SECRET].freeze
  DATABASE_CREDENTIAL = /\b[A-Z][A-Z0-9_]*DATABASE[A-Z0-9_]*\b/

  def setup
    @cd = Psych.safe_load(File.read(CD_FILE), aliases: true)
    @source = File.read(CD_FILE)
  end

  def steps_using(action)
    @cd.fetch("jobs").each_key.flat_map do |job|
      @cd.dig("jobs", job, "steps").to_a.select { |step| step["uses"].to_s.start_with?("#{action}@") }.map { |step| [job, step] }
    end
  end

  def test_pulumi_login_is_the_only_token_type_this_org_can_mint
    steps_using(AUTH_ACTION).each do |job, step|
      assert(step.dig("with", "requested-token-type") == PULUMI_TOKEN_TYPE,
                       "cd.yml:#{job}: the Pulumi login must request #{PULUMI_TOKEN_TYPE}")
      assert(step.dig("with", "scope") == PULUMI_SCOPE,
                       "cd.yml:#{job}: the exchanged token must be scoped to #{PULUMI_SCOPE}")
    end
  end

  def neon_control_plane_jobs
    cli_jobs = @cd.fetch("jobs").each_key.select do |job|
      @cd.dig("jobs", job, "steps").to_a.any? { |step| step["run"].to_s.match?(NEON_CLI) }
    end
    (steps_using(PULUMI_ACTION).map(&:first) + cli_jobs).uniq
  end

  def esc_allowance(job)
    job == STAGING_JOB ? STAGING_UNION : PULUMI_PLANE
  end

  def test_esc_exports_only_what_its_stage_publishes_with
    steps_using(ESC_ACTION).each do |job, step|
      exports = esc_exported_names(step)
      allowed = esc_allowance(job)
      assert(!exports.empty? && (exports - allowed).empty?,
             "cd.yml:#{job}: ESC must export a non-empty subset of #{allowed.join(', ')}")
    end
  end

  def test_neon_credentials_have_a_control_plane_reader
    opened = steps_using(ESC_ACTION).select { |_job, step| esc_exported_names(step).include?(NEON_CONTROL_PLANE) }
    opened.each do |job, _step|
      assert_includes neon_control_plane_jobs, job, "cd.yml:#{job}: #{NEON_CONTROL_PLANE} has no reader"
    end
  end

  def test_the_staging_job_opens_the_union_its_units_spend
    opened = steps_using(ESC_ACTION).select { |job, _step| job == STAGING_JOB }
                                    .flat_map { |_job, step| esc_exported_names(step) }
    assert(opened.sort == STAGING_UNION.sort,
                     "cd.yml:#{STAGING_JOB}: must open #{STAGING_UNION.join(', ')} from ESC — one job " \
                     "runs every staging unit, so it opens what all of them spend " \
                     "(got #{opened.empty? ? 'nothing' : opened.join(', ')})")
  end

  def step_label(step)
    step["name"] || step["uses"] || step["run"].to_s.lines.first.to_s.strip
  end

  def spends?(step, key)
    step.to_s.match?(/env\.#{key}\b|\$\{?#{key}\b/)
  end

  def test_each_credential_stays_inside_its_unit
    steps = @cd.dig("jobs", STAGING_JOB, "steps").to_a
    STAGING_CREDENTIALS.each do |key, (spenders, reader)|
      trespassers = steps.select { |step| spends?(step, key) }.map { |step| step_label(step) } - spenders
      assert(trespassers.empty?,
                       "cd.yml:#{STAGING_JOB}: #{key} belongs to #{spenders.join(', ')} and no other " \
                       "step may reach for it (#{trespassers.join(', ')})")
      assert(steps.any? { |step| step.to_s.match?(reader) },
                       "cd.yml:#{STAGING_JOB}: #{key} is opened with nothing in the job that reads it " \
                       "(#{reader.source})")
    end
  end

  def test_the_access_token_stays_inside_the_staging_job
    ACCESS_SERVICE_TOKEN.each do |name|
      holders = @cd.fetch("jobs").each_key.select { |job| @cd.dig("jobs", job).to_s.include?(name) }
      assert(holders == [STAGING_JOB],
                       "cd.yml: #{name} is staging's front-door credential and belongs to " \
                       "#{STAGING_JOB} alone (held by #{holders.empty? ? 'nothing' : holders.join(', ')})")
    end
  end

  def test_wrangler_publishes_on_the_opened_token
    steps_using(WRANGLER_ACTION).each do |job, step|
      assert(step.dig("with", "apiToken") == WRANGLER_API_TOKEN,
                       "cd.yml:#{job}: Wrangler must authenticate with #{WRANGLER_API_TOKEN}")
      assert(steps_using(ESC_ACTION).any? { |esc_job, esc| esc_job == job && esc_exported_names(esc).include?(PUBLISH_TOKEN) },
                       "cd.yml:#{job}: publishes without opening #{PUBLISH_TOKEN} from ESC")
    end
  end

  def test_retired_credentials_stay_retired
    named = RETIRED_CREDENTIALS.select { |name| @source.include?(name) }
    assert(named.empty?, "cd.yml: Pulumi Cloud replaced these (#{named.join(', ')})")
  end

  def test_no_runtime_secret_upload
    assert(!@source.include?("secret bulk"), "cd.yml: CI must never bulk-upload Worker secrets")
    assert(steps_using(WRANGLER_ACTION).none? { |_job, step| step.fetch("with", {}).key?("secrets") },
                     "cd.yml: wrangler-action's `secrets:` input uploads runtime secrets")
    named = RUNTIME_SECRETS.select { |name| @source.include?(name) }
    assert(named.empty?, "cd.yml: runtime secrets belong to Pulumi, not CI (#{named.join(', ')})")
  end

  def test_ci_holds_no_database_credential
    named = @source.scan(DATABASE_CREDENTIAL).uniq
    assert(named.empty?,
                     "cd.yml: the database is reachable only through the migrator (#{named.join(', ')})")
  end

  def esc_exported_names(step)
    step.dig("with", "export-environment-variables").to_s.split(",").map(&:strip).reject(&:empty?)
  end
end

# SUT: e2e/playwright.config.ts; tests check service-token scope without starting a browser.
require "minitest/autorun"

class PlaywrightConfigTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  PLAYWRIGHT_CONFIG = File.join(ROOT, "e2e", "playwright.config.ts")
  ACCESS_TOKEN_MODULE = '@animichi/contract/access-service-token'
  ACCESS_TOKEN_READER = "accessServiceTokenHeaders(process.env)"
  ACCESS_TOKEN_LANE_GUARD = "if (isLoopbackTarget(baseUrl)) throw new Error(loopbackRefusal());"
  ACCESS_TOKEN_LOOPBACK_REFUSAL = /function loopbackRefusal\(\): string \{/
  CROSS_ORIGIN_REFUSAL = "if (foreign.length > 0) throw new Error(crossOriginRefusal(foreign));"
  CROSS_ORIGIN_VARS = %w[NEON_AUTH_BASE_URL VITE_NEON_AUTH_BASE_URL].freeze
  LOOPBACK_RULE_MODULE = "isLoopbackHostname"

  def test_the_suite_presents_the_staging_access_token
    config = File.read(PLAYWRIGHT_CONFIG)
    assert(config.include?(ACCESS_TOKEN_MODULE),
                     "e2e/playwright.config.ts: must read the Access service token from #{ACCESS_TOKEN_MODULE}")
    assert(config.include?(ACCESS_TOKEN_READER),
                     "e2e/playwright.config.ts: must resolve the token from the process environment")
    assert(config.match?(/extraHTTPHeaders:\s*accessHeaders/),
                     "e2e/playwright.config.ts: the token must ride on use.extraHTTPHeaders, " \
                     "or every staging navigation answers with the Access login page")
    assert_the_token_is_scoped_to_a_staging_target(config)
    assert_the_token_cannot_leave_the_target_origin(config)
  end

  def assert_the_token_is_scoped_to_a_staging_target(config)
    assert(config.include?(ACCESS_TOKEN_LANE_GUARD),
                     "e2e/playwright.config.ts: the token must be read only for a non-loopback target, " \
                     "or a local run sends staging's service token to whatever is on that port")
    assert(config.match?(ACCESS_TOKEN_LOOPBACK_REFUSAL),
                     "e2e/playwright.config.ts: a token declared against a loopback target must be " \
                     "refused by name, not silently dropped")
    assert(config.include?(LOOPBACK_RULE_MODULE),
                     "e2e/playwright.config.ts: \"this machine\" must come from #{LOOPBACK_RULE_MODULE} " \
                     "in #{ACCESS_TOKEN_MODULE}, not a second spelling that can disagree")
  end

  def assert_the_token_cannot_leave_the_target_origin(config)
    assert(config.include?(CROSS_ORIGIN_REFUSAL),
                     "e2e/playwright.config.ts: use.extraHTTPHeaders is context-wide — the run must be " \
                     "refused when a configured origin sits off the target host")
    declared = cross_origin_vars_of(config)
    CROSS_ORIGIN_VARS.each do |name|
      assert(declared.include?(name),
                       "e2e/playwright.config.ts: #{name} names an origin the browser reaches, so it " \
                       "must be in CROSS_ORIGIN_BASE_URL_VARS (got #{declared.join(', ')})")
    end
  end

  def cross_origin_vars_of(config)
    literal = config[/const CROSS_ORIGIN_BASE_URL_VARS = \[(.*?)\]/m, 1]
    return [] if literal.nil?

    literal.scan(/"([A-Z0-9_]+)"/).flatten
  end
end

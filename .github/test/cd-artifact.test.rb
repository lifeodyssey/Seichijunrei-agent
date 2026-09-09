# SUT: cd.yml build and artifact consumers publish and promote the same immutable release.
require "minitest/autorun"
require "psych"

class CdArtifactTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CD_FILE = File.join(ROOT, ".github", "workflows", "cd.yml")
  STAGING_JOBS = %w[stage].freeze
  ARTIFACT = "release-${{ github.sha }}"
  UPLOAD = "actions/upload-artifact"
  DOWNLOAD = "actions/download-artifact"
  REBUILD_MARKERS = [
    /pnpm --filter web (?:run )?build/,
    /--dry-run/,
    %r{docker/build-push-action},
    /containers push/,
    Regexp.new(Regexp.escape(UPLOAD))
  ].freeze

  def setup
    @cd = Psych.safe_load(File.read(CD_FILE), aliases: true)
    @source = File.read(CD_FILE)
  end

  def steps_using(job, action)
    @cd.dig("jobs", job, "steps").to_a.select { |step| step["uses"].to_s.start_with?("#{action}@") }
  end

  def all_steps
    @cd.fetch("jobs").each_key.flat_map { |job| @cd.dig("jobs", job, "steps").to_a }
  end

  def test_one_build_one_artifact
    uploads = @cd.fetch("jobs").each_key.select { |job| steps_using(job, UPLOAD).any? }
    assert(uploads == ["build"],
                     "cd.yml: exactly one job may upload the release artifact (got #{uploads.join(', ')})")
    names = all_steps.map { |step| step.dig("with", "name") }.compact
    assert(names.uniq == [ARTIFACT],
                     "cd.yml: build and every consumer must name the one artifact #{ARTIFACT}")
  end

  def test_every_stage_downloads_the_artifact
    (STAGING_JOBS + ["promote-production"]).each do |job|
      downloads = steps_using(job, DOWNLOAD)
      assert(downloads.any?, "cd.yml:#{job}: must deploy the built artifact, not a fresh checkout")
      assert(downloads.all? { |step| step.dig("with", "name") == ARTIFACT },
                       "cd.yml:#{job}: must name #{ARTIFACT}, not take whichever artifact the run holds")
    end
  end

  def rebuild_markers_in(job)
    text = @cd.dig("jobs", job, "steps").to_a.map { |step| "#{step['uses']}\n#{step['run']}" }.join("\n")
    REBUILD_MARKERS.select { |marker| text.match?(marker) }.map(&:source)
  end

  def test_production_never_rebuilds
    found = rebuild_markers_in("promote-production")
    assert(found.empty?,
                     "cd.yml:promote-production: must promote the artifact, not rebuild (#{found.join(', ')})")
  end
end

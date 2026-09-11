# frozen_string_literal: true
require 'time'

# GitHub provides immutable storage and download verification. These are the
# repository's rules for which successful producer is eligible for deployment.
module ReleaseSelection
  REPOSITORY = 'lifeodyssey/animichi'
  WORKFLOW = '.github/workflows/release-build.yml'
  module_function

  def require_value(condition, message)
    raise ArgumentError, message unless condition
  end

  def validate(artifact, run, workflow, id:, repository_id:)
    validate_artifact(artifact, id)
    validate_producer(run, workflow, repository_id)
    validate_binding(artifact, run, repository_id)
    envelope(artifact, run)
  rescue KeyError, TypeError
    raise ArgumentError, 'incomplete release provenance'
  end

  def validate_artifact(artifact, id)
    require_value(id.match?(/\A[1-9]\d*\z/), 'artifact_id must be a positive integer')
    require_value(artifact.fetch('id').to_s == id, 'artifact ID mismatch')
    require_value(artifact.fetch('expired') == false, 'artifact expired')
    require_value(Time.iso8601(artifact.fetch('expires_at')) > Time.now, 'artifact expired')
    require_value(artifact.fetch('digest').match?(/\Asha256:[a-f0-9]{64}\z/), 'invalid artifact digest')
  end

  def validate_producer(run, workflow, repository_id)
    require_value(run.values_at('event', 'status', 'conclusion') == %w[push completed success], 'producer did not succeed on push')
    require_value(run.fetch('head_branch') == 'main', 'producer branch is not main')
    require_value(run.fetch('head_sha').match?(/\A[a-f0-9]{40}\z/), 'invalid release source')
    require_value(workflow.fetch('path') == WORKFLOW && workflow.fetch('id') == run.fetch('workflow_id'), 'producer workflow mismatch')
    %w[repository head_repository].each { |key| validate_repository(run.fetch(key), repository_id) }
  end

  def validate_repository(repository, repository_id)
    require_value(repository.fetch('full_name') == REPOSITORY, 'repository mismatch')
    require_value(repository.fetch('id').to_s == repository_id, 'repository ID mismatch')
  end

  def validate_binding(artifact, run, repository_id)
    origin = artifact.fetch('workflow_run')
    require_value(origin.fetch('id') == run.fetch('id'), 'producer run mismatch')
    require_value(origin.fetch('head_sha') == run.fetch('head_sha'), 'release source mismatch')
    require_value(origin.fetch('head_branch') == 'main', 'artifact branch mismatch')
    %w[repository_id head_repository_id].each { |key| require_value(origin.fetch(key).to_s == repository_id, 'artifact repository mismatch') }
    expected = "release-snapshot-#{run.fetch('head_sha')}-#{run.fetch('run_attempt')}"
    require_value(artifact.fetch('name') == expected, 'artifact is not a complete release snapshot')
  end

  def envelope(artifact, run)
    { 'artifact_id' => artifact.fetch('id').to_s, 'artifact_digest' => artifact.fetch('digest'),
      'source_sha' => run.fetch('head_sha'), 'run_id' => run.fetch('id').to_s,
      'run_attempt' => run.fetch('run_attempt').to_s, 'repository' => REPOSITORY }
  end
end

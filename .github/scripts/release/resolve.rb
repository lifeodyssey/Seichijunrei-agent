# frozen_string_literal: true
require 'json'
require 'open3'
require_relative "../../lib/release/selection"

def github_api(path)
  output, status = Open3.capture2('gh', 'api', '-H', 'X-GitHub-Api-Version: 2026-03-10', path)
  abort 'GitHub provenance lookup failed' unless status.success?
  JSON.parse(output)
end

id = ENV.fetch('ARTIFACT_ID')
ReleaseSelection.require_value(id.match?(/\A[1-9]\d*\z/), 'invalid artifact_id')
ReleaseSelection.require_value(ENV.fetch('GITHUB_REF') == 'refs/heads/main', 'controller must run on main')
ReleaseSelection.require_value(ENV.fetch('GITHUB_REPOSITORY') == ReleaseSelection::REPOSITORY, 'controller repository mismatch')
base = "repos/#{ReleaseSelection::REPOSITORY}/actions"
artifact = github_api("#{base}/artifacts/#{id}")
attempt = artifact.fetch('name').match(/\Arelease-snapshot-[a-f0-9]{40}-([1-9]\d*)\z/)
abort 'artifact is not a complete release snapshot' unless attempt
run = github_api("#{base}/runs/#{Integer(artifact.fetch('workflow_run').fetch('id'))}/attempts/#{attempt[1]}")
workflow = github_api("#{base}/workflows/#{Integer(run.fetch('workflow_id'))}")
selection = ReleaseSelection.validate(artifact, run, workflow, id: id, repository_id: ENV.fetch('GITHUB_REPOSITORY_ID'))
_, ancestry = Open3.capture2e('git', 'merge-base', '--is-ancestor', selection.fetch('source_sha'), ENV.fetch('GITHUB_SHA'))
abort 'release source is outside the trusted controller main history' unless ancestry.success?
expected = ENV['EXPECTED_DIGEST']
abort 'selected artifact digest changed' if expected && expected != selection.fetch('artifact_digest')
File.write('selection.json', JSON.pretty_generate(selection.merge('controller_sha' => ENV.fetch('GITHUB_SHA'))))
File.open(ENV.fetch('GITHUB_OUTPUT'), 'a') { |file| selection.each { |key, value| file.puts("#{key}=#{value}") } }

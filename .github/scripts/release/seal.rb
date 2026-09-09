# frozen_string_literal: true
require 'json'
require_relative "../../lib/release/snapshot"
require_relative "../../lib/release/source_closure"

manifest = { 'format' => 1, 'kind' => 'full-snapshot', 'repository' => ENV.fetch('GITHUB_REPOSITORY'),
             'source_sha' => ENV.fetch('GITHUB_SHA'), 'run_id' => ENV.fetch('GITHUB_RUN_ID'),
             'run_attempt' => ENV.fetch('GITHUB_RUN_ATTEMPT'),
             'images' => { 'agent' => ENV.fetch('AGENT_IMAGE'), 'migrator' => ENV.fetch('MIGRATOR_IMAGE') },
             'files' => ReleaseSnapshot.hashes('release') }
ReleaseSnapshot.validate('release', manifest, manifest)
ReleaseSourceClosure.validate(manifest.fetch('source_sha'), 'release')
File.write('release/release.json', JSON.pretty_generate(manifest))

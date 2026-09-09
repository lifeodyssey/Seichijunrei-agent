# frozen_string_literal: true
require 'json'
require_relative "../../lib/release/archive"
require_relative "../../lib/release/snapshot"
require_relative "../../lib/release/source_closure"

abort 'unexpected release download contents' unless Dir.children('incoming') == ['release.tar']
ReleaseArchive.validate('incoming/release.tar')
abort 'release extraction directory already exists' if File.exist?('release')
abort 'release extraction failed' unless system('tar', '-xf', 'incoming/release.tar', '--no-same-owner')
manifest = JSON.parse(File.read('release/release.json'))
selection = JSON.parse(File.read('selection.json'))
ReleaseSnapshot.validate('release', manifest, selection)
ReleaseSourceClosure.validate(selection.fetch('source_sha'), 'release')

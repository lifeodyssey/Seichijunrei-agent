# frozen_string_literal: true
require 'digest'
require_relative 'selection'

module ReleaseSnapshot
  REQUIRED_FILES = %w[
    catalog/bundle/index.js catalog/wrangler.json users/bundle/index.js users/wrangler.json
    edge/bundle/entry.js edge/wrangler.json migrator/bundle/index.js migrator/wrangler.json
    migrator/bundle/contract.json
    web/.output/server/index.mjs web/wrangler.json migrations/atlas.sum
    foundation/infra/Pulumi.yaml foundation/infra/database-access/Pulumi.yaml
    foundation/infra/database-access/sdks/neon/bin/index.js
    foundation/package.json foundation/pnpm-lock.yaml foundation/pnpm-workspace.yaml foundation/.pulumi.version
  ].freeze
  module_function

  def hashes(root)
    paths = Dir.glob('**/*', File::FNM_DOTMATCH, base: root).sort
    paths.select { |path| File.file?(File.join(root, path)) && path != 'release.json' }
         .to_h { |path| [path, Digest::SHA256.file(File.join(root, path)).hexdigest] }
  end

  def validate(root, manifest, selection)
    ReleaseSelection.require_value(manifest.values_at('format', 'kind') == [1, 'full-snapshot'], 'unsupported snapshot')
    %w[source_sha repository run_id run_attempt].each { |key| ReleaseSelection.require_value(manifest.fetch(key) == selection.fetch(key), 'snapshot provenance mismatch') }
    files = hashes(root)
    ReleaseSelection.require_value(files == manifest.fetch('files'), 'snapshot content mismatch')
    ReleaseSelection.require_value((REQUIRED_FILES - files.keys).empty?, 'incomplete release snapshot')
    ReleaseSelection.require_value(files.keys.any? { |path| path.start_with?('web/.output/public/') }, 'missing web assets')
    validate_images(manifest.fetch('images'))
    true
  end

  def validate_images(images)
    ReleaseSelection.require_value(images.keys.sort == %w[agent migrator], 'missing paired image')
    images.each do |unit, reference|
      pattern = %r{\Aregistry\.cloudflare\.com/[a-f0-9]{32}/animichi-#{unit}@sha256:[a-f0-9]{64}\z}
      ReleaseSelection.require_value(reference.match?(pattern), 'image must use an immutable registry digest')
    end
  end
end

# frozen_string_literal: true
require_relative 'selection'

module ReleaseRegistry
  MANIFEST_TYPES = %w[application/vnd.oci.image.manifest.v1+json application/vnd.docker.distribution.manifest.v2+json].freeze
  module_function

  def validate(reference, manifest, image, account)
    ReleaseSelection.require_value(reference.start_with?("registry.cloudflare.com/#{account}/"), 'registry account mismatch')
    ReleaseSelection.require_value(reference.end_with?("@#{manifest['digest']}"), 'registry digest mismatch')
    ReleaseSelection.require_value(MANIFEST_TYPES.include?(manifest['mediaType']), 'single image manifest required')
    ReleaseSelection.require_value(image.values_at('os', 'architecture') == %w[linux amd64], 'container platform must be linux/amd64')
    true
  end
end

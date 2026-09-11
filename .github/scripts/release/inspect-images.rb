# frozen_string_literal: true
require 'json'
require 'open3'
require_relative "../../lib/release/registry"
require_relative "../../lib/release/snapshot"

def inspect_image(reference, field)
  output, status = Open3.capture2('docker', 'buildx', 'imagetools', 'inspect', reference, '--format', "{{json .#{field}}}")
  abort 'registry image does not exist or cannot be read' unless status.success?
  JSON.parse(output)
end

images = JSON.parse(File.read('release/release.json')).fetch('images')
ReleaseSnapshot.validate_images(images)
proof = images.to_h do |unit, reference|
  manifest = inspect_image(reference, 'Manifest')
  image = inspect_image(reference, 'Image')
  ReleaseRegistry.validate(reference, manifest, image, ENV.fetch('CLOUDFLARE_ACCOUNT_ID'))
  [unit, { 'reference' => reference, 'manifest' => manifest, 'platform' => image.slice('os', 'architecture') }]
end
File.write('registry-proof.json', JSON.pretty_generate(proof))

# frozen_string_literal: true
require 'json'
require 'open3'
require 'time'
require_relative "../../lib/release/receipt"

id = ENV.fetch('RECEIPT_ID')
ReleaseSelection.require_value(id.match?(/\A[1-9]\d*\z/), 'invalid receipt artifact ID')
output, status = Open3.capture2('gh', 'api', '-H', 'X-GitHub-Api-Version: 2026-03-10', "repos/lifeodyssey/animichi/actions/artifacts/#{id}")
abort 'staging receipt metadata is unavailable' unless status.success?
artifact = JSON.parse(output)
receipt = JSON.parse(File.read('staging-receipt/receipt.json'))
expected_name = "staging-receipt-#{ENV.fetch('GITHUB_RUN_ID')}-#{receipt.fetch('controller_run_attempt')}"
ReleaseSelection.require_value(artifact['id'].to_s == id && artifact['name'] == expected_name, 'staging receipt artifact mismatch')
ReleaseSelection.require_value(artifact['expired'] == false && Time.iso8601(artifact.fetch('expires_at')) > Time.now, 'staging receipt expired')
ReleaseSelection.require_value(artifact.fetch('digest').match?(/\Asha256:[a-f0-9]{64}\z/), 'invalid receipt artifact digest')
ReleaseSelection.require_value(artifact.fetch('digest').delete_prefix('sha256:') == ENV.fetch('RECEIPT_DIGEST').delete_prefix('sha256:'), 'staging receipt digest mismatch')
ReleaseSelection.require_value(artifact.fetch('workflow_run').fetch('id').to_s == ENV.fetch('GITHUB_RUN_ID'), 'staging receipt producer mismatch')
selection = JSON.parse(File.read('selection.json'))
images = JSON.parse(File.read('release/release.json')).fetch('images')
prisma_ref = JSON.parse(File.read('release/migrator/bundle/contract.json')).fetch('storage').fetch('storageHash')
ReleaseReceipt.validate(receipt, selection, images, run_id: ENV.fetch('GITHUB_RUN_ID'), attempt: ENV.fetch('GITHUB_RUN_ATTEMPT'), prisma_ref: prisma_ref)

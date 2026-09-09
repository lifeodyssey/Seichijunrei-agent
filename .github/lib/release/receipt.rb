# frozen_string_literal: true
require_relative 'selection'

module ReleaseReceipt
  UUID = /\A[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\z/
  module_function

  def validate(receipt, selection, images, run_id:, attempt:, prisma_ref:)
    ReleaseSelection.require_value(receipt.values_at('format', 'environment', 'smoke') == [1, 'staging', 'passed'], 'staging smoke evidence missing')
    ReleaseSelection.require_value(receipt.fetch('selection') == selection, 'staging tested a different selection or controller')
    ReleaseSelection.require_value(receipt.fetch('images') == images, 'staging image identity mismatch')
    ReleaseSelection.require_value(receipt.fetch('controller_run_id') == run_id, 'receipt belongs to another controller run')
    ReleaseSelection.require_value((1..Integer(attempt)).cover?(Integer(receipt.fetch('controller_run_attempt'))), 'receipt attempt mismatch')
    validate_schema(receipt.fetch('schema'), prisma_ref)
    validate_workers(receipt.fetch('workers'))
    true
  end

  def validate_schema(schema, prisma_ref)
    complete = schema['compatible'] == true && schema['pendingCount'] == 0 && schema['appliedHead'].is_a?(String)
    ReleaseSelection.require_value(complete && schema['appliedHead'] == schema['expectedHead'], 'staging schema was not fully applied')
    native = schema.fetch('prisma')
    applied = native.values_at('targetHash', 'markerHash', 'migrations', 'usedLiveMarker') == [prisma_ref, prisma_ref, [], true]
    ReleaseSelection.require_value(prisma_ref.match?(/\A[a-f0-9]{64}\z/) && applied, 'staging native schema was not fully applied')
  end

  def validate_workers(workers)
    ReleaseSelection.require_value(workers.map { |worker| worker['unit'] }.sort == %w[catalog edge migrator users web], 'incomplete Worker observations')
    workers.each do |worker|
      ReleaseSelection.require_value(worker.fetch('version_id').match?(UUID) && worker.fetch('deployment_id').match?(UUID), 'invalid observed platform identity')
      ReleaseSelection.require_value(worker.fetch('script_name').is_a?(String), 'missing script-scoped identity')
    end
  end
end

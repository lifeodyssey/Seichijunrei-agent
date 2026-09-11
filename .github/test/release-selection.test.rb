# SUT: artifact selection validates repository, original successful attempt and immutable digest.
# frozen_string_literal: true
require 'minitest/autorun'
require_relative '../lib/release/selection'

class ReleaseSelectionTest < Minitest::Test
  def setup
    @sha = 'b' * 40
    @artifact = artifact_metadata
    @run = run_metadata
    @workflow = { 'id' => 13, 'path' => '.github/workflows/release-build.yml' }
  end

  def artifact_metadata
    { 'id' => 7, 'name' => "release-snapshot-#{@sha}-1", 'expired' => false,
                  'expires_at' => '2026-09-10T00:00:00Z', 'digest' => "sha256:#{'d' * 64}",
                  'workflow_run' => { 'id' => 9, 'repository_id' => 11,
                    'head_repository_id' => 11, 'head_branch' => 'main', 'head_sha' => @sha } }
  end

  def run_metadata
    { 'id' => 9, 'workflow_id' => 13, 'run_attempt' => 1, 'event' => 'push',
             'status' => 'completed', 'conclusion' => 'success', 'head_branch' => 'main',
             'head_sha' => @sha, 'repository' => { 'id' => 11, 'full_name' => 'lifeodyssey/animichi' },
             'head_repository' => { 'id' => 11, 'full_name' => 'lifeodyssey/animichi' } }
  end

  def select
    Time.stub(:now, Time.utc(2026, 9, 9)) do
      ReleaseSelection.validate(@artifact, @run, @workflow, id: '7', repository_id: '11')
    end
  end

  def test_selects_existing_b_without_latest_head_input
    assert_equal @sha, select.fetch('source_sha')
    assert_equal '7', select.fetch('artifact_id')
    assert_equal @artifact['digest'], select.fetch('artifact_digest')
  end

  def test_rejects_expired_artifact
    @artifact['expired'] = true
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_expiry_during_production_approval
    @artifact['expires_at'] = '2000-01-01T00:00:00Z'
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_other_artifact_id
    @artifact['id'] = 8
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_cohort_artifact
    @artifact['name'] = "release-#{@sha}"
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_missing_digest
    @artifact.delete('digest')
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_malformed_digest
    @artifact['digest'] = 'sha256:latest'
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_wrong_repository
    @run['repository']['full_name'] = 'attacker/animichi'
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_fork_source
    @artifact['workflow_run']['head_repository_id'] = 12
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_wrong_run
    @run['id'] = 10
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_wrong_workflow
    @workflow['path'] = '.github/workflows/pr-verification.yml'
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_wrong_workflow_id
    @workflow['id'] = 14
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_branch_build
    @run['head_branch'] = 'feature'
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_failed_build
    @run['conclusion'] = 'failure'
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_running_build
    @run['status'] = 'in_progress'
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_dispatch_producer
    @run['event'] = 'workflow_dispatch'
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_changed_source
    @run['head_sha'] = 'c' * 40
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_artifact_source_binding
    @artifact['workflow_run']['head_sha'] = 'c' * 40
    assert_raises(ArgumentError) { select }
  end

  def test_rejects_changed_attempt
    @run['run_attempt'] = 2
    assert_raises(ArgumentError) { select }
  end
end

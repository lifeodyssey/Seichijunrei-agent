# frozen_string_literal: true

# One parsed GitHub Actions workflow, and the violation list its readers append
# to. Shared by `test_workflow_invariants.rb` (meta-invariants over every
# workflow), `test_ci_workflow_contract.rb` (the CI file's own shape), the
# per-lane contracts beside it and the three `test_cd_*_contract.rb`, so no one
# of them owns the others' YAML quirks.

require "yaml"

class WorkflowDocument
  # YAML 1.1 reads the bare word `on` as boolean true, which would erase every
  # trigger map; re-quote the key before parsing.
  def self.load(path)
    text = File.read(path).sub(/^on:(?=[ \t#]|$)/, '"on":')
    new(YAML.safe_load(text, permitted_classes: [], permitted_symbols: [], aliases: true))
  end

  def initialize(document)
    @document = document.is_a?(Hash) ? document : {}
  end

  def dig(*keys)
    @document.dig(*keys)
  end

  def [](key)
    @document[key]
  end

  def jobs
    @document["jobs"].is_a?(Hash) ? @document["jobs"] : {}
  end

  # The three legal `on:` shapes normalised to an event-name map.
  def triggers
    raw = @document.key?("on") ? @document["on"] : @document[true]
    case raw
    when Hash then raw
    when String then { raw => nil }
    when Array then raw.to_h { |event| [event, nil] }
    else {}
    end
  end

  def steps_of(job)
    dig("jobs", job, "steps") || []
  end
end

# Collects the failures a contract script found, so every violation is reported
# at once instead of aborting on the first.
class ViolationLog
  def initialize
    @violations = []
  end

  def unless_true(condition, message)
    @violations << message unless condition
  end

  def report(clean_message)
    return puts clean_message if @violations.empty?

    puts @violations
    exit 1
  end
end

def repository_root
  ARGV.fetch(0, `git rev-parse --show-toplevel`.strip)
end

# The names a `pulumi/esc-action` step asks its environment for. Shared because
# two contracts read the same list: the repository-wide rule that every opened
# name is checked for emptiness, and the CD boundary rule about which stage may
# open which name (#1367).
def esc_exported_names(step)
  step.dig("with", "export-environment-variables").to_s.split(",").map(&:strip).reject(&:empty?)
end

# The scripts a step's `for script in …; do pnpm --filter X run "$script"; done`
# loop runs, as an exact token list: a substring search for `test` would be
# satisfied by `test:integration` still being there. Shared because the affected
# matrix and the browser lane are read by two different contracts (#1364).
def looped_scripts(source)
  source[/^\s*for script in ([^;]+); do/, 1].to_s.split
end

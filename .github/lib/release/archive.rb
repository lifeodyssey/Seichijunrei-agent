# frozen_string_literal: true
require 'rubygems/package'
require 'set'

# The official action verifies the outer artifact. The inner tar preserves
# modes; restrict it to a separate release tree before native tar extracts it.
module ReleaseArchive
  module_function

  def validate(path)
    seen = Set.new
    File.open(path, 'rb') do |file|
      Gem::Package::TarReader.new(file) { |tar| tar.each { |entry| validate_entry(entry, seen) } }
    end
    raise ArgumentError, 'empty release archive' if seen.empty?
    true
  end

  def validate_entry(entry, seen)
    name = entry.full_name.delete_suffix('/')
    parts = name.split('/')
    safe = parts.first == 'release' && (parts & ['', '.', '..']).empty?
    raise ArgumentError, 'unsafe release archive path' unless safe && !name.include?("\0")
    raise ArgumentError, 'release archive links or extensions are forbidden' unless %w[0 5].include?(entry.header.typeflag)
    raise ArgumentError, 'duplicate release archive member' unless seen.add?(name)
  end
end

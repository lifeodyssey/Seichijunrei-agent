#!/usr/bin/env ruby
require "json"

File.open(ENV.fetch("CALL_LOG"), "a") { |file| file.puts(ARGV.join(" ")) }
case ARGV.join(" ")
when %r{/healthz}
  puts JSON.generate("bundleHead" => ENV.fetch("SEALED_HEAD"), "prismaTarget" => "b" * 64)
when %r{/migrate}
  File.write(ENV.fetch("POST_BODY"), ARGV.fetch(ARGV.index("-d") + 1))
  attempt = File.readlines(ENV.fetch("CALL_LOG")).count { |line| line.include?("/migrate") } - 1
  codes = ENV.fetch("MIGRATION_CODES", "200").split
  code = codes.fetch([attempt, codes.length - 1].min)
  body = JSON.generate("success" => true, "appliedHead" => ENV.fetch("SEALED_HEAD"), "prisma" => { "markerHash" => ENV.fetch("PRISMA_APPLIED", "b" * 64), "migrationsApplied" => 0 })
  body = ENV.fetch("MIGRATION_CONFLICT", '{"error":"stale_bundle"}') if code == "409"
  File.write(ARGV.fetch(ARGV.index("-o") + 1), body)
  print code
else
  puts JSON.generate("value" => "fixture-token")
end

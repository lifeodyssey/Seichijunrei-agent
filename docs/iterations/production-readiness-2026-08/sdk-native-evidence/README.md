# Native SDK probe evidence

Recorded 2026-09-09 for [the SDK review](../SDK-NATIVE-REWRITE-REVIEW.md) and
[the eval review](../EVAL-SDK-NATIVE-REVIEW.md). These are small, executable research probes using
public SDK interfaces, not a second eval runner or an application workspace.

| Evidence | Script | Actual retained output |
|---|---|---|
| Pi 0.85.1 Memory tree fork: entries/scalars preserved, lists absent, cross-repository fork rejected | [pi-fork-probe.mjs](pi-fork-probe.mjs) | [pi-fork-output.json](pi-fork-output.json) |
| Logfire 0.22.5 ESM: repeat/grouping, native assertions/attributes/analyses, task failures and rendering | [logfire-probe.mjs](logfire-probe.mjs) | [logfire-output.json](logfire-output.json) |
| Pi agent-core 0.85.1 and Agents 0.22.0 published tarball digests | [verify-integrity.mjs](verify-integrity.mjs) | [package-integrity.json](package-integrity.json) |

[verification.json](verification.json) records actual commands, exit status **0** for all three scripts,
script SHA-256 values and observed results from the portable-script check. That check reused the existing
exact-version installations and retained tarballs; it did not perform a new installation or network request.
Node **v26.8.1** and npm **11.19.0** were used. No model, provider, database or Worker was invoked.

[provenance.json](provenance.json) identifies the portability changes and original output hashes.
The complete original Pi JSON is retained. The complete original Logfire JSON has only two local path
prefixes replaced by `<workspace>` and `<probe-directory>` in expected failure stacks. Their line numbers
refer to the original compact script. Results, durations and synthetic IDs are unchanged. New executions
generate different IDs, timestamps, durations and stack locations; assertions check structural outcomes,
not elapsed-time thresholds. The deliberately false evaluator and thrown task are successful probe cases.

## Reproduce the probes

Run from the repository root. npm creates only a disposable installation outside the workspace; lifecycle
scripts are disabled. The probes themselves use only the public package roots and in-process synthetic data.

```sh
evidence_dir="$(pwd)/docs/iterations/production-readiness-2026-08/sdk-native-evidence"
probe_dir="$(mktemp -d)"
cp "$evidence_dir/pi-fork-probe.mjs" "$evidence_dir/logfire-probe.mjs" "$probe_dir/"
(
  set -e
  cd "$probe_dir"
  npm install --ignore-scripts --save-exact --no-audit --no-fund \
    @earendil-works/pi-agent-core@0.85.1 @earendil-works/pi-ai@0.85.1 \
    @earendil-works/chord@0.85.1 @earendil-works/pi-telemetry@0.85.1 logfire@0.22.5
  node pi-fork-probe.mjs > pi-fork-output.json
  node logfire-probe.mjs > logfire-output.json
)
```

Each probe exits **0** when its assertions pass and writes native results to the indicated JSON file;
an import or assertion failure exits nonzero. The install command is a fresh-checkout reproduction recipe,
not a claim that a fresh install was rerun during publication. [probe-dependencies.json](probe-dependencies.json)
records the original resolved Pi package versions and public package integrity metadata. All five top-level
versions above are exact; transitive dependencies are not frozen by this evidence bundle.

## Verify the published tarballs

Run from the repository root. This downloads the exact public archives into another disposable directory;
it does not install or execute their contents.

```sh
evidence_dir="$(pwd)/docs/iterations/production-readiness-2026-08/sdk-native-evidence"
integrity_dir="$(mktemp -d)"
curl --fail --location --proto '=https' --proto-redir '=https' \
  https://registry.npmjs.org/@earendil-works/pi-agent-core/-/pi-agent-core-0.85.1.tgz \
  --output "$integrity_dir/pi-agent-core-0.85.1.tgz"
curl --fail --location --proto '=https' --proto-redir '=https' \
  https://registry.npmjs.org/agents/-/agents-0.22.0.tgz \
  --output "$integrity_dir/agents-0.22.0.tgz"
node "$evidence_dir/verify-integrity.mjs" "$integrity_dir"
```

The verifier compares SHA-512 SRI and SHA-1 against the saved public npm metadata and prints the measured
digests and byte counts; mismatch exits nonzero. Both retained archives matched, and their package manifests
identified the expected names/versions. Metadata includes the public registry URLs and Pi's published
`gitHead`. This establishes which published bytes were inspected; signatures and attestations were not
verified. It does not establish Cloudflare compatibility, application conformance, production readiness or
completion of the rewrite. Those remain the implementation cards' gates.

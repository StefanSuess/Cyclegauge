#!/usr/bin/env bash
set -euo pipefail

bundle_dir=${1:?bundle directory required}
tools_dir=${2:?publisher tools directory required}
runtime_dir="$bundle_dir/publisher-runtime"
mkdir -p "$runtime_dir/scripts/release" "$runtime_dir/publisher-tools"
cp scripts/is-main.ts "$runtime_dir/scripts/is-main.ts"
# Complete transitive local import graph of publish-candidate.ts.
for file in channel.ts publish-candidate.ts promotion-policy.ts promotion-state.ts release-state.ts verify-vsix.ts zip.ts; do
  cp "scripts/release/$file" "$runtime_dir/scripts/release/$file"
done
cp -R "$tools_dir" "$runtime_dir/publisher-tools/node_modules"
tar -czf "$bundle_dir/publisher-runtime.tar.gz" -C "$runtime_dir" .
rm -rf "$runtime_dir"

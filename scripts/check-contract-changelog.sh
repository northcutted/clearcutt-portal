#!/usr/bin/env bash
# Fails when contract/'s schemas changed since the last release and the
# CHANGELOG doesn't say so. A schema change is what a fleet's next report can
# hold and what the pages can show, so a release must say what it brought:
# the "## Unreleased" section has to mention the contract (the word
# "contract" or "schema").
#
# Usage: scripts/check-contract-changelog.sh [BASE]
#   BASE is the tag or commit to compare with; default: the newest vX.Y.Z tag
#   reachable from HEAD. CI checks out the full history so the tags are there.
set -euo pipefail
cd "$(dirname "$0")/.."
base=${1:-$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' HEAD 2>/dev/null || true)}
if [ -z "$base" ]; then
  echo "no release tag to compare contract/ with; nothing to check"
  exit 0
fi
changed=$(git diff --name-only "$base" -- 'contract/*.schema.json')
if [ -z "$changed" ]; then
  echo "contract/ schemas unchanged since $base"
  exit 0
fi
unreleased=$(awk '/^## / { p = ($0 ~ /^## Unreleased/) } p' CHANGELOG.md)
if grep -qiE 'contract|schema' <<<"$unreleased"; then
  echo "contract/ schemas changed since $base, and CHANGELOG.md's Unreleased section says so:"
  echo "$changed" | sed 's/^/  /'
  exit 0
fi
{
  echo "contract/ schemas changed since $base:"
  echo "$changed" | sed 's/^/  /'
  echo "but CHANGELOG.md has no \"## Unreleased\" section mentioning the contract or a schema."
  echo "Say what the new contract adds (or changes) and what the pages now show of it."
} >&2
exit 1

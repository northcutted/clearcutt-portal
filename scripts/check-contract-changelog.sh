#!/usr/bin/env bash
# Fails when contract/'s schemas changed since the last release and the
# CHANGELOG doesn't say so. A schema change is what a fleet's next report can
# hold and what the pages can show, so a release must say what it brought:
# "## Unreleased" has to mention the contract ("contract" or "schema").
# During release preparation, notes under the new package version count too,
# provided package.json's version differs from the comparison release's.
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
# Release preparation moves Unreleased notes into "## vX.Y.Z" before the
# tag is published. Only that new package version's section can substitute
# for Unreleased: old or unrelated release notes cannot cover new changes.
read_version() {
  node -e '
    try {
      const v = JSON.parse(require("node:fs").readFileSync(0, "utf8")).version;
      if (typeof v === "string" && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.]+)?$/.test(v)) console.log(v);
    } catch {}
  '
}
version=$(read_version < package.json 2>/dev/null || true)
base_version=$(git show "$base:package.json" 2>/dev/null | read_version || true)
if [ -n "$version" ] && [ -n "$base_version" ] && [ "$version" != "$base_version" ]; then
  release=$(awk -v heading="v$version" '/^## / { p = ($2 == heading) } p' CHANGELOG.md)
  if grep -qiE 'contract|schema' <<<"$release"; then
    echo "contract/ schemas changed since $base, and CHANGELOG.md's v$version section says so:"
    echo "$changed" | sed 's/^/  /'
    exit 0
  fi
fi
{
  echo "contract/ schemas changed since $base:"
  echo "$changed" | sed 's/^/  /'
  echo "but CHANGELOG.md has no \"## Unreleased\" section (or matching new package version section) mentioning the contract or a schema."
  echo "Say what the new contract adds (or changes) and what the pages now show of it."
} >&2
exit 1

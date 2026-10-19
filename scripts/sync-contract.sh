#!/usr/bin/env bash
# Vendors clearcutt-verify's estate report contract (schemas, examples, and
# fixtures) into contract/, pinned to a commit, and regenerates the types the
# pages use from it. The portal builds only against this copy;
# contract/UPSTREAM records where it came from: the repository, the commit,
# and the newest clearcutt-verify release at or before that commit (the
# version the portal is built against: a report from a newer release gets a
# warning at build time).
#
# Usage:
#   scripts/sync-contract.sh [REF]
#       Vendor clearcutt-verify at REF (a commit, a tag such as v0.15.0, or a
#       branch such as main; default: the commit in contract/UPSTREAM), pin
#       the commit it names, and run scripts/gen-types.ts. Rerun it whenever
#       verify's contract moves.
#   scripts/sync-contract.sh --check
#       Fail if contract/ differs from upstream at the pinned commit. This is
#       deterministic, so PR CI runs it.
#   scripts/sync-contract.sh --check-upstream [REF]
#       Fail if contract/ differs from clearcutt-verify's latest release (or
#       from REF): the vendored copy is stale, or ahead of a release. This
#       depends on what upstream publishes, so only a scheduled job runs it.
set -euo pipefail
cd "$(dirname "$0")/.."
repo=https://github.com/northcutted/clearcutt-verify
mode=sync
ref=
case "${1:-}" in
  --check) mode=check ;;
  --check-upstream) mode=upstream; ref=${2:-} ;;
  -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
  -*) echo "unknown option $1 (see --help)" >&2; exit 2 ;;
  "") ;;
  *) ref=$1 ;;
esac

pinned=$(sed -n 's/^commit: //p' contract/UPSTREAM)
if [ "$mode" = upstream ] && [ -z "$ref" ]; then
  # The newest vX.Y.Z tag; pre-releases don't count.
  ref=$(git ls-remote --tags --refs "$repo" 'v*' | sed 's#.*refs/tags/##' |
    grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1)
  [ -n "$ref" ] || { echo "no release tags found in $repo" >&2; exit 1; }
fi
[ -n "$ref" ] || ref=$pinned
[ -n "$ref" ] || { echo "no ref given and no commit in contract/UPSTREAM" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q
git -C "$tmp" fetch -q --depth 1 "$repo" "$ref"
git -C "$tmp" checkout -q FETCH_HEAD
full=$(git -C "$tmp" rev-parse HEAD)
[ -d "$tmp/contract" ] || { echo "clearcutt-verify $ref ($full) has no contract/" >&2; exit 1; }

# The release: a vX.Y.Z tag on the commit itself, or else the newest one
# before it (which needs the commit's history, without its trees).
release=$(git ls-remote --tags --refs "$repo" 'v*' | sed 's#\^{}$##' |
  awk -v c="$full" '$1 == c { sub("refs/tags/", "", $2); print $2 }' |
  grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1 || true)
if [ -z "$release" ]; then
  git clone -q --bare --filter=tree:0 "$repo" "$tmp/history"
  release=$(git -C "$tmp/history" describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' "$full" 2>/dev/null || echo none)
  rm -rf "$tmp/history"
fi
printf 'repository: %s\ncommit: %s\nrelease: %s\n' "$repo" "$full" "$release" > "$tmp/contract/UPSTREAM"

case $mode in
  check)
    diff -r -x .DS_Store "$tmp/contract" contract && echo "contract/ matches $repo@$full"
    ;;
  upstream)
    # Compare content, not commits: a pin on a later commit whose contract
    # is the same as the release's is current.
    if diff -r -x UPSTREAM -x .DS_Store "$tmp/contract" contract >"$tmp/diff"; then
      echo "contract/ (pinned at $pinned) matches clearcutt-verify $ref ($full)"
    else
      cat "$tmp/diff"
      echo "contract/ (pinned at $pinned) differs from clearcutt-verify $ref ($full)." >&2
      echo "To move to it: scripts/sync-contract.sh $ref, then render and test the new fields." >&2
      exit 1
    fi
    ;;
  sync)
    rm -rf contract
    cp -R "$tmp/contract" contract
    echo "contract/ is now $repo@$full"
    node scripts/gen-types.ts
    echo "src/lib/contract.gen.ts regenerated; now run npm run check && npm test"
    ;;
esac

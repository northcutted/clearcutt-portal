#!/usr/bin/env bash
# Vendors clearcutt-verify's estate report contract (schemas, examples, and
# fixtures) into contract/, pinned to a commit. The portal builds only against
# this copy; contract/UPSTREAM records where it came from.
#
# Usage: scripts/sync-contract.sh [full-commit-sha]  (default: the commit in contract/UPSTREAM)
#        scripts/sync-contract.sh --check            (fail if contract/ differs from upstream at that commit)
set -euo pipefail
cd "$(dirname "$0")/.."
repo=https://github.com/northcutted/clearcutt-verify
check=false
commit=
case "${1:-}" in
  --check) check=true ;;
  "") ;;
  *) commit=$1 ;;
esac
if [ -z "$commit" ]; then
  commit=$(sed -n 's/^commit: //p' contract/UPSTREAM)
fi
[ -n "$commit" ] || { echo "no commit given and none in contract/UPSTREAM" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q
git -C "$tmp" fetch -q --depth 1 "$repo" "$commit"
git -C "$tmp" checkout -q FETCH_HEAD
full=$(git -C "$tmp" rev-parse HEAD)
printf 'repository: %s\ncommit: %s\n' "$repo" "$full" > "$tmp/contract/UPSTREAM"

if $check; then
  diff -r "$tmp/contract" contract && echo "contract/ matches $repo@$full"
  exit
fi
rm -rf contract
cp -R "$tmp/contract" contract
echo "contract/ is now $repo@$full"

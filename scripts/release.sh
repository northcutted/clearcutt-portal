#!/usr/bin/env bash
# Cuts a release: sets package.json's version, points any tag-pinned
# reference to this repository (and the version comment of a commit-pinned
# example) at VERSION, commits that, and tags it.
# Pushing the tag runs .github/workflows/release.yml, which tests, packages,
# signs, and publishes.
#
# Usage: scripts/release.sh vX.Y.Z   (then: git push origin main vX.Y.Z)
set -euo pipefail
version=${1:?usage: scripts/release.sh vX.Y.Z}
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "not a version: $version" >&2; exit 1; }
cd "$(dirname "$0")/.."
grep -q "^## $version" CHANGELOG.md || { echo "CHANGELOG.md has no '## $version' section" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree is not clean" >&2; exit 1; }

npm version --no-git-tag-version --allow-same-version "${version#v}" >/dev/null
# Every tag-pinned reference to this repository, and the "# vX.Y.Z" of a
# commit-pinned one in the docs (whose commit is the tag's, known only
# after this commit).
perl -pi -e 's#(northcutted/clearcutt-portal(?:/\.github/workflows/[a-z-]+\.yml)?)\@v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?#$1\@'"$version"'#g;
  s#(northcutted/clearcutt-portal(?:/\.github/workflows/[a-z-]+\.yml)?\@<[^>]+> \# )v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?#$1'"$version"'#g;
  s#(clearcutt-portal \x27refs/tags/)v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?(\^\{\}\x27)#$1'"$version"'$3#g' \
  .github/workflows/*.yml action.yml README.md docs/*.md

npm test >/dev/null
git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "Release $version"
fi
git tag -a "$version" -m "$version"
echo "tagged $version; push with: git push origin main $version"

#!/usr/bin/env bash
# Pulls a clearcutt-verify bundle stored as an OCI artifact (what
# `clearcutt-verify estate push` writes) and verifies its cosign signature
# before anything reads it. Fails closed: without a signer to check against,
# with a signature that doesn't verify, or with an artifact that isn't an
# estate bundle, it stops, and writes nothing.
#
# Usage: scripts/pull-bundle.sh REF OUT
#   REF  the bundle: registry/repository:tag or registry/repository@sha256:…
#        A tag is resolved to its digest first; everything after uses only
#        the digest, so the bundle checked is the bundle read.
#   OUT  the directory to write estate-report.json (and estate-history.json,
#        when the bundle has one) to.
#
# Environment (the names mirror cosign's flags, and clearcutt-verify's
# `estate pull`):
#   CERTIFICATE_IDENTITY_REGEXP  who must have signed the bundle, anchored
#                                (^…$), e.g.
#                                ^https://github\.com/acme/estate/\.github/workflows/estate\.yml@refs/heads/main$
#   CERTIFICATE_OIDC_ISSUER      the signer's OIDC issuer, e.g.
#                                https://token.actions.githubusercontent.com
#   REGISTRY_USERNAME, REGISTRY_PASSWORD
#                                optional: log in to REF's registry first
#                                (otherwise the docker config, or anonymous).
#   GITHUB_OUTPUT                when set, digest=sha256:… is written to it.
#
# Needs cosign and oras on PATH, and node (to read the manifest).
set -euo pipefail

fail() {
  echo "::error title=Estate bundle not used::$*" >&2
  exit 1
}

ref=${1:-}
out=${2:-}
[ -n "$ref" ] && [ -n "$out" ] || { echo "usage: scripts/pull-bundle.sh REF OUT" >&2; exit 2; }
identity=${CERTIFICATE_IDENTITY_REGEXP:-}
issuer=${CERTIFICATE_OIDC_ISSUER:-}

# Who must have signed it. An unanchored expression matches any identity
# that contains it (https://github.com/evil/x?https://github.com/acme/...),
# so it must say where it starts and ends.
[ -n "$identity" ] || fail "no certificate-identity-regexp: a bundle is read only once its signature verifies against a signer"
[ -n "$issuer" ] || fail "no certificate-oidc-issuer: a bundle is read only once its signature verifies against a signer"
[[ "$identity" == ^* && "$identity" == *\$ ]] || fail "certificate-identity-regexp must be anchored with ^ and \$, or it matches any identity that contains it: $identity"
[[ "$issuer" =~ ^https://[^[:space:]]+$ ]] || fail "certificate-oidc-issuer must be an https URL: $issuer"
[[ "$ref" =~ ^[A-Za-z0-9._:/@-]+$ ]] || fail "not an OCI reference: $ref"

# repository, and the digest to read: the one REF names, or its tag's now.
if [[ "$ref" == *@* ]]; then
  repo=${ref%@*}
  digest=${ref##*@}
else
  repo=$ref
  digest=
fi
# Drop a tag (a colon in the last path segment; one before it is a port).
last=${repo##*/}
if [[ "$last" == *:* ]]; then repo=${repo%:*}; fi
[[ "$repo" == */* ]] || fail "not a registry/repository reference: $ref"
registry=${repo%%/*}

if [ -n "${REGISTRY_USERNAME:-}" ] || [ -n "${REGISTRY_PASSWORD:-}" ]; then
  [ -n "${REGISTRY_USERNAME:-}" ] && [ -n "${REGISTRY_PASSWORD:-}" ] || fail "registry-username and registry-password go together"
  printf '%s' "$REGISTRY_PASSWORD" | oras login --username "$REGISTRY_USERNAME" --password-stdin "$registry" >/dev/null
fi

if [ -z "$digest" ]; then
  digest=$(oras resolve "$ref") || fail "couldn't resolve $ref"
fi
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "not a sha256 digest: $digest"
pinned="$repo@$digest"

# The signature, before anything of the bundle is read.
if ! cosign verify --certificate-identity-regexp "$identity" --certificate-oidc-issuer "$issuer" "$pinned" >/dev/null; then
  fail "$pinned has no signature from an identity matching $identity (issuer $issuer)"
fi
echo "$pinned: signature verified (identity matching $identity, issuer $issuer)"

# An estate bundle, not some other signed artifact.
manifest=$(oras manifest fetch "$pinned") || fail "couldn't fetch the manifest of $pinned"
media=$(printf '%s' "$manifest" | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).config?.mediaType??""))}catch{}})')
[ "$media" = application/vnd.clearcutt.estate.v1+json ] ||
  fail "$pinned is not a ClearCutt estate bundle: its config media type is \"$media\", not application/vnd.clearcutt.estate.v1+json"

# oras checks each file against its digest in the manifest, and refuses a
# file name that would land outside the directory.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
oras pull --output "$tmp" "$pinned" >/dev/null || fail "couldn't pull $pinned"
[ -f "$tmp/estate-report.json" ] && [ ! -L "$tmp/estate-report.json" ] || fail "$pinned has no estate-report.json"
mkdir -p "$out"
cp "$tmp/estate-report.json" "$out/estate-report.json"
if [ -f "$tmp/estate-history.json" ] && [ ! -L "$tmp/estate-history.json" ]; then
  cp "$tmp/estate-history.json" "$out/estate-history.json"
fi
echo "$pinned: bundle written to $out"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "digest=$digest" >> "$GITHUB_OUTPUT"; fi

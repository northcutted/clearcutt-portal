# Publishing a fleet's portal

This guide takes a repository that runs clearcutt-verify to a portal on
GitHub Pages that updates with every run.

## 1. Produce a bundle

clearcutt-verify writes a **bundle**: a directory with `estate-report.json`
and, when it is given earlier runs, `estate-history.json`. For example:

```sh
clearcutt-verify estate verify --refs refs.txt --policy policy.yaml --name acme-images --out estate
```

See clearcutt-verify's [contract](https://github.com/northcutted/clearcutt-verify/tree/main/contract)
for what the files hold. The portal shows history only when the bundle has
it; carrying history from run to run is clearcutt-verify's job.

Check a bundle without building anything:

```sh
node bin/clearcutt-portal.ts check --bundle estate
```

## 2. Turn on Pages

In the repository settings, **Pages → Build and deployment → Source: GitHub
Actions**.

## 3. Call the reusable workflow

Push the bundle to a registry and sign it in the job that ran
clearcutt-verify, then call `portal.yml` with the bundle's reference and who
must have signed it:

```yaml
name: estate
on:
  schedule: [{cron: "0 6 * * *"}]
  workflow_dispatch:
permissions: {}
jobs:
  verify:
    runs-on: ubuntu-latest
    permissions: {contents: read, packages: write, id-token: write}
    steps:
      # ...install and run clearcutt-verify estate verify, writing estate/ ...
      # clearcutt-verify estate push ghcr.io/acme/estate:latest --dir estate ... prints the digest;
      # cosign sign --yes ghcr.io/acme/estate@<that digest>
  portal:
    needs: verify
    # Pinned by commit, like every other action; the comment is for you and Dependabot.
    uses: northcutted/clearcutt-portal/.github/workflows/portal.yml@<commit of the release tag> # v0.1.0
    permissions: {contents: read, pages: write, id-token: write}
    with:
      bundle-ref: ghcr.io/acme/estate:latest
      certificate-identity-regexp: ^https://github\.com/acme/estate/\.github/workflows/estate\.yml@refs/heads/main$
      certificate-oidc-issuer: https://token.actions.githubusercontent.com
```

The workflow resolves the tag to a digest, checks the digest's cosign
signature against `certificate-identity-regexp` and `certificate-oidc-issuer`,
checks that it is an estate bundle (its config media type is
`application/vnd.clearcutt.estate.v1+json`), and only then pulls that digest's
`estate-report.json` and `estate-history.json`. If any of that fails, or the
signer inputs are missing, the build fails and the deployed site stays as it
was. The identity expression must be anchored with `^` and `$`: unanchored,
it would match any identity that contains it. The inputs are named after
cosign's flags, as clearcutt-verify's `estate pull` names its own.

A bundle in a private package needs a login: `registry-username` and the
`registry-password` secret (for ghcr.io, a token with `packages: read`; the
workflow can't be given the caller's permissions without every caller
granting them).

Instead of `bundle-ref`, `bundle-artifact` names an artifact of the same run
that holds the bundle (an `actions/upload-artifact` of clearcutt-verify's
output directory). It isn't signed: the artifact is only as trustworthy as
the run that uploaded it.

| Input | Default | What it does |
|---|---|---|
| `bundle-ref` | none | The bundle as an OCI artifact (`registry/repository:tag`, or `@sha256:…`), verified before it is read; this or `bundle-artifact` |
| `certificate-identity-regexp` | none; required with `bundle-ref` | Who must have signed it, anchored (cosign's `--certificate-identity-regexp`) |
| `certificate-oidc-issuer` | none; required with `bundle-ref` | The signer's OIDC issuer (cosign's `--certificate-oidc-issuer`) |
| `registry-username` | none | With the `registry-password` secret, log in to the bundle's registry |
| `bundle-artifact` | none | Name of an artifact of this run holding the bundle; this or `bundle-ref` |
| `bundle-path` | `.` | Directory of the bundle inside the artifact |
| `title` | the estate's name | Site title |
| `history-runs` | `50` | How many of the latest runs the history, comparison, and image pages show; `0` shows all |
| `scan-age-days` | the policy's `maxScanAgeDays`, or 7 | Flag scans older than this on the overview |
| `deploy` | `true` | Deploy to Pages; `false` uploads the site as the artifact `clearcutt-portal-site` instead (the caller still grants `pages: write` and `id-token: write`, which GitHub checks for every job; to avoid that, use the action) |
| `portal-version` | none | **Deprecated**; remove it. The workflow builds the version it is called at. Given, it is still used, with a warning |

The workflow builds the clearcutt-portal it is called at: pinned to a
release's commit or tag, that release's signed archive (verified against this
repository's `release.yml` at the tag); at any other commit or branch, that
commit's source. `git ls-remote https://github.com/northcutted/clearcutt-portal 'refs/tags/v0.1.0^{}'`
prints a release's commit. Callers that still pass `portal-version` keep
working and get a warning saying so; remove it when you next update the pin.

Outputs: `page-url` (the deployed site), `portal-version` (what built it), and
`bundle-digest` (with `bundle-ref`, the digest that was verified and built).
The site is served under the repository's Pages path (`/<repo>/` for a project
site), which the workflow reads from the Pages configuration. Deploys run one
at a time (the concurrency group `clearcutt-portal-pages-deploy`), the newest
waiting for the one before.

A bundle that doesn't match the contract fails the build job and leaves the
previously deployed site in place.

## Building in your own job

The action verifies and pulls a signed bundle (or reads a directory),
installs a release after verifying its signature, and builds:

```yaml
- uses: northcutted/clearcutt-portal@<commit of the release tag> # v0.1.0
  id: portal
  with:
    bundle-ref: ghcr.io/acme/estate:latest
    certificate-identity-regexp: ^https://github\.com/acme/estate/\.github/workflows/estate\.yml@refs/heads/main$
    certificate-oidc-issuer: https://token.actions.githubusercontent.com
    base-path: /images-portal   # where the site will be served
- run: rsync -a "${{ steps.portal.outputs.dir }}/" ./public/
```

| Input | Default | What it does |
|---|---|---|
| `bundle` | none | The bundle directory; this or `bundle-ref` |
| `bundle-ref` | none | The bundle as a signed OCI artifact, verified before it is read; this or `bundle` |
| `certificate-identity-regexp`, `certificate-oidc-issuer` | none; required with `bundle-ref` | Who must have signed it |
| `registry-username`, `registry-password` | none | Log in to the bundle's registry; otherwise the docker config of an earlier login is used, or none |
| `output` | `_site` | Where to write the site: a new or empty directory, or a site an earlier build wrote, which it replaces |
| `base-path` | `/` | Path the site is served under |
| `site-url` | none | Origin the site is served from, for absolute URLs |
| `title` | the estate's name | Site title |
| `history-runs` | `50` | Runs the history, comparison, and image pages show; `0` shows all |
| `scan-age-days` | the policy's `maxScanAgeDays`, or 7 | Flag scans older than this on the overview |
| `version` | the release the action was used at | Rarely needed: a release (`vX.Y.Z`), or `source` to build from the action's own source; any other value builds from source too |

Outputs: `dir` (the site), `version`, and `bundle-digest`.

At a release tag, or the commit a release tag names, the action downloads
`clearcutt-portal-<tag>.tar.gz` and its Sigstore bundle from the release, and
checks that the archive was signed by this repository's `release.yml` at that
tag. It then installs the archive's locked dependencies with
`npm ci --ignore-scripts --omit=dev`, so every package is pinned by its
integrity hash and no install script runs. At any other ref it builds from the
action's own source.

## Building elsewhere

The release archive is all you need, with Node 22.18 or newer:

```sh
v=v0.1.0 asset=clearcutt-portal-$v.tar.gz
curl -fsSLO https://github.com/northcutted/clearcutt-portal/releases/download/$v/$asset
curl -fsSLO https://github.com/northcutted/clearcutt-portal/releases/download/$v/$asset.sigstore.json
cosign verify-blob --bundle $asset.sigstore.json \
  --certificate-identity https://github.com/northcutted/clearcutt-portal/.github/workflows/release.yml@refs/tags/$v \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com $asset
tar -xzf $asset && cd clearcutt-portal-$v
npm ci --ignore-scripts --omit=dev
node bin/clearcutt-portal.ts build --bundle ../estate --out ../site --base /
```

The output is plain files; any static host serves it.

## Running clearcutt-verify in the same workflow

`portal.yml` takes clearcutt-verify's output today. Running clearcutt-verify
inside it needs a signature-verified way to install clearcutt-verify in CI,
tracked in [northcutted/clearcutt-verify#52](https://github.com/northcutted/clearcutt-verify/issues/52);
the workflow will gain that mode when it exists.

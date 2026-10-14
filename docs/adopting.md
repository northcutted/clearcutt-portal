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

Upload the bundle as an artifact, then call `portal.yml` pinned to a release:

```yaml
name: estate
on:
  schedule: [{cron: "0 6 * * *"}]
  workflow_dispatch:
permissions: {}
jobs:
  verify:
    runs-on: ubuntu-latest
    permissions: {contents: read, packages: read}
    steps:
      # ...install and run clearcutt-verify, writing estate/ ...
      - uses: actions/upload-artifact@v7
        with:
          name: estate-bundle
          path: estate/
  portal:
    needs: verify
    uses: northcutted/clearcutt-portal/.github/workflows/portal.yml@v0.1.0
    permissions: {contents: read, pages: write, id-token: write}
    with:
      bundle-artifact: estate-bundle
```

| Input | Default | What it does |
|---|---|---|
| `bundle-artifact` | (required) | Name of the artifact holding the bundle |
| `bundle-path` | `.` | Directory of the bundle inside the artifact |
| `title` | the estate's name | Site title |
| `deploy` | `true` | Deploy to Pages; `false` uploads the site as the artifact `clearcutt-portal-site` instead (the caller still grants `pages: write` and `id-token: write`, which GitHub checks for every job; to avoid that, use the action) |
| `portal-version` | the workflow's own release | A release tag (signature-verified), or a commit to build from source |

The workflow's output `page-url` is the deployed site's address. The site is
served under the repository's Pages path (`/<repo>/` for a project site),
which the workflow reads from the Pages configuration.

A bundle that doesn't match the contract fails the build job and leaves the
previously deployed site in place.

## Building in your own job

The action installs a release, verifies its signature, and builds:

```yaml
- uses: northcutted/clearcutt-portal@v0.1.0
  id: portal
  with:
    bundle: estate
    base-path: /images-portal   # where the site will be served
- run: rsync -a "${{ steps.portal.outputs.dir }}/" ./public/
```

| Input | Default | What it does |
|---|---|---|
| `bundle` | (required) | The bundle directory |
| `output` | `_site` | Where to write the site: a new or empty directory, or a site an earlier build wrote, which it replaces |
| `base-path` | `/` | Path the site is served under |
| `site-url` | none | Origin the site is served from, for absolute URLs |
| `title` | the estate's name | Site title |
| `version` | the tag the action was used at | A release, or `source` to build from the action's own source |

At a release tag the action downloads `clearcutt-portal-<tag>.tar.gz` and its
Sigstore bundle from the release, and checks that the archive was signed by
this repository's `release.yml` at that tag. It then installs the archive's
locked dependencies with `npm ci --ignore-scripts`, so every package is pinned
by its integrity hash and no install script runs. At any other ref it builds
from the action's own source.

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
npm ci --ignore-scripts
node bin/clearcutt-portal.ts build --bundle ../estate --out ../site --base /
```

The output is plain files; any static host serves it.

## Running clearcutt-verify in the same workflow

`portal.yml` takes clearcutt-verify's output today. Running clearcutt-verify
inside it needs a signature-verified way to install clearcutt-verify in CI,
tracked in [northcutted/clearcutt-verify#52](https://github.com/northcutted/clearcutt-verify/issues/52);
the workflow will gain that mode when it exists.

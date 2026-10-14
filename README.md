# ClearCutt Portal

`clearcutt-portal` turns what [clearcutt-verify](https://github.com/northcutted/clearcutt-verify)
found and proved about an image estate into a static website: which images are
verified and why the rest aren't, what each one is built on and how that is
known, every piece of evidence and whether it checked out, vulnerabilities,
reproducibility, which images ship a package, and how all of it changed from
run to run.

**Demo:** [northcutted.github.io/clearcutt-portal](https://northcutted.github.io/clearcutt-portal/),
built from a real run over the [clearcutt-factory](https://github.com/northcutted/clearcutt-factory)
example fleet (`ghcr.io/northcutted/images`) and its Chainguard and Docker Hub bases.

It is part of ClearCutt, a family of tools for the OCI images you run:
[clearcutt-factory](https://github.com/northcutted/clearcutt-factory) builds
them, clearcutt-verify checks them, and this repository shows the result.

```
clearcutt-verify estate verify ──▶ bundle ──▶ clearcutt-portal build ──▶ static site ──▶ GitHub Pages
                                   (estate-report.json, estate-history.json)
```

## What it shows

| Page | What it answers |
|---|---|
| Overview | How many images are verified, failed, or unverified; the reasons for each one that isn't; stale bases; evidence and vulnerabilities across the estate; the policy they were held to |
| Image | Its base and how it is known, every piece of evidence with its signer and status, vulnerabilities and the day they describe, tests, whether a rebuild reproduced it, its rebase, platforms, and packages |
| Bases | Which images are built on which, how each relationship is known, and how far behind each image is |
| Packages | Which images ship a package, and which images that can't be answered for |
| History | Verdicts and headline numbers from run to run |
| About | What every status means, the policy, and where the data came from |

The site never claims more than the report does. **Proven** means checked: a
signature verified against a signer the policy trusts, or a base established
by comparing layer digests. **Claimed** means someone wrote it down: a label,
an annotation, or evidence nobody could check. **Unknown** means the run
couldn't find out, and it is never shown as zero, absent, or a pass. Each
status carries a glyph as well as a color, and every page links the raw
`estate-report.json` it was built from.

## Publishing a fleet's portal

In a GitHub repository whose Pages source is "GitHub Actions", run
clearcutt-verify in one job and hand its output to the reusable workflow:

```yaml
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      # ...run clearcutt-verify estate verify --out estate ...
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

[docs/adopting.md](docs/adopting.md) covers the workflow's inputs, building
with the action in your own job, other hosts, and building locally.

## Building one

From a clone, with Node 22.18 or newer:

```sh
npm ci --ignore-scripts
node bin/clearcutt-portal.ts build --bundle path/to/bundle --out _site [--base /path] [--site https://host] [--title "…"]
node bin/clearcutt-portal.ts check --bundle path/to/bundle    # validate only
```

The build reads the bundle and nothing else: it contacts no registry, and the
site it writes loads nothing from another origin. A bundle that doesn't match
the contract stops the build (exit 1) with the fields that are wrong.

The site replaces `--out`, so `--out` must be new, empty, or a site an earlier
build wrote (each has a `.clearcutt-portal-site` file), and can't be the
bundle, inside it, or around it.

Much of a report is written by whoever built an image, so the site treats it
as untrusted: every page carries a Content-Security-Policy that runs only the
site's own scripts and styles, report text is always escaped, and a value from
the report (an image's source URL) becomes a link only when it is an http or
https URL.

## The data contract

The bundle format belongs to clearcutt-verify: `apiVersion: clearcutt.dev/v1`,
described by JSON Schemas in its [`contract/`](https://github.com/northcutted/clearcutt-verify/tree/main/contract).
This repository builds only against a copy of that directory, pinned to a
commit in [`contract/UPSTREAM`](contract/UPSTREAM); CI checks the copy still
matches. The TypeScript types the pages use are generated from those schemas.
A weekly job ([`contract-upstream.yml`](.github/workflows/contract-upstream.yml))
fails when the copy differs from clearcutt-verify's latest release, without
ever gating a pull request.

When reading a bundle, the portal:

- refuses any `apiVersion` other than `clearcutt.dev/v1`;
- validates both files against the schemas, ignoring fields it doesn't know,
  since v1 only grows by adding optional fields;
- refuses a report whose image IDs repeat or can't name a page (each must be
  one path segment of letters, digits, `.`, `_`, and `-`), or whose bases and
  packages name images that aren't in it;
- shows enum values it doesn't know as they are, marked unknown.

Changes to the contract are proposed as issues on
[clearcutt-verify](https://github.com/northcutted/clearcutt-verify/issues).

## Versions

Releases are signed: each is the `git archive` of its tag, signed keylessly by
[`release.yml`](.github/workflows/release.yml) with SLSA provenance, and the
action verifies that signature before building. See [CHANGELOG.md](CHANGELOG.md).

## Development

```sh
npm ci --ignore-scripts
npm run dev          # the site, from contract/fixtures/northcutted-images
npm test             # unit tests, and real builds of the vendored bundles
npm run check        # types, and that src/lib/contract.gen.ts matches the schemas
scripts/sync-contract.sh main     # move to verify's newest contract (or a tag/commit); regenerates types
scripts/sync-contract.sh --check-upstream   # does contract/ match verify's latest release?
scripts/release.sh v0.2.0   # after adding a CHANGELOG section: re-pin refs, commit, tag
```

Set `CLEARCUTT_PORTAL_BUNDLE=path/to/bundle` to run `npm run dev` against
another bundle.

## License

Apache-2.0; see [LICENSE](LICENSE).

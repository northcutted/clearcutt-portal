# ClearCutt Portal

`clearcutt-portal` turns what [clearcutt-verify](https://github.com/northcutted/clearcutt-verify)
found and proved about an image estate into a static website: which images are
verified and why the rest aren't, what each one is built on and how that is
known, every piece of evidence and whether it checked out, vulnerabilities,
reproducibility, which images ship a package (at which versions, and which
inherit it from their base), how all of it changed from run to run, and the
commands to check any of it yourself.

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
| Overview | Whether the policy passes and what is still outstanding either way (critical and high findings, stale bases, rebuilds that didn't reproduce, missing or old vulnerability data); headline numbers, each a link to the images it counts; why images aren't verified, one card per reason with every image it holds back; the findings to fix first; stale bases; every image in a table that sorts by any column; evidence and vulnerabilities across the estate; the policy they were held to |
| Lists | The images behind each headline number (failed, unverified, on a stale base, with no vulnerability data, with scans older than a limit, not reproduced, …), one page each, with the same sortable table |
| Findings | Every vulnerability advisory in the estate in the order to fix it (fixable critical and high first), and a page per advisory: the images that have it, in which package and version, what fixes it, where a VEX statement covers it, and where it is unknown; CVE, GHSA, Go, PyPI, and RustSec IDs link to their canonical advisory pages |
| Image | Its base and how it is known, every piece of evidence with its signer and status, vulnerabilities (fix first, each linked to its advisory) and the day they describe, tests, whether a rebuild reproduced it and what checked that (this run, or an attested reproduction and where it ran), its stack, its rebases, platforms, packages and where they were read from, the image run by run, and copy-paste commands (cosign, gh, clearcutt-factory, clearcutt-verify) that check what the page says without trusting it |
| Bases | Which images are built on which, how each relationship is known, and how far behind each image is |
| Stacks | The clearcutt-factory stacks the apps are built on, who signed each version, and which apps are on an older one (shown when the estate has apps on stacks) |
| Packages | Who ships a version: a search like `libxml2 <2.14` or `openssl >=3.0,<3.0.15`, in each ecosystem's version order, answered with the images that ship it and the images that inherit it from their base; and which images can't be answered for |
| History | Verdicts and headline numbers from run to run; two runs side by side, image by image: digest, base, verdict, findings, and packages before and after, the fixable high and critical findings fixed and introduced by ID, and whether each image was rebased, rebuilt, or left while its base moved |
| About | What every status means, the policy, and where the data came from |

The site never claims more than the report does. **Proven** means checked: a
signature verified against a signer the policy trusts, or a base established
by comparing layer digests. **Claimed** means someone wrote it down: a label,
an annotation, or evidence nobody could check. **Unknown** means the run
couldn't find out, and it is never shown as zero, absent, or a pass. Each
status carries a glyph as well as a color, and every page links the raw
`estate-report.json` it was built from.

## Publishing a fleet's portal

In a GitHub repository whose Pages source is "GitHub Actions", call the
reusable workflow with the bundle clearcutt-verify pushed and signed
(`clearcutt-verify estate push`, then `cosign sign`), and who must have
signed it. The workflow verifies the signature before it reads anything, and
fails when it doesn't verify:

```yaml
jobs:
  portal:
    needs: verify   # the job that ran estate verify, estate push, and cosign sign
    # Pin by commit, like every other action; the comment is for you and Dependabot.
    uses: northcutted/clearcutt-portal/.github/workflows/portal.yml@<commit of the release tag> # v0.2.0
    permissions: {contents: read, pages: write, id-token: write}
    with:
      bundle-ref: ghcr.io/acme/estate:latest
      certificate-identity-regexp: ^https://github\.com/acme/estate/\.github/workflows/estate\.yml@refs/heads/main$
      certificate-oidc-issuer: https://token.actions.githubusercontent.com
```

`git ls-remote https://github.com/northcutted/clearcutt-portal 'refs/tags/v0.2.0^{}'`
prints the commit to pin. The workflow builds the version it is called at:
pinned to a release's commit (or tag), it verifies and builds that release's
signed archive. An artifact of the same run (`bundle-artifact`) works too.
[docs/adopting.md](docs/adopting.md) covers the workflow's inputs, building
with the action in your own job, other hosts, and building locally.

## Building one

From a clone, with Node 22.18 or newer:

```sh
npm ci --ignore-scripts
node bin/clearcutt-portal.ts build --bundle path/to/bundle --out _site [--base /path] [--site https://host] [--title "…"] \
  [--scan-age-days N] [--history-runs N]
node bin/clearcutt-portal.ts check --bundle path/to/bundle    # validate only
```

`--scan-age-days` sets the age past which the overview flags a vulnerability
scan as old (default: the policy's `maxScanAgeDays`, or 7 days without one).
`--history-runs` sets how many of the latest runs the history, comparison, and
image pages show (default 50; `0` shows every run). clearcutt-verify doesn't
trim the history, and a site that showed all of it would grow with every run
(a page per comparison, each listing every run); the pages say how many older
runs they leave out, and `estate-history.json` on the site has every one.

The build reads the bundle and nothing else: it contacts no registry, and the
site it writes loads nothing from another origin. A bundle that doesn't match
the contract stops the build (exit 1) with the fields that are wrong.

The site replaces `--out`, so `--out` must be new, empty, or a site an earlier
build wrote (each has a `.clearcutt-portal-site` file), and can't be the
bundle, inside it, or around it.

Much of a report is written by whoever built an image, so the site treats it
as untrusted: every page carries a Content-Security-Policy that runs only the
site's own scripts and styles (every script is a file of the site, and may
fetch only the site's own files), report text is always escaped, a value from
the report (an image's source URL) becomes a link only when it is an http or
https URL, and a value in a copy-paste command is shell-quoted, or the command
isn't shown.

[docs/checking-searching-comparing.md](docs/checking-searching-comparing.md)
describes the commands, the package search's syntax and version ordering, and
how runs are compared.

## The data contract

The bundle format belongs to clearcutt-verify: `apiVersion: clearcutt.dev/v1`,
described by JSON Schemas in its [`contract/`](https://github.com/northcutted/clearcutt-verify/tree/main/contract).
This repository builds only against a copy of that directory, pinned to a
commit in [`contract/UPSTREAM`](contract/UPSTREAM), which also records the
clearcutt-verify release that commit is (or the newest one before it); CI
checks the copy still matches. The TypeScript types the pages use are
generated from those schemas. CI also fails when a schema changed since the
portal's last release and `CHANGELOG.md`'s Unreleased section doesn't mention
the contract ([`scripts/check-contract-changelog.sh`](scripts/check-contract-changelog.sh)).
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
- shows enum values it doesn't know as they are, marked unknown;
- warns, and says so in every page's footer and on the About page, when the
  report or history has fields the vendored schemas don't define (naming
  them, like `images[].evidence.signature.newField`), or was written by a
  clearcutt-verify release newer than the contract's. The build doesn't fail:
  the pages show what the portal knows and the raw files keep everything. The
  warnings go to stderr, and in GitHub Actions also to annotations.

### Checking clearcutt-verify's output against a released portal

clearcutt-verify's CI can check that a released portal still reads what it
writes, before a release ships: build the site from a fresh bundle (and from
the previous release's fixtures) with the action, pinned by commit. The build
fails (exit 1) on anything the contract the release was built against
rejects, and prints a warning annotation for each field it doesn't know:

```yaml
- run: clearcutt-verify estate verify --refs refs.txt --policy policy.yaml --name ci --out "$RUNNER_TEMP/estate"
- uses: northcutted/clearcutt-portal@<commit of a release tag> # vX.Y.Z
  with:
    bundle: ${{ runner.temp }}/estate
    output: ${{ runner.temp }}/portal-site
```

Without the action, the release archive does the same with Node 22.18 or
newer (`check` validates without building; `build` also renders every page):

```sh
v=vX.Y.Z asset=clearcutt-portal-$v.tar.gz
curl -fsSLO https://github.com/northcutted/clearcutt-portal/releases/download/$v/$asset
curl -fsSLO https://github.com/northcutted/clearcutt-portal/releases/download/$v/$asset.sigstore.json
cosign verify-blob --bundle $asset.sigstore.json \
  --certificate-identity https://github.com/northcutted/clearcutt-portal/.github/workflows/release.yml@refs/tags/$v \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com $asset
tar -xzf $asset && cd clearcutt-portal-$v && npm ci --ignore-scripts --omit=dev
node bin/clearcutt-portal.ts check --bundle ../estate
node bin/clearcutt-portal.ts build --bundle ../estate --out ../portal-site
```

Changes to the contract are proposed as issues on
[clearcutt-verify](https://github.com/northcutted/clearcutt-verify/issues).

## Versions

Releases are signed: each is the `git archive` of its tag, signed keylessly by
[`release.yml`](.github/workflows/release.yml) with SLSA provenance, and the
action verifies that signature before building. Pin the action and the
reusable workflow by the release's commit, as you pin any other action; at a
commit a release tag names they still build the signed release. See
[CHANGELOG.md](CHANGELOG.md).

## Development

```sh
npm ci --ignore-scripts
npm run dev          # the site, from contract/fixtures/northcutted-images
npm test             # unit tests, and real builds of the vendored bundles
npx playwright install chromium   # once, for the browser tests
npx playwright test  # the scripts in a browser, and an axe pass over the pages in both themes
CLEARCUTT_PORTAL_SCALE=1 node --test test/scale.test.ts   # 500 images, 1,000 runs, within a time budget
npm run check        # types, and that src/lib/contract.gen.ts matches the schemas
scripts/sync-contract.sh main     # move to verify's newest contract (or a tag/commit); regenerates types
scripts/sync-contract.sh --check-upstream   # does contract/ match verify's latest release?
scripts/release.sh v0.2.0   # after adding a CHANGELOG section: re-pin refs, commit, tag
```

Set `CLEARCUTT_PORTAL_BUNDLE=path/to/bundle` to run `npm run dev` against
another bundle.

## License

Apache-2.0; see [LICENSE](LICENSE).

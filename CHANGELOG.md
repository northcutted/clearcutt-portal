# Changelog

ClearCutt Portal is pre-1.0. The bundle format it reads is clearcutt-verify's
`clearcutt.dev/v1` contract; the portal's own inputs and pages may change
between minor releases, with notes here.

## Unreleased

### Added: what to fix first

- The overview opens with where the estate stands: whether the policy passes,
  and what is outstanding either way (critical and high findings with how many
  have a fix, images on a stale base, rebuilds that didn't reproduce, images
  with no vulnerability data, scans older than a limit or with no date,
  unknown bases). It no longer says "Every image meets every requirement" when
  everything is verified; it says the policy passes and lists what is still
  outstanding.
- "Not verified, and why" is one card per reason, with the number of images it
  holds back and each of them, instead of one card per image. Reasons that
  differ only in a number ("3 …" and "30 …") are one card ("3–30 …").
- Every headline number is a link to the images it counts: new pages under
  `lists/` (`verified`, `failed`, `unverified`, `stale-base`, `base-proven`,
  `base-claimed`, `base-unresolved`, `critical-high`, `not-scanned`,
  `old-scans`, `reproduced`, `not-reproduced`, `not-checked`). New tiles count
  critical and high findings, rebuilds that didn't reproduce, and the age of
  the oldest vulnerability scan, flagged past `--scan-age-days` (default: the
  policy's `maxScanAgeDays`, or 7).
- A Findings page (`findings/`) lists every advisory in the estate in the order
  to fix it: fixable critical and high first, then critical and high with no
  fix known, then the rest by severity, most images first. Each advisory has a
  page (`findings/<id>/`) with the images that have it, the package and
  installed version, the fixed versions, where a VEX statement covers it, and
  the images with no vulnerability data (which may have it, when they ship one
  of its package versions). CVE, GHSA, Go, PYSEC, and RUSTSEC IDs of a known
  shape link to their canonical pages (cve.org and NVD, GitHub, pkg.go.dev,
  OSV, RustSec); any other ID stays text. The overview shows the first ten.
- An image's findings are listed fix first, each ID linked to its advisory's
  page and canonical pages.
- The images table sorts by any column with script (verdict, base, each kind
  of evidence, vulnerabilities, scan age, rebuild), says how it is sorted
  (`aria-sort` and an announcement), and keeps unknown values at the bottom
  whichever way it sorts. Without script it is the same table, in verdict
  order. It also shows each image's scan age.

### Added: the contract gate

- The build warns when a report or history has fields the vendored contract
  doesn't define, naming each (`images[].evidence.signature.newField`), and
  when the report was written by a clearcutt-verify release newer than the
  one the contract is from. The warnings go to stderr (and to GitHub Actions
  annotations in a workflow), and into every page's footer and the About
  page; nothing is dropped silently. The build still succeeds: v1 only grows.
- `contract/UPSTREAM` records the clearcutt-verify release the pinned commit
  is, or the newest before it (`release:`), which `scripts/sync-contract.sh`
  writes and `--check` verifies. The contract is now pinned to
  clearcutt-verify v0.16.0's commit, whose contract is the same as before.
- CI fails when a schema in `contract/` changed since the last release and
  the CHANGELOG's Unreleased section doesn't mention the contract.
- The README says how clearcutt-verify's CI can build its output with a
  released portal.

### Added: scale

- The history, comparison, and image pages show the latest 50 runs
  (`--history-runs N`; `0` shows every run), say how many older runs they
  leave out, and link `estate-history.json`, which has every run. Run names
  are still taken over the whole history, so they don't change as the window
  moves. A history of 1,000 runs used to give 2,000 comparison pages, each
  listing every run (2.6 GB of a 3.4 GB site for 500 images, past GitHub
  Pages' 1 GB); it now gives 98.
- Lookups the pages repeat are indexed once per report: an image's packages,
  its history rows, the images built on it, images by ID, and package groups.
  An image page used to scan every history row of every run.
- `scripts/gen-fixture.ts` writes a synthetic estate (500 images and 1,000
  runs by default) valid against the contract, and a CI job builds it within
  a time budget (`test/scale.test.ts`; about 8 s on a laptop, 110 s before
  these changes).
- The tests remove the temporary bundles and sites they build.

### Fixed

- A history whose `entries` is empty no longer crashes the build: the history,
  comparison, and image pages say the history lists no runs.
- A `factory.sourceDateEpoch` too large for a date no longer stops the build
  with a RangeError; the image page shows the number as it is.
- Runs are ordered by the time they name, not by the text of their timestamp,
  so an offset (`18:00+02:00` is before `17:00Z`) or a fractional second no
  longer misorders the history or picks the wrong run as the latest.
- The overview's "Reproduced" tile is green only when every image with a
  recipe or rebase record reproduced. With none reproduced it reads as
  unknown, and with nothing to rebuild as not applicable.
- Comparison links are stable. A run's name in URLs depends only on its own
  time (with milliseconds when it has them; a hash of the text when it doesn't
  parse), so a new run never renames an older one. "Since" a run is now
  `history/changes/<run>--latest/`, which keeps its address as runs arrive
  (it used to name the latest run's time, so every new run broke it); a run
  with the one before it is still `<older>--<newer>`, and always shows those
  two runs.
- Status glyphs have at least 4.5:1 contrast on every surface in both themes
  (the light theme's were 2.1–3.8:1, and the dark theme's "not applicable"
  3.4:1). Glyphs take their own color (`--glyph-*`); tones keep the tints.
- The glyph-per-cell status tables (evidence and rebuild) are keyboard
  reachable: each cell takes focus, is named for screen readers by what it
  says ("SBOM: Unknown. …"), and shows that label while focused.

## v0.1.0

The first version of ClearCutt Portal: a static website generated from
clearcutt-verify's estate report (`clearcutt.dev/v1`).

**Pages.** An overview of verdicts, the reasons for each image that isn't
verified, stale bases, and evidence and vulnerabilities across the estate; a
page per image with its base and how it is known, each piece of evidence and
its signer, vulnerabilities, tests, reproducibility, rebase, platforms, and
packages; the base-image graph; which images ship each package; history and
trends; and what every status means.

**Honest by construction.** Proven, claimed, and unknown are shown apart on
every page, each with a glyph as well as a color. Unknown is never shown as
zero, absent, or a pass, and estate totals say when they only cover part of
the estate.

**Contract-only.** The site is built against a pinned copy of clearcutt-verify's
JSON Schemas, with types generated from them. A bundle that doesn't match
stops the build; fields from a newer v1 are ignored.

**Safe with an untrusted report.** Much of a report is written by whoever
built an image. Every page carries a Content-Security-Policy that runs only
the site's own scripts and styles; a report value becomes a link only when it
is an http(s) URL; and an image ID that can't be a page name is a bundle
error. The build replaces `--out` only when it is empty or a site an earlier
build wrote, and never when it overlaps the bundle.

**clearcutt-verify v0.15's contract.** Image pages show each image run by
run from the history's per-image rows (verdict, digest, base, findings, with
trend charts) and every rebase recorded; the history page lists what changed
for each image since the previous run. A new Stacks page lists the registry
stacks apps are built on, each version's signature against the policy's
stack signers, and the apps on an older version; app pages name their stack.
Bases say which platform image a digest names and which platforms were
compared to prove them; package lists say which SBOM they were read from and
whether it was verified; the policy shows its scan-age limit and stack
signers; and a smoke test a recipe declares reads as "Declared in recipe".
A base whose age couldn't be measured (`daysBehindUnknown`, from a newer
clearcutt-verify) shows as unknown, and a signer on evidence that isn't
verified is shown as what its certificate claims.

**Check it yourself.** Each image page lists copy-paste commands that check
what it says without trusting the site: `cosign verify` and `cosign
verify-attestation` for every signature and attestation that verified, with
the policy's trusted signer (and, for a reusable GitHub workflow, the calling
repository and ref); `gh attestation verify` for GitHub's provenance;
`clearcutt-factory verify` to rebuild a factory image or repeat its rebase;
and `clearcutt-verify estate verify` with the report's policy to reach the
verdict again. Images are named by digest, never by tag. Every value from the
report is one shell word, single-quoted when it needs to be, and a value that
isn't printable ASCII drops its command, with the reason on the page. A copy
button appears where the clipboard works.

**Search by version.** The packages page answers queries like `libxml2 <2.14`,
`openssl >=3.0,<3.0.15`, or `deb:openssl <1.1.1w || >=3.0,<3.0.15`, comparing
versions the way each ecosystem does (apk, dpkg, rpm, semver, PEP 440). The
answer lists the images that ship a matching version and the images built on
one of them, through the report's base links, saying how each link is known and
what the image's own package list says. The index is a JSON file the build
writes and a script of the site filters; without script, each package's page
lists the images that inherit each version. Package versions are listed oldest
first in that order too.

**Compare runs.** History has a page per pair of runs (each run with the one
before it, and each with the latest): every image's digest, base, verdict, and
findings by severity before and after; whether it was rebased, rebuilt on a new
base or the same one, or left as it was while its base moved; and, per
severity, which images had findings before and after. Image pages say how the
image changed from run to run.

**clearcutt-verify #71's contract** (pinned to its branch until it merges).
Comparisons name the fixable high and critical findings fixed and introduced
for each image, with a table by finding ID, and say whether its package set
changed, when both runs list them (`fixableFindings`, `packagesDigest`).
Evidence clearcutt-verify verified as a GitHub artifact attestation gets
`gh attestation verify --bundle-from-oci --repo … --signer-workflow …` from
its `signerWorkflow`; a key signer without a transparency log (`tlog: false`)
gets `--insecure-ignore-tlog=true` with cosign, and `--insecure-ignore-tlog`
with `clearcutt-factory verify` (a clearcutt-factory release after v0.1.1). Image pages say what checked a reproduction (this
run's rebuild, or a verified reproduction attestation, its signer, and where
it ran, the run's URL linked only when it is http or https).

The Content-Security-Policy now lets the site's scripts fetch the site's own
files (`connect-src 'self'`), and every script is a file of the site, never
inlined into a page.

**Accessible.** A skip link that shows on focus; every status chip opens what
it means, for keyboard, touch, and screen readers; and every charted value is
also in a table.

**Publishing.** A reusable workflow (`portal.yml`) deploys a fleet's portal to
GitHub Pages from a bundle artifact, and the action builds one in any job.
Releases are the signed `git archive` of their tag, which the action verifies
before building; only a `vX.Y.Z` tag counts as a release, and any other ref
builds from source.

# Changelog

ClearCutt Portal is pre-1.0. The bundle format it reads is clearcutt-verify's
`clearcutt.dev/v1` contract; the portal's own inputs and pages may change
between minor releases, with notes here.

## Unreleased

### Added: rescans and observe-only images in history

- Run comparisons and image history show fresh scan counts separately from
  publisher scans. Missing rescan data remains unknown. A change to either
  scan, or to whether an image gates policy, appears in the comparison.
- The history table and trend series include rescan coverage and findings,
  plus observe-only counts, when those fields exist in the selected runs.


### Breaking

- **Every image page moves once, with clearcutt-verify v0.17.0's reports.**
  clearcutt-verify now makes an image's `id` from its whole reference
  (`ghcr-io-northcutted-images-hello-app` where it was `hello-app`), and the
  portal names pages by `id` (`images/<id>/`), so a site built from a v0.17
  report has every image under a new address. The portal still takes IDs
  only from the report and never derives one.

### Contract: clearcutt-verify v0.17.0

- `contract/` is clearcutt-verify v0.17.0's contract (`contract/UPSTREAM`
  pins its commit and names the release). Every change is additive under
  `clearcutt.dev/v1`: the run's `metadata.platforms`; the policy's `rescan`,
  `scanSource`, `vex`, `observe`, and `provenanceBuilders`; an image's
  `rescan`, `observeOnly`, and `provenance`; a scan's `database`; a
  finding's `suppressedBy`; `summary.rescan` and
  `summary.verdicts.observeOnly`; history rows' `rescanVulnerabilities` and
  `observeOnly`; and the trust policy's `estate` role. The vendored example
  and fixture bundles are v0.17's, with its image IDs, and the tests follow
  them.

### Added: provenance, and a rebase record's smoke test

- An image's page says what was done with the builder its verified SLSA
  provenance names (`images[].provenance`): "Builder checked" when the
  policy's `provenanceBuilders` named it, otherwise "Builder read, not
  checked", with the builder ID and build type as read. When the policy
  names builders and the provenance failed, the page says nothing was read
  from it.
- Test evidence that clearcutt-verify v0.17.0 reads from a verified rebase
  record (the smoke test clearcutt-factory ran before publishing the rebase)
  says it was found in the rebase record, and is checked by the record's
  own command, whose description says its test field holds the result; it
  gets no command of its own, and isn't listed as having no trusted signer.

### Added: which platforms a run read

- A run that read only some platforms (`metadata.platforms`, from
  `estate verify --platforms`) says so in the overview, the footer, and on
  About; an image with platform images outside the selection says which
  weren't read, and that its evidence, findings, and packages describe the
  rest; its platforms table marks each read or not; and its verdict command
  passes the run's selection.
- An image whose platform list couldn't be read says its platforms are
  unknown. clearcutt-verify before v0.17.0 wrote that list as `null`, which
  the schema doesn't allow and used to stop the build; it now reads as the
  empty list v0.17.0 writes.

### Added: the policy's new fields

- The policy (overview and About) says whether the run rescanned
  (`policy.rescan`), which scan the vulnerability limit gated on
  (`policy.scanSource`: the publisher's, this run's, or both), each VEX
  document applied to the rescans (`policy.vex`: file, `@id`, author, and
  how many statements), the observe-only patterns (`policy.observe`), and
  the provenance builders the policy requires (`policy.provenanceBuilders`),
  each with what it means. Each signer list names its trust-policy role
  (`image`, `stack`).
- The verdict command's policy file carries `scanSource`, `observe`, and
  `provenanceBuilders`, and the command adds `--rescan` when the run
  rescanned. The VEX documents aren't in the report, so the command says to
  add them rather than reaching a verdict that counts what they suppressed
  without saying so.

### Changed: claimed bases

- A base the image only names by repository (an `oci-base-name` or
  `history` edge from clearcutt-verify v0.17: no digest, and no or an empty
  `imageId`) reads "a claimed base, no version identified", links to no
  image, and says how far behind it is is unknown. An empty `base.imageId`
  is no link, not a bundle error (it used to stop the build); comparisons
  and the package search take an empty base digest as not recorded.
- Drift past `maxDaysBehind` fails an image only from a base proven by layer
  digests: the stale tables say "over the limit by a claim: unverified, not
  failed" for a claimed base, and the policy says so.

### Added: observe-only images

- An image the policy observes without gating on it (`images[].observeOnly`,
  `policy.observe`) is counted apart: a fourth verdict tile (Observe-only,
  from `summary.verdicts.observeOnly`) and a list of its own
  (`lists/observe-only/`), not in the verified, failed, and unverified
  lists, which now count exactly what `summary.verdicts` counts. The
  overview's standing counts the gating images and says how many more are
  observe-only. Observe-only images are on no "Not verified, and why" card,
  and their findings aren't in "Findings to fix first" (the findings pages
  still list them). They stay in the images table, after the gating images,
  with their own verdict and an Observe-only mark, as on their pages, the
  bases graph, and the finding pages.

### Added: rescans and suppressions

- When the run rescanned (`policy.rescan`, `images[].rescan`), an image's
  page shows both scans side by side: the publisher's, attested when the
  image was built, and the run's own, of the image's verified SBOMs, each
  with its scanner, when it ran, and when its vulnerability database was
  built (`database.built`, with its schema); the findings of each by
  severity; which advisories one counts and the other doesn't; and which scan
  the policy's limit gated on (`policy.scanSource`, else clearcutt-verify's
  default). A rescan that is `unknown`, or an image the run didn't rescan, is
  "couldn't check", with the reason and each platform's status, and its
  counts are `?`: never clean, never zero. The images table gives this run's
  counts under the publisher's ("now 1 C · 1 H", or "now: couldn't check"),
  and sorts by the worse of the two. A run that didn't rescan shows one scan,
  as before.
- The estate's findings are those of the scans the policy gated on
  (`policy.scanSource`: the publisher's, this run's, or both), each
  occurrence saying which scan found it. "Findings to fix first" puts first
  what fails the gate (in the example, the rescan's fixable critical); the
  findings index says which scan found each advisory; an advisory's page
  gives each image's scan and when it ran (or when its database was built);
  and an image a gated scan has no findings for is unknown there. Package
  pages list the advisories the gated scans found in each version.
- The overview counts both scans: "Critical and high, at build time" and
  "Critical and high, now" (with the database's build day), how many images
  were rescanned and how many couldn't be (a new list,
  `lists/not-rescanned/`), how many findings this run's scan suppressed,
  this run's critical and high findings among what is outstanding, and a
  table with both scans' totals, the scanner, and the database. A run
  without a rescan reads as before.
- A suppressed finding stays listed, in a group that is open, marked
  Suppressed, with what suppressed it (`suppressedBy`): the VEX document's
  file and `@id`, the statement's status, justification, and product; or the
  scanner's own rule. One suppressed with no `suppressedBy` says the
  publisher's scan suppressed it with a statement this run didn't see.

### Changed: "couldn't be checked" apart from "failed"

- The overview's "Not verified, and why" puts the requirements images
  failed (evidence missing or failing verification, findings over the limit,
  a base proven too far behind, a rebuild that gave another digest) in one
  group, and those that couldn't be checked (evidence that couldn't be read
  or checked, or that no trusted signer vouched for; vulnerabilities no scan
  covers, or a rescan that couldn't run; drift from a base the image only
  claims; old scans) in another. A failed image lists both kinds of reason,
  so each reason is classed by what it says, not by the image's verdict;
  "vulnerabilities are unknown" on a failed image used to read as a failed
  requirement. A reason this portal doesn't recognize, on a failed image,
  stays with the failures. Image pages list their reasons the same way.

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
  a 45-second budget (`test/scale.test.ts`; about 15 s on a GitHub-hosted
  runner and 8 s on a laptop, where it took 110 s before these changes).
- The tests remove the temporary bundles and sites they build.

### Added: browser tests

- Playwright tests (`e2e/`, `npx playwright test`) run the site's scripts in
  Chromium under its Content-Security-Policy: sorting the images table (by
  mouse and keyboard, both ways, unknown last), the filter boxes, the package
  search and its `?q=` address, copy buttons, chips, focusable status cells,
  and the theme toggle. An axe pass (WCAG 2.1 A and AA) covers every kind of
  page in the light and dark themes, and the states the scripts produce. CI
  runs them with Chromium's headless shell only, cached by Playwright version.
  `@playwright/test` and `@axe-core/playwright` are development dependencies;
  the build doesn't use them.

### Added: signed bundles, and one version input

- The action and the reusable workflow take `bundle-ref`: the bundle as the
  OCI artifact `clearcutt-verify estate push` stores. Its cosign signature
  must verify against the new `certificate-identity-regexp` (anchored with
  `^` and `$`) and `certificate-oidc-issuer` inputs before anything of it is
  read, and it must be an estate bundle (config media type
  `application/vnd.clearcutt.estate.v1+json`); only the verified digest is
  pulled. Without a signer, with one that doesn't match, or with another kind
  of artifact, the build fails and nothing is built. The inputs are named
  after cosign's flags, which clearcutt-verify's `estate pull` mirrors.
  `registry-username` and `registry-password` (a secret, for the workflow) log
  in to a private bundle's registry. The new output `bundle-digest` names the
  digest that was verified. `bundle` (the action) and `bundle-artifact` (the
  workflow) are no longer required: give one of them or `bundle-ref`.
- The action and the workflow take `history-runs` and `scan-age-days`.
- The reusable workflow builds the version it is called at, from the commit
  it was called at (`job.workflow_sha`): a release's signed archive when that
  is a release tag or the commit one names, that commit's source otherwise.
  The action does the same for a commit pin. A new output, `portal-version`,
  says which.
- The deploy job runs in the concurrency group `clearcutt-portal-pages-deploy`
  (one deploy at a time, the newest waiting), named so a caller's own group
  can't deadlock with it.
- The README and the adoption guide pin the action and the workflow by the
  release's commit, like every other action, and show `bundle-ref`.

### Changed

- `portal-version` is deprecated. It still works, and the workflow warns that
  it is no longer needed (and when it differs from the ref the workflow is
  called at); remove it from callers. Without it, a caller at a branch or a
  commit now builds that ref instead of the default release.
- The action installs the portal with `npm ci --omit=dev`: the build needs no
  development dependency.

### Fixed

- Light-theme secondary text (`--ink-300`) and links were 4.1–4.4:1 on cards
  and table headers; both are now at least 4.5:1 on every surface, which
  `test/contrast.test.ts` checks for both themes.
- A command too wide for its box can be scrolled from the keyboard (its block
  takes focus).
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

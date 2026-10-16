# Changelog

ClearCutt Portal is pre-1.0. The bundle format it reads is clearcutt-verify's
`clearcutt.dev/v1` contract; the portal's own inputs and pages may change
between minor releases, with notes here.

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

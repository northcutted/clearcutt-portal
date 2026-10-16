# Changelog

ClearCutt Portal is pre-1.0. The bundle format it reads is clearcutt-verify's
`clearcutt.dev/v1` contract; the portal's own inputs and pages may change
between minor releases, with notes here.

## Unreleased

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

**Accessible.** A skip link that shows on focus; every status chip opens what
it means, for keyboard, touch, and screen readers; and every charted value is
also in a table.

**Publishing.** A reusable workflow (`portal.yml`) deploys a fleet's portal to
GitHub Pages from a bundle artifact, and the action builds one in any job.
Releases are the signed `git archive` of their tag, which the action verifies
before building; only a `vX.Y.Z` tag counts as a release, and any other ref
builds from source.

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

**Accessible.** A skip link that shows on focus; every status chip opens what
it means, for keyboard, touch, and screen readers; and every charted value is
also in a table.

**Publishing.** A reusable workflow (`portal.yml`) deploys a fleet's portal to
GitHub Pages from a bundle artifact, and the action builds one in any job.
Releases are the signed `git archive` of their tag, which the action verifies
before building; only a `vX.Y.Z` tag counts as a release, and any other ref
builds from source.

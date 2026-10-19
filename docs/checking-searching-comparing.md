# Checking, searching, and comparing

Three parts of the site do more than show the report: commands to check an
image yourself, a package search by version, and a comparison of two runs.
This page says how each works and where each stops.

## Checking an image yourself

Each image page has a **Check it yourself** section of copy-paste commands
built from the report (`src/lib/commands.ts`):

| Command | When | What it checks |
|---|---|---|
| `cosign verify` | The signature verified | The signature over the image, against the trusted signer |
| `cosign verify-attestation --type=<predicate type>` | An SBOM, vulnerability report, provenance, recipe, rebase record, or test attestation verified | That attestation, against the trusted signer. Evidence attached per platform (SBOMs, vulnerability reports) gets one command per platform image, as clearcutt-verify checks it |
| `gh attestation verify oci://… --bundle-from-oci` | Evidence verified and the report calls it a GitHub attestation (GitHub's artifact attestations, such as `actions/attest-build-provenance` provenance, which clearcutt-verify recognizes by their content) | The attestation, with GitHub's verifier, read from the registry: `--repo` is the repository whose run made it (`signer.sourceRepository`), `--signer-workflow` the workflow that signed it (`signerWorkflow`), and `--source-ref` is added when the policy requires a ref. From a clearcutt-verify that doesn't record `signerWorkflow`, the workflow is read from the identity, for a reusable one in another repository |
| `clearcutt-factory verify --image=…` | A clearcutt-factory image whose recipe or rebase record verified | Rebuilds it from the signed recipe (or repeats the signed rebase) and compares digests. It needs Docker or Podman, and takes no source-ref flag. For a key signer without a transparency log it adds `--insecure-ignore-tlog`, which needs a clearcutt-factory release after v0.1.1 |
| `clearcutt-verify estate verify` | Always | Runs verify over this image alone, in a new directory, with the report's policy written to `policy.json`, so its verdict can be compared with the page's |

The signer flags are the ones clearcutt-verify passed to cosign: the policy's
trusted signer that accepts the evidence's certificate
(`--certificate-identity-regexp` or `--certificate-identity`, and
`--certificate-oidc-issuer`), with `--certificate-github-workflow-repository`
when the policy requires the calling repository (`sourceRepository`,
`sourceMatchesImage`, `sourceRepositoryOwner`) or the signing workflow is a
reusable one in another repository, and `--certificate-github-workflow-ref` for
`sourceRef`. A key signer the policy accepts without a transparency log entry
(`tlog: false`), or whose verified evidence was checked without one, gets
`--key=…` and `--insecure-ignore-tlog=true`; the verdict command's policy keeps
`tlog` too. When no trusted signer can be matched in the browser's regular
expression dialect, the command names the certificate's exact identity
instead, and says so.

The values in a command come from an untrusted report, so:

- An image is always `repository@digest`, never a tag, and the repository and
  digest must match the OCI reference grammar (a sha256 or sha512 digest).
  Anything else, and the image gets no commands.
- Only evidence that verified gets a command. Evidence that is present, failed,
  or unknown has no trusted signer to check against, and the page names it.
- Each value is one shell word: bare when it has only characters no POSIX shell
  expands (`A-Z a-z 0-9 _ @ % + = : , . / -`, not starting with `=`), otherwise
  in single quotes with each `'` written as `'\''`. A flag's value always
  follows `=` (`--certificate-identity='…'`), so it can't be read as another
  flag.
- A value with anything but printable ASCII (a control character, a line break,
  a non-ASCII letter that looks like an ASCII one, a bidirectional override)
  can't be shown as exactly what runs, so its command isn't shown, and the page
  says which and why.

The commands are written for sh, bash, and zsh, and tested in each (and dash):
every command runs against stub programs and must pass exactly the values the
report holds, for a corpus of hostile values. fish treats `\\` in single quotes
differently, so a regular expression with `\\` may need care there.

A copy button appears beside each command when the browser offers the
clipboard (over https or on localhost); it is a script file of the site, like
every script.

## Searching packages by version

The packages page answers "who ships this package at these versions"
(`src/lib/package-search.ts`).

### Syntax

```
[type:]name [constraints]
```

- **name**: a package name, in any case. `*` matches any run of characters
  (`libxml2*`); nothing else is special.
- **type**: optional, a package type in the report (`apk`, `deb`, `rpm`,
  `golang`, …). It is read as a type only when it is one of the report's, since
  a Maven name has a colon of its own.
- **constraints**: `<`, `<=`, `>`, `>=`, `=` (or `==`), or `!=`, each followed
  by a version (spaces after the operator are allowed). A version with no
  operator means `=`. Constraints separated by commas or spaces must all hold;
  `||` separates alternatives, any of which may hold. No constraints means any
  version.

```
libxml2 <2.14
openssl >=3.0,<3.0.15
deb:openssl <1.1.1w || >=3.0,<3.0.15
zlib1g <1:1.3.2
libxml2*
```

npm-style `^` and `~` ranges and `*` in versions are refused with a message
rather than guessed at.

### Version order

Each package's versions are compared the way its ecosystem orders them,
chosen by its type (`src/lib/versions.ts`):

| Type | Order |
|---|---|
| `apk` | apk-tools: numeric components (more is newer: `1.2 < 1.2.0`), then a letter, then suffixes (`_alpha`, `_beta`, `_pre`, `_rc` before the release; `_cvs`, `_svn`, `_git`, `_hg`, `_p` after it), then `-rN` |
| `deb` | dpkg: `[epoch:]upstream[-revision]`; `~` sorts before everything, even the end (`1.0~rc1 < 1.0`), then letters, then other characters |
| `rpm` | rpmvercmp: `[epoch:]version[-release]`; numbers are newer than letters, `~` sorts before and `^` after the end |
| `golang`, `npm`, `cargo` | semver: `v1.2.3-rc.1 < v1.2.3`; Go pseudo-versions are pre-releases; Go's `go1.27.0` reads as `1.27.0` |
| `pypi` | PEP 440: `1.0.dev1 < 1.0a1 < 1.0rc1 < 1.0 < 1.0.post1`; `1!0.1` (an epoch) is newer than `2.0` |
| anything else | dpkg's rule over the whole string, after a leading `v` |

A version its scheme can't parse is compared by the last rule.

A constraint compares only the parts it gives. Without an epoch, the package's
epoch is ignored; without a revision or release (Debian `-1`, apk `-r0`, rpm
`-1.el9`), the package's is too. So `<2.14.0` holds for `2.13.9-r5` and not for
`2.14.0-r1`, `=2.14.0` holds for `2.14.0-r1`, and `zlib1g <1.3.2` compares
`1:1.3.dfsg+really1.3.1-1` by its upstream version. Write the epoch
(`<1:1.3.2`) to compare as dpkg would. Advisories are usually written without
epochs, and a search that missed an image because of one would say "nobody
ships it" when someone does.

Limits: apk's special handling of leading zeros (`1.01`) and of commit hashes
(`~abc`), and PEP 440's local versions (`+local`), are ignored. Maven,
RubyGems, NuGet, and the rest use the generic order, where a pre-release
written without `~` (`1.0-rc1`) sorts after its release.

### Inheritance

An image built on another contains its base's layers, so it has the base's
packages even when its own package list isn't in the report. The answer lists:

- **Ships it**: the image's own package list has a matching version (and, if
  its base ships one too, says so: updating it means updating the base).
- **Inherits it**: the report links the image to a base (`base.imageId`) that
  ships a matching version, or that itself inherits one, and the image's own
  package list isn't in the report. This follows the base graph as far as it
  goes, nearest base first.
- **Its base ships it**: the image's own list says otherwise (another version,
  or not listed), so it is shown but not followed further.

Each inherited answer says how the link is known (proven by layer digests, or
only declared by the image's author, in which case it is a claim) and whether
the image is built on the very version of the base whose packages the report
read. An image on an older version of its base may have another version of the
package; the report lists only the base's current one.

Images with no package list that aren't built on one that ships it are listed
as unknown, never as "doesn't ship it", and package lists read from SBOMs no
trusted signer verified are flagged as possibly incomplete.

### Static

The build writes the index to `packages/search-index.json`: every package
version, the images that ship it, and each image's base link. A script of the
site fetches it the first time someone searches, which is why the
Content-Security-Policy allows `connect-src 'self'`, and answers in the
browser with the same code the build tests. The query is kept in the URL
(`?q=`), so an answer can be linked to. Without script, the search stays hidden
and each package's page lists, for each version, the images that ship it and
the images that inherit it.

## Comparing runs

From clearcutt-verify v0.15, each history entry has a row per image: its
digest, verdict, base (digest, currency, how it is known), rebase, and findings
counted by severity. Later releases add `fixableFindings`, the IDs of its
fixable high and critical findings (VEX-suppressed ones aside) from verified
scans, and `packagesDigest`, a digest of its package set from verified SBOMs.
The history pages compare two runs image by image (`src/lib/timeline.ts`).

How an image changed:

| | |
|---|---|
| **Rebased** | A new digest, from a rebase the older run didn't record |
| **Rebuilt on a new base** / **Rebuilt, same base** / **Rebuilt** | A new digest otherwise, on another base digest, the same one, or one a run didn't record |
| **Base moved** | The same digest, but its base is more or less current than before: usually its base's tag moved on to a newer version |
| **Unchanged** | The same digest, on a base as current as before. Its verdict or findings can still change, when the policy, the evidence, or the advisories do |
| **New** / **Gone** | In the newer run only, or the older run only |

Each comparison page shows these counts; per severity, which images had findings
in the older run and which in the newer, and of those in both, which have none
now and which have some for the first time; and a table of every image that
changed, before and after. An image with no vulnerability data in a run is
unknown there, never zero.

When both runs list finding IDs, the page also names, per image, the fixable
high and critical findings **fixed** (gone in the newer run: fixed, or now
covered by VEX) and **introduced**, and has a table by finding ID: which images
had it, which have it, and where it was fixed or introduced, each with how the
image changed. That is the advisory drill: for `CVE-2026-1234`, who had it, who
still does, and whether they were rebuilt, rebased, or left while their base
moved. Other findings are only counted, so only these are named. The
**Packages** column says whether the package set changed, from the digests; it
can say that the set differs, not which packages. The latest run's image pages
list both.

A run lists IDs when any of its rows has `fixableFindings` or
`packagesDigest`. In such a run, a row with vulnerability data and no
`fixableFindings` has none. A run from v0.15 lists neither, so compared with it
nothing is called fixed or introduced and packages are unknown, rather than
everything reading as fixed.

`history/changes/` compares the latest run with the one before it. The site
also renders a page for each run with the one before it
(`history/changes/<older>--<newer>/`) and one for what changed since each run
(`history/changes/<run>--latest/`), about twice the number of runs; the
history page and every comparison link to them. Other pairs aren't rendered.

The addresses are stable. A run is named by its time alone, such as
`20261010T165146Z` (with milliseconds when it has them, such as
`20261010T165146.500Z`; a time that doesn't parse is `run-` and a hash of its
text), so a new run never renames an older one. `<older>--<newer>` always
shows those two runs; `<run>--latest` keeps its address as new runs arrive
and compares with whichever run is the latest.

A package-set digest says that something changed, not what; and findings other
than fixable high and critical ones are only counted. The latest run's image
pages list all of its findings and packages.

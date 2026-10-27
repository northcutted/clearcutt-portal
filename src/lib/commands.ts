// Commands that check what a report says about an image without trusting
// this site: cosign for each signature and attestation the report says
// verified, gh for GitHub's provenance, clearcutt-factory to rebuild a factory
// image, and clearcutt-verify to reach the verdict again.
//
// Every value in a command comes from the report, and much of a report is
// written by whoever built an image, so:
//
// - an image is named by repository@digest, never by a tag, and both must be
//   well formed (a tag can move; a digest can't);
// - only evidence that verified gets a command, with the identity the policy
//   trusts, since that is the claim being checked;
// - every value is one shell word: bare when it has only characters no POSIX
//   shell treats specially, otherwise in single quotes with each ' written
//   as '\''; and a flag's value always follows "=", so it can never be read
//   as another flag;
// - a value that isn't printable ASCII (a control character, a line break,
//   a lookalike letter, a bidirectional override) can't be shown as exactly
//   what runs, so the command isn't shown at all, and the page says why.
import type { EstateReport, EvidenceItem, Image, Policy, Signer } from './contract.gen.ts';
import { EVIDENCE_KINDS, testsInRebaseRecord, type EvidenceKind } from './present.ts';

/** Why a command isn't shown. */
export class NoCommand extends Error {
  override name = 'NoCommand';
}

/** A report value that can't be written into a command safely. */
export class UnsafeValue extends NoCommand {
  override name = 'UnsafeValue';
}

const PRINTABLE = /^[\x20-\x7e]+$/;
// Characters no POSIX shell (sh, bash, zsh) expands in an argument. "=" may
// not lead, since zsh expands =word to a path.
const BARE = /^[A-Za-z0-9_@%+:,./-][A-Za-z0-9_@%+=:,./-]*$/;

/**
 * A value as one shell word: bare when it needs no quoting, otherwise in
 * single quotes. Throws UnsafeValue for an empty value or one with anything
 * but printable ASCII.
 */
export function shellWord(value: string, what = 'a value'): string {
  if (value === '') throw new UnsafeValue(`${what} is empty`);
  if (!PRINTABLE.test(value)) throw new UnsafeValue(`${what} has characters other than printable ASCII`);
  if (BARE.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** --name=value, with the value as one shell word. */
export function flag(name: string, value: string, what = name): string {
  return `${name}=${shellWord(value, what)}`;
}

// The OCI reference grammar (distribution/reference), for a repository with
// its registry host, as the report names images.
const DOMAIN_COMPONENT = '(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])';
const PATH_COMPONENT = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*';
const REPOSITORY = new RegExp(`^${DOMAIN_COMPONENT}(?:\\.${DOMAIN_COMPONENT})*(?::[0-9]+)?(?:/${PATH_COMPONENT})+$`);
const DIGEST = /^(?:sha256:[a-f0-9]{64}|sha512:[a-f0-9]{128})$/;

/** repository@digest, when both are well formed. Throws UnsafeValue otherwise. */
export function pinnedRef(repository: string, digest: string): string {
  if (repository.length > 255 || !REPOSITORY.test(repository)) {
    throw new UnsafeValue(`the repository ${JSON.stringify(repository)} isn't a well-formed registry/path`);
  }
  if (!DIGEST.test(digest)) throw new UnsafeValue(`the digest ${JSON.stringify(digest)} isn't a sha256 or sha512 digest`);
  return `${repository}@${digest}`;
}

// ── Whose signature ─────────────────────────────────────────────────────

const GITHUB = 'https://github.com/';
const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)$/;
const GITHUB_WORKFLOW = /^https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)\/(\.github\/workflows\/[^@]+)@.+$/;

/**
 * Whether a trusted signer from the policy accepts the signer the evidence's
 * certificate names. clearcutt-verify checked this with cosign; here it only
 * picks which of the policy's signers to write into the command.
 */
export function accepts(trusted: Signer, cert: Signer): boolean {
  if (trusted.key !== undefined) return cert.key === trusted.key;
  const identity = cert.identity;
  if (identity === undefined) return false;
  // clearcutt-verify uses identityRegexp when a signer has both.
  if (trusted.identityRegexp !== undefined) {
    // A pattern RE2 accepts and JavaScript doesn't (or the reverse) only
    // means the policy's signer isn't picked, and the certificate's own
    // identity is used.
    let pattern: RegExp;
    try {
      pattern = new RegExp(trusted.identityRegexp);
    } catch {
      return false;
    }
    if (identity.length > 1024 || !pattern.test(identity)) return false;
  } else if (trusted.identity === undefined || trusted.identity !== identity) {
    return false;
  }
  if (trusted.issuer !== undefined && cert.issuer !== undefined && trusted.issuer !== cert.issuer) return false;
  if (trusted.sourceRepository !== undefined && cert.sourceRepository !== trusted.sourceRepository) return false;
  if (trusted.sourceRepositoryOwner !== undefined) {
    const owner = `${trusted.sourceRepositoryOwner.replace(/\/+$/, '')}/`;
    if (!cert.sourceRepository?.startsWith(owner)) return false;
  }
  if (trusted.sourceRef !== undefined && cert.sourceRef !== undefined && cert.sourceRef !== trusted.sourceRef) return false;
  return true;
}

export interface Identity {
  /** cosign's flags, as [name, value]: --key, or --certificate-identity[-regexp] and --certificate-oidc-issuer, then the GitHub run's repository and ref. */
  flags: [string, string][];
  /** The repository whose run signed, as owner/repo, when it is a GitHub one. */
  repository?: string;
  /** Whether the flags are the policy's trusted signer (true) or the certificate's own identity (false). */
  fromPolicy: boolean;
  /** A key signer that signs without a transparency log (tlog: false), so cosign is told not to look for an entry. */
  noTlog?: boolean;
}

/** --insecure-ignore-tlog for a key signer the policy accepts without a log entry, or whose verified evidence was checked without one. */
function keyIdentity(key: string, trusted: Signer | undefined, cert: Signer): Identity {
  const noTlog = trusted?.tlog === false || cert.tlog === false;
  return {
    flags: [['--key', key], ...(noTlog ? ([['--insecure-ignore-tlog', 'true']] as [string, string][]) : [])],
    fromPolicy: trusted !== undefined,
    ...(noTlog ? { noTlog } : {}),
  };
}

/**
 * The flags that make cosign check a signature the way clearcutt-verify did:
 * the policy's trusted signer that accepts the certificate, with the
 * calling repository a reusable workflow ran in. Without such a signer, the
 * certificate's own identity, which is stricter. Throws UnsafeValue when
 * neither can be written down.
 */
export function identityFor(policy: Policy, cert: Signer | undefined): Identity {
  if (!cert) throw new UnsafeValue("the report doesn't say who signed it");
  const trusted = policy.trustedSigners.find((t) => accepts(t, cert));
  if (trusted?.key !== undefined) return keyIdentity(trusted.key, trusted, cert);
  if (!trusted && cert.key !== undefined) return keyIdentity(cert.key, undefined, cert);

  const signer = trusted ?? cert;
  const issuer = trusted?.issuer ?? cert.issuer;
  if (issuer === undefined) throw new UnsafeValue('the signer has no OIDC issuer');
  const flags: [string, string][] = [];
  if (trusted?.identityRegexp !== undefined) {
    flags.push(['--certificate-identity-regexp', trusted.identityRegexp]);
  } else if (signer.identity !== undefined) {
    flags.push(['--certificate-identity', signer.identity]);
  } else {
    throw new UnsafeValue('the signer has no identity');
  }
  flags.push(['--certificate-oidc-issuer', issuer]);

  // The repository whose run signed. clearcutt-verify requires it when the
  // policy does (sourceRepository, sourceMatchesImage, sourceRepositoryOwner),
  // as one exact repository; and a reusable workflow, whose identity is the
  // called workflow, needs it to say whose run it was.
  const certRepo = cert.sourceRepository;
  const reusable = cert.identity !== undefined && certRepo !== undefined && !cert.identity.startsWith(`${certRepo}/`);
  let repo: string | undefined;
  if (trusted) {
    repo = trusted.sourceRepository ?? (trusted.sourceMatchesImage || trusted.sourceRepositoryOwner !== undefined ? certRepo : undefined);
    if ((trusted.sourceMatchesImage || trusted.sourceRepositoryOwner !== undefined) && repo === undefined) {
      throw new UnsafeValue("the policy requires the signing run's repository, and the certificate doesn't name it");
    }
  }
  if (repo === undefined && reusable) repo = certRepo;
  if (repo !== undefined) flags.push(['--certificate-github-workflow-repository', repo.startsWith(GITHUB) ? repo.slice(GITHUB.length) : repo]);
  if (trusted?.sourceRef !== undefined) flags.push(['--certificate-github-workflow-ref', trusted.sourceRef]);
  const github = repo !== undefined ? GITHUB_REPO.exec(repo) : certRepo !== undefined ? GITHUB_REPO.exec(certRepo) : null;
  return { flags, ...(github ? { repository: github[1] } : {}), fromPolicy: trusted !== undefined };
}

// ── Commands ────────────────────────────────────────────────────────────

export interface Command {
  /** What it checks, e.g. "Signature" or "SBOM (linux/arm64)". */
  title: string;
  /** One or two sentences on what running it shows. */
  purpose: string;
  /** The command as it is copied: shell words, flags one per line. */
  text: string;
}

export interface Skipped {
  title: string;
  reason: string;
}

export interface Commands {
  /** The image as the commands name it, when it could be written. */
  ref?: string;
  commands: Command[];
  /** Commands not shown, with why. */
  skipped: Skipped[];
  /** Evidence kinds found (or perhaps there) but not verified, which get no command. */
  unverified: EvidenceKind[];
}

/** A command with each argument after the first `head` words on a line of its own. */
export function shellLine(head: string[], args: string[]): string {
  return [head.join(' '), ...args].join(' \\\n  ');
}

const label = (kind: EvidenceKind) => EVIDENCE_KINDS.find((k) => k.key === kind)?.label ?? kind;

const ATTESTATION_KINDS: EvidenceKind[] = ['sbom', 'vulnerabilityScan', 'provenance', 'recipe', 'rebase', 'tests'];

const TESTS_IN_RECORD = " Its test field is the smoke test the Tests row reads: each platform's result, as clearcutt-factory recorded it before it published the rebase.";

const ATTESTATION_PURPOSE: Record<string, string> = {
  sbom: 'Checks the SBOM attestation was signed by the trusted signer, and prints it.',
  vulnerabilityScan: "Checks the vulnerability report was signed by the trusted signer, and prints it: the findings as of the day it was made.",
  provenance: 'Checks the SLSA provenance was signed by the trusted signer, and prints it: what built the image, from which source.',
  recipe: 'Checks the clearcutt-factory recipe was signed by the trusted signer, and prints it.',
  rebase: 'Checks the clearcutt-factory rebase record was signed by the trusted signer, and prints it.',
  tests: 'Checks the test attestation was signed by the trusted signer, and prints it.',
};

/** Where an attestation is checked: the image, or each platform image whose evidence verified. */
function targets(image: Image, item: EvidenceItem): { platform?: string; ref: string }[] {
  const platforms = Object.entries(item.platforms ?? {});
  if (platforms.length === 0) return [{ ref: pinnedRef(image.repository, image.digest) }];
  return platforms
    .filter(([, status]) => status === 'verified')
    .map(([platform]) => {
      const found = image.platforms.find((p) => p.platform === platform);
      if (!found) throw new UnsafeValue(`the report has no ${platform} image to check it on`);
      return { platform, ref: pinnedRef(image.repository, found.digest) };
    });
}

function identityArgs(identity: Identity, without: string[] = []): string[] {
  return identity.flags.filter(([name]) => !without.includes(name)).map(([name, value]) => flag(name, value, `the signer's ${name.replace(/^--/, '')}`));
}

function signerNote(identity: Identity): string {
  return identity.fromPolicy
    ? ''
    : " It names the exact identity on the certificate: no signer in the policy could be matched to it here.";
}

const SIGNER_FIELDS = ['identity', 'identityRegexp', 'issuer', 'key', 'sourceRepository', 'sourceRepositoryOwner', 'sourceRef', 'sourceMatchesImage', 'tlog'] as const;

/**
 * The report's policy as a VerificationPolicy file (JSON, which is YAML too),
 * with only the fields clearcutt-verify reads. Not the VEX documents: the
 * report names them (policy.vex) but doesn't carry them, so the verdict
 * command says to add them.
 */
export function policyFile(policy: Policy): string {
  const signer = (s: Signer) => Object.fromEntries(SIGNER_FIELDS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
  return JSON.stringify({
    apiVersion: 'clearcutt.dev/v1',
    kind: 'VerificationPolicy',
    required: policy.required,
    trustedSigners: policy.trustedSigners.map(signer),
    ...(policy.failOn ? { failOn: policy.failOn } : {}),
    ...(policy.onlyFixed ? { onlyFixed: true } : {}),
    ...(policy.maxDaysBehind ? { maxDaysBehind: policy.maxDaysBehind } : {}),
    ...(policy.maxScanAgeDays ? { maxScanAgeDays: policy.maxScanAgeDays } : {}),
    ...(policy.stackSigners?.length ? { stackSigners: policy.stackSigners.map(signer) } : {}),
    ...(policy.scanSource ? { scanSource: policy.scanSource } : {}),
    ...(policy.observe?.length ? { observe: policy.observe } : {}),
    ...(policy.provenanceBuilders?.length ? { provenanceBuilders: policy.provenanceBuilders } : {}),
  });
}

const PLATFORM = /^[a-z0-9]+(?:\/[a-z0-9._-]+){1,2}$/;

/** The commands for an image, the ones refused and why, and the evidence with none. */
export function verifyCommands(report: EstateReport, image: Image): Commands {
  const commands: Command[] = [];
  const skipped: Skipped[] = [];
  // A smoke test read from the rebase record is checked by checking the
  // record: it gets no command of its own, and is never "unverified" for
  // want of a signer when the record verified.
  const testsInRecord = testsInRebaseRecord(image.evidence) && image.evidence.rebase.status === 'verified';
  const unverified = EVIDENCE_KINDS.map((k) => k.key).filter(
    (k) => ['present', 'failed', 'unknown'].includes(image.evidence[k].status) && !(k === 'tests' && testsInRecord),
  );
  let ref: string;
  try {
    ref = pinnedRef(image.repository, image.digest);
  } catch (err) {
    if (!(err instanceof UnsafeValue)) throw err;
    return { commands, skipped: [{ title: 'Every command', reason: `${err.message}.` }], unverified };
  }
  const attempt = (title: string, build: () => Command[]) => {
    try {
      commands.push(...build());
    } catch (err) {
      if (!(err instanceof NoCommand)) throw err;
      skipped.push({ title, reason: `${err.message[0].toUpperCase()}${err.message.slice(1)}.` });
    }
  };
  const { policy } = report;

  // The signature over the image.
  const signature = image.evidence.signature;
  if (signature.status === 'verified') {
    attempt(label('signature'), () => {
      const identity = identityFor(policy, signature.signer);
      return [
        {
          title: label('signature'),
          purpose: `Checks the image's signature against the trusted signer.${signerNote(identity)}`,
          text: shellLine(['cosign', 'verify'], [...identityArgs(identity), ref]),
        },
      ];
    });
  }

  // Each attestation, on the image or on each platform image it is attached to.
  for (const kind of ATTESTATION_KINDS) {
    const item = image.evidence[kind];
    if (item.status !== 'verified' || (kind === 'tests' && (item.source === 'recipe' || testsInRecord))) continue;
    attempt(label(kind), () => {
      if (!item.predicateType) throw new UnsafeValue("the report doesn't say which predicate type it is");
      const identity = identityFor(policy, item.signer);
      const type = flag('--type', item.predicateType, 'the predicate type');
      return targets(image, item).map((t) => ({
        title: t.platform ? `${label(kind)} (${t.platform})` : label(kind),
        purpose: `${ATTESTATION_PURPOSE[kind]}${kind === 'rebase' && testsInRecord ? TESTS_IN_RECORD : ''}${signerNote(identity)}`,
        text: shellLine(['cosign', 'verify-attestation'], [type, ...identityArgs(identity), t.ref]),
      }));
    });
  }

  // GitHub's artifact attestations, with GitHub's own verifier too.
  for (const kind of ATTESTATION_KINDS) {
    const item = image.evidence[kind];
    if (item.status !== 'verified' || item.source !== 'github-attestation' || (kind === 'tests' && testsInRecord)) continue;
    const title = `${label(kind)} (GitHub)`;
    attempt(title, () => {
      const identity = identityFor(policy, item.signer);
      const workflow = item.signer?.identity !== undefined ? GITHUB_WORKFLOW.exec(item.signer.identity) : null;
      // The repository whose run made it: the certificate's, or for one that
      // doesn't record it, the signing workflow's own.
      const certRepo = item.signer?.sourceRepository !== undefined ? GITHUB_REPO.exec(item.signer.sourceRepository)?.[1] : undefined;
      const repository = certRepo ?? identity.repository ?? workflow?.[1];
      if (!repository) throw new NoCommand('the run that made it is not in a GitHub repository');
      const args = ['--bundle-from-oci', flag('--repo', repository, 'the repository')];
      // The workflow that signed, as clearcutt-verify recorded it; from an
      // older clearcutt-verify, read from the identity when it is a reusable
      // workflow in another repository, which gh otherwise rejects.
      const signerWorkflow = item.signerWorkflow ?? (workflow && workflow[1] !== repository ? `${workflow[1]}/${workflow[2]}` : undefined);
      if (signerWorkflow !== undefined) args.push(flag('--signer-workflow', signerWorkflow, 'the signing workflow'));
      const sourceRef = identity.flags.find(([name]) => name === '--certificate-github-workflow-ref')?.[1];
      if (sourceRef !== undefined) args.push(flag('--source-ref', sourceRef, 'the source ref'));
      if (item.predicateType && item.predicateType !== 'https://slsa.dev/provenance/v1') {
        args.push(flag('--predicate-type', item.predicateType, 'the predicate type'));
      }
      return targets(image, item).map((t) => ({
        title: t.platform ? `${title} (${t.platform})` : title,
        purpose:
          "Checks GitHub's artifact attestation with GitHub's own verifier, reading it from the registry: made by a workflow run in that repository" +
          (signerWorkflow !== undefined ? ', signed by that workflow.' : '.'),
        text: shellLine(['gh', 'attestation', 'verify'], [`oci://${t.ref}`, ...args]),
      }));
    });
  }

  // A clearcutt-factory image: rebuild it from its signed recipe, or repeat its signed rebase.
  const factoryEvidence = image.evidence.recipe.status === 'verified' ? image.evidence.recipe : image.evidence.rebase.status === 'verified' ? image.evidence.rebase : undefined;
  if (image.factory && factoryEvidence) {
    attempt('Rebuild', () => {
      const identity = identityFor(policy, factoryEvidence.signer);
      const rebased = factoryEvidence === image.evidence.rebase;
      const unchecked = identity.flags.some(([name]) => name === '--certificate-github-workflow-ref');
      return [
        {
          title: rebased ? 'Repeat the rebase' : 'Rebuild',
          purpose:
            (rebased
              ? 'Repeats the rebase its signed rebase record describes, and checks that it gives this digest again.'
              : 'Rebuilds the image from its signed recipe, without a cache, and checks that the rebuild has this digest. It needs Docker or Podman.') +
            (unchecked ? ' clearcutt-factory takes no source-ref flag; the cosign commands above check the ref.' : '') +
            (identity.noTlog ? ' --insecure-ignore-tlog, for a key that signs without a transparency log, needs a clearcutt-factory release after v0.1.1.' : ''),
          text: shellLine(
            ['clearcutt-factory', 'verify'],
            [
              flag('--image', ref),
              ...identityArgs(identity, ['--certificate-github-workflow-ref', '--insecure-ignore-tlog']),
              // A boolean flag of clearcutt-factory's own, which takes --key.
              ...(identity.noTlog ? ['--insecure-ignore-tlog'] : []),
            ],
          ),
        },
      ];
    });
  }

  // The verdict, from scratch, under the same policy.
  attempt('Verdict', () => {
    // The platforms the run read: its --platforms selection when it made
    // one (metadata.platforms), else every platform image of this one.
    const platforms = report.metadata.platforms ?? image.platforms.map((p) => p.platform);
    for (const p of platforms) if (!PLATFORM.test(p)) throw new UnsafeValue(`the platform ${JSON.stringify(p)} isn't os/arch[/variant]`);
    const policyJson = shellWord(policyFile(policy), "the report's policy");
    const run = [
      flag('--refs', 'refs.txt'),
      flag('--policy', 'policy.json'),
      ...(platforms.length > 0 ? [flag('--platforms', platforms.join(','))] : []),
      // The run scanned verified SBOMs itself; so does this (it needs grype).
      ...(policy.rescan ? ['--rescan'] : []),
      flag('--out', 'estate'),
    ];
    const vex = policy.vex ?? [];
    return [
      {
        title: 'Verdict',
        purpose:
          "Runs clearcutt-verify over this image alone, in a new directory, held to the policy this report was held to, and writes its own report to estate/estate-report.json. Its verdict should match this page's, though one image on its own can't show how far behind its base's newest version it is." +
          (policy.rescan ? ' It rescans the image with grype, as this run did, against a database of the day you run it.' : '') +
          (vex.length > 0
            ? ` This run applied ${vex.length === 1 ? 'a VEX document' : `${vex.length} VEX documents`} the report names but doesn't carry (the policy above lists them): put ${vex.length === 1 ? 'it' : 'them'} beside policy.json and add "vex": [${vex.length === 1 ? 'its file' : 'their files'}] to it, or the findings ${vex.length === 1 ? 'it suppresses' : 'they suppress'} will count.`
            : ''),
        text: [
          'cd "$(mktemp -d)"',
          `printf '%s\\n' ${ref} > refs.txt`,
          `printf '%s\\n' ${policyJson} > policy.json`,
          shellLine(['clearcutt-verify', 'estate', 'verify'], run),
        ].join('\n'),
      },
    ];
  });

  return { ref, commands, skipped, unverified };
}

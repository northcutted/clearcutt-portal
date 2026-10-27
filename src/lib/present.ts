// How the contract's vocabulary is shown. Every status maps to a label, a
// tone, and a sentence saying what it means, so a page never has to decide on
// its own whether something counts as proven.
//
// Tones, from the contract's "Show it as" column:
//   good     proven: verified evidence, a layer-digest base, a reproduced build
//   claim    exists but unproven: present evidence, a base someone declared
//   warn     absent or behind: missing evidence, a stale base
//   bad      a check failed
//   unknown  couldn't be determined; never shown as zero, absent, or a pass
//   muted    doesn't apply
import type {
  BaseLink,
  Evidence,
  EvidenceItem,
  Finding,
  Policy,
  Reproducibility,
  ReproducibilityCounts,
  Rescan,
  Verdict,
  Vulnerabilities,
} from './contract.gen.ts';

export type Tone = 'good' | 'claim' | 'warn' | 'bad' | 'unknown' | 'muted';

export interface Term {
  label: string;
  /** A shorter label for dense tables; defaults to label. */
  short?: string;
  tone: Tone;
  meaning: string;
}

/** A glyph per tone, so no status is told apart by color alone. */
export const TONE_GLYPH: Record<Tone, string> = {
  good: '✓',
  claim: '○',
  warn: '!',
  bad: '✕',
  unknown: '?',
  muted: '–',
};

/** Shown for values this portal doesn't know (open enums, newer v1 fields). */
function asIs(value: string): Term {
  return { label: value, tone: 'unknown', meaning: `"${value}" is not a value this version of the portal knows.` };
}

export type EvidenceKind = keyof Evidence;

export const EVIDENCE_KINDS: { key: EvidenceKind; label: string; short: string; meaning: string }[] = [
  { key: 'signature', label: 'Signature', short: 'Sig', meaning: 'A signature over the image itself.' },
  { key: 'sbom', label: 'SBOM', short: 'SBOM', meaning: 'A software bill of materials (CycloneDX or SPDX).' },
  {
    key: 'vulnerabilityScan',
    label: 'Vulnerability report',
    short: 'Vulns',
    meaning: 'A vulnerability report about the image.',
  },
  { key: 'provenance', label: 'SLSA provenance', short: 'Prov', meaning: 'Build provenance: what built the image, from which source.' },
  {
    key: 'recipe',
    label: 'Recipe',
    short: 'Recipe',
    meaning: 'A clearcutt-factory recipe: everything needed to rebuild the image bit for bit.',
  },
  {
    key: 'rebase',
    label: 'Rebase record',
    short: 'Rebase',
    meaning: "A clearcutt-factory rebase record: the image's layers were moved onto a newer base without a rebuild.",
  },
  {
    key: 'tests',
    label: 'Tests',
    short: 'Tests',
    meaning: 'Evidence that the image was tested: a test attestation, the smoke test a verified rebase record says passed, or one a recipe declares.',
  },
];

const EVIDENCE_STATUS: Record<EvidenceItem['status'], Term> = {
  verified: {
    label: 'Verified',
    tone: 'good',
    meaning: 'Found, and checked against a trusted signer in the policy.',
  },
  present: {
    label: 'Present, unverified',
    short: 'Present',
    tone: 'claim',
    meaning: "Found, but not checked: no trusted signer applies, or it can't be checked. It exists; it isn't proven.",
  },
  failed: {
    label: 'Failed',
    tone: 'bad',
    meaning: 'Found, and the check failed: a wrong signer, a bad signature, or a digest mismatch.',
  },
  missing: { label: 'Missing', tone: 'warn', meaning: 'Looked for, and there is none.' },
  unknown: {
    label: 'Unknown',
    tone: 'unknown',
    meaning: "Couldn't be looked for (a registry error or an unsupported store). Not absent, and not a pass.",
  },
  'not-applicable': { label: 'Not applicable', short: 'n/a', tone: 'muted', meaning: "Doesn't apply to this image." },
};

export function evidenceStatus(status: string): Term {
  return EVIDENCE_STATUS[status as EvidenceItem['status']] ?? asIs(status);
}

/**
 * A smoke test the recipe declares: present, but nothing attests that it ran,
 * so it reads as what it is rather than as a generic "present".
 */
export const DECLARED_TEST: Term = {
  label: 'Declared in recipe',
  short: 'Declared',
  tone: 'claim',
  meaning:
    "The image's verified recipe declares a smoke test, which clearcutt-factory runs on every platform before it pushes, and it pushes nothing that fails. Nothing attests that the test ran, so it is a claim, not proof.",
};

const BUILDER_CHECKED: Term = {
  label: 'Builder checked',
  tone: 'good',
  meaning: "The policy names the builders provenance must come from (provenanceBuilders), and this verified provenance names one of them.",
};
const BUILDER_READ: Term = {
  label: 'Builder read, not checked',
  tone: 'claim',
  meaning:
    "Read from provenance whose signature verified, but not evaluated: the policy names no builders it must come from. The signature proves who signed the provenance and that it is about this image, not which builder ran or how.",
};

/** What a run did with the builder its verified provenance names (images[].provenance.builderChecked). */
export function provenanceBuilder(provenance: { builderChecked?: boolean }): Term {
  return provenance.builderChecked === true ? BUILDER_CHECKED : BUILDER_READ;
}

/** The predicate types of a clearcutt-factory rebase record (and its earlier name). */
const REBASE_PREDICATES = new Set([
  'https://github.com/northcutted/clearcutt-factory/rebase/v1',
  'https://github.com/northcutted/declarative-image-factory/rebase/v1',
]);

/**
 * Whether an image's test evidence is the smoke test its rebase record
 * says ran (clearcutt-verify v0.17.0): it points at the record, so checking
 * the record checks it.
 */
export function testsInRebaseRecord(evidence: Evidence): boolean {
  const type = evidence.tests.predicateType;
  return type !== undefined && (REBASE_PREDICATES.has(type) || type === evidence.rebase.predicateType);
}

/** An evidence item's status, said for what the item is. */
export function evidenceTerm(kind: EvidenceKind, item: EvidenceItem): Term {
  if (kind === 'tests' && item.status === 'present' && item.source === 'recipe') return DECLARED_TEST;
  return evidenceStatus(item.status);
}

const EVIDENCE_SOURCE: Record<string, string> = {
  'cosign-signature': 'cosign signature',
  'cosign-attestation': 'cosign attestation',
  'github-attestation': 'GitHub attestation',
  'oci-referrer': 'OCI referrer (unsigned)',
  recipe: 'declared in the recipe',
};

/** Where an evidence item was found, in words; unknown sources as they are. */
export function evidenceSource(value: string): string {
  return EVIDENCE_SOURCE[value] ?? value;
}

/** The evidence kind's label, e.g. "SBOM" for sbom; unknown kinds as they are. */
export function evidenceKindLabel(key: string): string {
  return EVIDENCE_KINDS.find((k) => k.key === key)?.label ?? key;
}

const VERDICT: Record<Verdict['status'], Term> = {
  verified: { label: 'Verified', tone: 'good', meaning: 'Meets every requirement in the policy.' },
  failed: { label: 'Failed', tone: 'bad', meaning: 'Violates at least one requirement in the policy.' },
  unverified: {
    label: 'Unverified',
    tone: 'unknown',
    meaning: "At least one requirement couldn't be decided. Not a pass, and not a failure.",
  },
};

export function verdict(status: string): Term {
  return VERDICT[status as Verdict['status']] ?? asIs(status);
}

/** An image the policy observes without gating on it (images[].observeOnly). */
export const OBSERVE_ONLY: Term = {
  label: 'Observe-only',
  tone: 'muted',
  meaning:
    "The policy observes this image without gating on it (policy.observe): it has a verdict like any other, but isn't counted in the estate's verdicts and doesn't fail the run.",
};

const STRENGTH: Record<BaseLink['strength'], Term> = {
  proof: {
    label: 'Proven',
    tone: 'good',
    meaning: "The image starts with the base's exact layer digests. This compares content, so it holds whatever the image says about itself.",
  },
  declared: {
    label: 'Declared',
    tone: 'claim',
    meaning: "An exact claim the image's author wrote (a label or annotation naming the base). Not checked against the layers.",
  },
  assisted: {
    label: 'Assisted',
    tone: 'claim',
    meaning: "A partial claim by the image's author: it names the base repository but not the version.",
  },
  weak: {
    label: 'Weak',
    tone: 'claim',
    meaning: "The base repository appears in the image's build history. A hint, not evidence.",
  },
};

export function strength(value: string): Term {
  return STRENGTH[value as BaseLink['strength']] ?? asIs(value);
}

const METHOD: Record<BaseLink['method'], string> = {
  'layer-prefix': 'layer digests',
  'oci-base-digest': 'OCI base-digest annotation',
  'buildpacks-metadata': 'Buildpacks metadata',
  'oci-base-name': 'OCI base-name annotation',
  history: 'build history',
};

export function method(value: string): string {
  return METHOD[value as BaseLink['method']] ?? value;
}

const DRIFT: Record<BaseLink['drift'], Term> = {
  current: {
    label: 'Current',
    tone: 'good',
    meaning: 'On the newest version of its base observed in this run.',
  },
  stale: {
    label: 'Stale',
    tone: 'warn',
    meaning: 'A newer version of its base was observed in this run.',
  },
  unknown: {
    label: 'Unknown',
    tone: 'unknown',
    meaning: "Whether a newer version of its base exists couldn't be determined.",
  },
};

export function drift(value: string): Term {
  return DRIFT[value as BaseLink['drift']] ?? asIs(value);
}

const REPRODUCIBILITY: Record<Reproducibility['status'], Term> = {
  reproduced: { label: 'Reproduced', tone: 'good', meaning: 'Rebuilt, and the rebuild has the same digest.' },
  'not-reproduced': {
    label: 'Not reproduced',
    tone: 'bad',
    meaning: 'Rebuilt, and the rebuild has a different digest.',
  },
  'not-checked': {
    label: 'Not checked',
    tone: 'unknown',
    meaning: "A recipe exists, but this run didn't rebuild the image, or the rebuild couldn't finish.",
  },
  'no-recipe': { label: 'No recipe', tone: 'muted', meaning: 'Nothing to rebuild from, so reproducibility is not known.' },
};

export function reproducibility(status: string): Term {
  return REPRODUCIBILITY[status as Reproducibility['status']] ?? asIs(status);
}

/**
 * The tone of the estate's "Reproduced" count. Good only when every image
 * with a recipe or rebase record reproduced; any that didn't is bad; none to
 * rebuild doesn't apply; otherwise some (or all) weren't checked, which is
 * unknown, never a pass: zero reproduced is not green.
 */
export function reproducedTone(c: ReproducibilityCounts): Tone {
  const withRecipe = c.reproduced + c.notReproduced + c.notChecked;
  if (c.notReproduced > 0) return 'bad';
  if (withRecipe === 0) return 'muted';
  return c.reproduced === withRecipe ? 'good' : 'unknown';
}

const REPRO_METHOD: Record<NonNullable<Reproducibility['method']>, string> = {
  'recipe-rebuild': 'rebuilt from the signed recipe',
  'rebase-repeat': 'repeated the recorded rebase',
};

const REPRO_SOURCE: Record<NonNullable<Reproducibility['source']>, string> = {
  rebuild: 'this run, which rebuilt it',
  attestation: "a clearcutt-factory reproduction attestation, verified against a trusted signer; this run didn't rebuild it",
};

/** Where a reproducibility result comes from, in words; unknown values as they are. */
export function reproSource(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return REPRO_SOURCE[value as NonNullable<Reproducibility['source']>] ?? value;
}

export function reproMethod(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return REPRO_METHOD[value as NonNullable<Reproducibility['method']>] ?? value;
}

const VULN_SOURCE: Record<Vulnerabilities['source'], string> = {
  attestation: "the publisher's signed report",
  scan: "this run's own scan",
};

export function vulnSource(value: string): string {
  return VULN_SOURCE[value as Vulnerabilities['source']] ?? value;
}

const RESCAN: Record<Rescan['status'], Term> = {
  scanned: {
    label: 'Scanned',
    tone: 'good',
    meaning: "This run scanned the verified SBOM of every platform image itself, against a vulnerability database of its day.",
  },
  unknown: {
    label: "Couldn't check",
    tone: 'unknown',
    meaning:
      "This run couldn't scan every platform image's verified SBOM (one has none, a platform image couldn't be read, or the scanner failed), so the image's current vulnerabilities are unknown. Not clean, and not a pass.",
  },
};

/** This run's own scan of an image (images[].rescan.status, and its per-platform statuses). */
export function rescanStatus(status: string): Term {
  return RESCAN[status as Rescan['status']] ?? asIs(status);
}

const SCAN_SOURCE: Record<NonNullable<Policy['scanSource']>, string> = {
  attestation: "the publisher's scan, attested when the image was built",
  rescan: "this run's own scan",
  worst: "both scans: an image fails when either finds enough, and is unverified when either is unknown",
};

/** Which scan the policy's failOn gated on (policy.scanSource), in words; unknown values as they are. */
export function scanSourceWords(value: string): string {
  return SCAN_SOURCE[value as NonNullable<Policy['scanSource']>] ?? `"${value}", which this version of the portal doesn't know`;
}

const SCAN_SOURCE_SHORT: Record<NonNullable<Policy['scanSource']>, string> = {
  attestation: "the publisher's scan",
  rescan: "this run's scan",
  worst: 'both scans',
};

/** The scans the policy gated on, in a few words: "both scans". */
export function scanSourceShort(value: string): string {
  return SCAN_SOURCE_SHORT[value as NonNullable<Policy['scanSource']>] ?? `the "${value}" scan`;
}

/**
 * The scan whose findings policy.failOn gated on: the policy's scanSource,
 * else what clearcutt-verify defaults to (worst with a rescan, the
 * publisher's scan without one).
 */
export function gatingScan(policy: Policy): string {
  return policy.scanSource ?? (policy.rescan ? 'worst' : 'attestation');
}

/** A suppressed finding: what suppressed it, as a statement someone wrote, not a check. */
export const SUPPRESSED: Term = {
  label: 'Suppressed',
  tone: 'claim',
  meaning:
    "A VEX statement, or a rule of the scanner's own, says this finding doesn't apply, so the report doesn't count it. It is a statement someone made, not a check: the finding stays listed.",
};

/** What suppressed a finding, in a sentence. */
export function suppressionWords(finding: Finding): string {
  const by = finding.suppressedBy;
  if (!by) {
    return 'The scan suppressed it; attribution is unavailable or differs between platforms.';
  }
  if (by.source === 'scanner') {
    return `A rule of the scanner's own${by.justification ? `: ${by.justification}` : ''}.`;
  }
  const doc = [by.file, by.document && by.document !== by.file ? `(${by.document})` : undefined].filter(Boolean).join(' ');
  const statement = [by.status, by.justification].filter(Boolean).join(', ');
  if (by.source === 'vex') {
    return `A VEX statement${doc ? `${by.file ? ' in ' : ' '}${doc}` : ''}${statement ? `: ${statement}` : ''}${by.product ? `, about ${by.product}` : ''}.`;
  }
  return `${by.source}${doc ? ` ${doc}` : ''}${statement ? `: ${statement}` : ''}.`;
}

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'negligible', 'unknown'] as const;
export type Severity = (typeof SEVERITIES)[number];

const SOURCE_BASIS: Record<string, Term> = {
  provenance: { label: 'From provenance', tone: 'good', meaning: 'Read from build provenance that verified.' },
  label: { label: 'Label', tone: 'claim', meaning: "Read from a label the image's author wrote." },
  annotation: { label: 'Annotation', tone: 'claim', meaning: "Read from an annotation the image's author wrote." },
};

export function sourceBasis(value: string): Term {
  return SOURCE_BASIS[value] ?? asIs(value);
}

/** Whether an app's stack version is the one the stack's tag names now. */
export function stackVersionTerm(version: { current: boolean }, tagRead: boolean): Term {
  if (version.current) {
    return { label: 'Current', tone: 'good', meaning: "Pinned to the version the stack's tag names now." };
  }
  if (!tagRead) {
    return {
      label: 'Currency unknown',
      tone: 'unknown',
      meaning: "The stack's tag couldn't be read, so whether this is its newest version is unknown.",
    };
  }
  return {
    label: 'Older version',
    tone: 'warn',
    meaning: "Pinned to a version other than the one the stack's tag names now.",
  };
}

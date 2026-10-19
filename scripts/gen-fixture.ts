// Writes a synthetic bundle for scale tests: an estate of N images with R runs
// of history, shaped like what clearcutt-verify writes (bases, evidence of
// every status, shared advisories and packages, per-image history rows), and
// valid against the vendored contract. Deterministic for a given seed.
//
// Usage: node scripts/gen-fixture.ts --out DIR [--images 500] [--runs 1000] [--seed 1]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import type {
  EstateHistory,
  EstateReport,
  EvidenceItem,
  Finding,
  HistoryImage,
  Image,
  PackageUse,
  SeverityCounts,
  Summary,
} from '../src/lib/contract.gen.ts';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    images: { type: 'string', default: '500' },
    runs: { type: 'string', default: '1000' },
    seed: { type: 'string', default: '1' },
  },
});
if (!values.out) {
  console.error('usage: node scripts/gen-fixture.ts --out DIR [--images 500] [--runs 1000] [--seed 1]');
  process.exit(2);
}
const N = Number(values.images);
const R = Number(values.runs);

// mulberry32: small, fast, and the same everywhere.
let state = Number(values.seed) >>> 0;
function random(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
const chance = (p: number) => random() < p;
const digest = (seed: string) => `sha256:${createHash('sha256').update(seed).digest('hex')}`;
const pad = (n: number, width = 4) => String(n).padStart(width, '0');

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'negligible', 'unknown'] as const;
const GHSA = '23456789cfghjmpqrvwx';
const ghsaPart = () => Array.from({ length: 4 }, () => pick([...GHSA])).join('');

// Shared pools, so advisories and packages repeat across images as they do
// in a real estate.
const ADVISORIES = Array.from({ length: 1500 }, (_, i) => {
  const kind = i % 3;
  const id = kind === 0 ? `CVE-2026-${10000 + i}` : kind === 1 ? `GHSA-${ghsaPart()}-${ghsaPart()}-${ghsaPart()}` : `GO-2026-${5000 + i}`;
  const severity = pick(['critical', 'high', 'high', 'medium', 'medium', 'medium', 'low', 'negligible', 'unknown'] as const);
  return { id, severity, fixed: chance(0.7) };
});
const TYPES = ['apk', 'deb', 'npm', 'golang', 'pypi'] as const;
const PACKAGES = Array.from({ length: 1200 }, (_, i) => ({
  type: TYPES[i % TYPES.length],
  name: `pkg-${pad(i)}`,
  versions: Array.from({ length: int(1, 4) }, (_, v) => `${int(0, 3)}.${v}.${int(0, 20)}`),
}));

const ISSUER = 'https://token.actions.githubusercontent.com';
const SIGNER = { identityRegexp: '^https://github\\.com/acme/', issuer: ISSUER };
const STATUSES = ['verified', 'verified', 'verified', 'verified', 'present', 'missing', 'failed', 'unknown'] as const;
const evidence = (status: EvidenceItem['status']): EvidenceItem =>
  status === 'verified'
    ? { status, source: 'cosign-attestation', signer: { identity: 'https://github.com/acme/fleet/.github/workflows/build.yml@refs/heads/main', issuer: ISSUER } }
    : { status, ...(status === 'missing' ? {} : { detail: `synthetic ${status}` }) };

const GENERATED_AT = Date.parse('2026-10-18T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
const BASES = Math.max(1, Math.round(N / 25));

const images: Image[] = [];
const ships = new Map<string, Set<string>>(); // "type\0name\0version" → image ids
for (let i = 0; i < N; i++) {
  const id = `svc-${pad(i)}`;
  const isBase = i < BASES;
  const repository = isBase ? `ghcr.io/acme/bases/base-${pad(i)}` : `ghcr.io/acme/fleet/svc-${pad(i)}`;
  const signature = pick(STATUSES);
  const sbom = pick(STATUSES);
  const scan = chance(0.85) ? 'verified' : pick(['missing', 'present', 'unknown'] as const);
  const provenance = pick(STATUSES);
  const image: Image = {
    id,
    repository,
    digest: digest(`${id}-latest`),
    tags: ['latest'],
    created: iso(GENERATED_AT - int(1, 60) * 86_400_000),
    platforms: [{ platform: 'linux/amd64', digest: digest(`${id}-amd64`), layers: int(3, 30), size: int(1e6, 4e8) }],
    builder: { kind: pick(['clearcutt-factory', 'buildkit', 'apko']), basis: 'synthetic' },
    evidence: {
      signature: evidence(signature),
      sbom: evidence(sbom),
      vulnerabilityScan: evidence(scan),
      provenance: evidence(provenance),
      recipe: evidence(pick(['verified', 'missing'] as const)),
      rebase: evidence(chance(0.1) ? 'verified' : 'not-applicable'),
      tests: evidence(pick(['present', 'missing', 'verified'] as const)),
    },
    reproducibility: { status: pick(['reproduced', 'reproduced', 'not-checked', 'no-recipe', 'not-reproduced'] as const) },
    verdict: { status: 'verified', reasons: [] },
    warnings: [],
  };
  if (isBase) {
    image.root = 'synthetic base image';
  } else if (chance(0.95)) {
    const base = int(0, BASES - 1);
    const stale = chance(0.3);
    image.base = {
      imageId: `svc-${pad(base)}`,
      repository: `ghcr.io/acme/bases/base-${pad(base)}`,
      ref: `ghcr.io/acme/bases/base-${pad(base)}:latest`,
      digest: digest(`svc-${pad(base)}-${stale ? 'old' : 'latest'}`),
      method: 'layer-prefix',
      strength: chance(0.9) ? 'proof' : 'declared',
      drift: stale ? 'stale' : 'current',
      versionsBehind: stale ? int(1, 5) : 0,
      daysBehind: stale ? int(1, 90) : 0,
    };
  } else {
    image.unresolved = ['synthetic: no observed layers are a prefix of this image'];
  }
  if (scan === 'verified') {
    const findings: Finding[] = [];
    for (const a of new Set(Array.from({ length: int(0, 40) }, () => pick(ADVISORIES)))) {
      const pkg = pick(PACKAGES);
      findings.push({
        id: a.id,
        severity: a.severity,
        package: pkg.name,
        version: pkg.versions[0],
        ...(a.fixed ? { fixedIn: [`${pkg.versions[0]}-fixed`] } : {}),
        platforms: ['linux/amd64'],
        ...(chance(0.03) ? { suppressed: true } : {}),
      });
    }
    const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as unknown as SeverityCounts;
    const fixable = { ...counts };
    for (const f of findings.filter((f) => !f.suppressed)) {
      counts[f.severity]++;
      if (f.fixedIn) fixable[f.severity]++;
    }
    image.vulnerabilities = {
      source: 'attestation',
      scanner: 'grype 0.118.0',
      scannedAt: iso(GENERATED_AT - int(1, 20 * 24) * 3_600_000),
      counts,
      fixable,
      findings,
    };
  }
  if (sbom === 'verified') {
    const own = new Set(Array.from({ length: int(30, 200) }, () => int(0, PACKAGES.length - 1)));
    for (const p of own) {
      const pkg = PACKAGES[p];
      const key = `${pkg.type}\u0000${pkg.name}\u0000${pick(pkg.versions)}`;
      if (!ships.has(key)) ships.set(key, new Set());
      ships.get(key)!.add(id);
    }
    image.packages = own.size;
    image.packagesSource = { evidence: 'sbom', status: 'verified', platforms: ['linux/amd64'] };
  }
  // The verdict, roughly as clearcutt-verify's policy reaches it.
  const failed: string[] = [];
  const unverified: string[] = [];
  for (const [kind, item] of Object.entries({ signature: image.evidence.signature, sbom: image.evidence.sbom, provenance: image.evidence.provenance })) {
    if (item.status === 'missing') failed.push(`${kind} is missing`);
    else if (item.status === 'failed') failed.push(`${kind} failed verification`);
    else if (item.status === 'present') unverified.push(`${kind} is present but not verified`);
    else if (item.status === 'unknown') unverified.push(`${kind} is unknown (couldn't be read)`);
  }
  if (!image.vulnerabilities) unverified.push('vulnerabilities are unknown (no scan)');
  else if (image.vulnerabilities.fixable.critical > 0) failed.push(`${image.vulnerabilities.fixable.critical} fixable vulnerabilities at critical or above`);
  if (image.base && image.base.daysBehind > 60) failed.push(`base is ${image.base.daysBehind} days behind its newest version (limit 60)`);
  image.verdict = failed.length > 0 ? { status: 'failed', reasons: [...failed, ...unverified] } : unverified.length > 0 ? { status: 'unverified', reasons: unverified } : { status: 'verified', reasons: [] };
  images.push(image);
}

const packages: PackageUse[] = [...ships].map(([key, ids]) => {
  const [type, name, version] = key.split('\u0000');
  return { type, name, version, purl: `pkg:${type}/${name}@${version}`, images: [...ids].sort() };
});

function summarize(list: Image[]): Summary {
  const count = <T extends string>(values: T[], keys: readonly T[]) => Object.fromEntries(keys.map((k) => [k, values.filter((v) => v === k).length]));
  const evidenceKeys = ['signature', 'sbom', 'vulnerabilityScan', 'provenance', 'recipe', 'rebase', 'tests'] as const;
  const statusKey = (s: string) => (s === 'not-applicable' ? 'notApplicable' : s);
  const scanned = list.filter((i) => i.vulnerabilities);
  const total = (field: 'counts' | 'fixable') =>
    Object.fromEntries(SEVERITIES.map((s) => [s, scanned.reduce((n, i) => n + i.vulnerabilities![field][s], 0)])) as unknown as SeverityCounts;
  const repro = list.map((i) => i.reproducibility.status);
  return {
    images: list.length,
    verdicts: count(list.map((i) => i.verdict.status), ['verified', 'failed', 'unverified'] as const) as unknown as Summary['verdicts'],
    evidence: Object.fromEntries(
      evidenceKeys.map((k) => [
        k,
        count(list.map((i) => statusKey(i.evidence[k].status)), ['verified', 'present', 'failed', 'missing', 'unknown', 'notApplicable']),
      ]),
    ) as unknown as Summary['evidence'],
    bases: {
      proven: list.filter((i) => i.base?.strength === 'proof').length,
      claimed: list.filter((i) => i.base && i.base.strength !== 'proof').length,
      unresolved: list.filter((i) => i.unresolved).length,
      roots: list.filter((i) => i.root).length,
      current: list.filter((i) => i.base?.drift === 'current').length,
      stale: list.filter((i) => i.base?.drift === 'stale').length,
    },
    vulnerabilities: { counts: total('counts'), fixable: total('fixable'), scanned: scanned.length, notScanned: list.length - scanned.length },
    packages: { known: list.filter((i) => i.packages !== undefined).length, unknown: list.filter((i) => i.packages === undefined).length },
    reproducibility: {
      reproduced: repro.filter((s) => s === 'reproduced').length,
      notReproduced: repro.filter((s) => s === 'not-reproduced').length,
      notChecked: repro.filter((s) => s === 'not-checked').length,
      noRecipe: repro.filter((s) => s === 'no-recipe').length,
    },
  };
}

const report: EstateReport = {
  apiVersion: 'clearcutt.dev/v1',
  kind: 'EstateReport',
  metadata: {
    name: `synthetic-${N}`,
    generatedAt: iso(GENERATED_AT),
    generator: { name: 'clearcutt-verify', version: 'dev' },
    sources: [{ registry: 'ghcr.io', namespace: 'acme' }],
  },
  policy: {
    required: ['signature', 'sbom', 'provenance'],
    trustedSigners: [SIGNER],
    failOn: 'critical',
    onlyFixed: true,
    maxDaysBehind: 60,
    reproduce: false,
  },
  bases: Array.from({ length: BASES }, (_, b) => ({
    repository: `ghcr.io/acme/bases/base-${pad(b)}`,
    currentRef: `ghcr.io/acme/bases/base-${pad(b)}:latest`,
    currentDigest: digest(`svc-${pad(b)}-latest`),
    versions: 2,
    consumers: images.filter((i) => i.base?.imageId === `svc-${pad(b)}`).length,
    staleConsumers: images.filter((i) => i.base?.imageId === `svc-${pad(b)}` && i.base.drift === 'stale').length,
  })),
  images,
  packages,
  summary: summarize(images),
  warnings: [],
};

// History, newest first: a run every six hours. Each run is this report's
// images, with digests, verdicts, and counts drifting further back in time.
const severeIds = (image: Image) =>
  [...new Set((image.vulnerabilities?.findings ?? []).filter((f) => !f.suppressed && f.fixedIn && (f.severity === 'critical' || f.severity === 'high')).map((f) => f.id))].sort();
const entries: EstateHistory['entries'] = [];
for (let r = 0; r < R; r++) {
  const at = GENERATED_AT - r * 6 * 3_600_000;
  const rows: HistoryImage[] = images.map((image, i) => {
    // An image gets a new digest every ~40 runs, at its own phase.
    const epoch = Math.floor((r + (i % 40)) / 40);
    const v = image.vulnerabilities?.counts;
    return {
      id: image.id,
      digest: epoch === 0 ? image.digest : digest(`${image.id}-${epoch}`),
      verdict: (r + i) % 97 === 0 ? 'failed' : image.verdict.status,
      ...(image.base ? { base: { digest: image.base.digest, drift: (r + i) % 13 === 0 ? 'stale' : image.base.drift, strength: image.base.strength } } : {}),
      ...(v ? { vulnerabilities: { ...v, high: v.high + (epoch % 3) }, fixableFindings: severeIds(image) } : {}),
      ...(image.packages !== undefined ? { packagesDigest: digest(`${image.id}-packages-${epoch}`) } : {}),
    };
  });
  entries.push({ generatedAt: iso(at), ref: `ghcr.io/acme/estate@${digest(`run-${r}`)}`, summary: report.summary, images: rows });
}
const history: EstateHistory = { apiVersion: 'clearcutt.dev/v1', kind: 'EstateHistory', name: report.metadata.name, entries };

mkdirSync(values.out, { recursive: true });
writeFileSync(path.join(values.out, 'estate-report.json'), JSON.stringify(report));
// Written a run at a time: the whole history can be larger than a string can be.
const historyFile = path.join(values.out, 'estate-history.json');
writeFileSync(historyFile, `{"apiVersion":"clearcutt.dev/v1","kind":"EstateHistory","name":${JSON.stringify(history.name)},"entries":[`);
for (const [i, entry] of entries.entries()) writeFileSync(historyFile, `${i > 0 ? ',' : ''}${JSON.stringify(entry)}`, { flag: 'a' });
writeFileSync(historyFile, ']}\n', { flag: 'a' });
console.log(`${values.out}: ${N} images, ${packages.length} package versions, ${R} runs`);

// Reads and validates a bundle: the directory clearcutt-verify writes, with
// estate-report.json and optionally estate-history.json. The vendored JSON
// Schemas in contract/ are the only definition of what those files hold, and
// a bundle that doesn't match them stops the build rather than rendering a
// page that might say something the data doesn't.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import reportSchema from '../../contract/estate-report.v1.schema.json' with { type: 'json' };
import historySchema from '../../contract/estate-history.v1.schema.json' with { type: 'json' };
import { CONTRACT_UPSTREAM, type EstateHistory, type EstateReport } from './contract.gen.ts';
import { compareVersions } from './versions.ts';

export const API_VERSION = 'clearcutt.dev/v1';
export const REPORT_FILE = 'estate-report.json';
export const HISTORY_FILE = 'estate-history.json';

export interface Bundle {
  dir: string;
  report: EstateReport;
  /** Null when the bundle has no history file. */
  history: EstateHistory | null;
  /** What in the bundle this portal's contract doesn't cover. */
  notes: ContractNotes;
}

/**
 * What a bundle holds that the vendored contract doesn't describe. v1 grows
 * only by adding fields, so a newer report still validates, but the pages
 * can't show what this portal doesn't know: the build says so (on the
 * console, and in every page's footer) instead of dropping it silently.
 */
export interface ContractNotes {
  /** Fields the contract doesn't define, per file, as paths like images[].evidence.signature.newField. */
  unknownFields: { file: string; paths: string[] }[];
  /** Set when the report was written by a clearcutt-verify release newer than the one the contract is from. */
  newerGenerator?: { version: string; builtAgainst: string };
}

export class BundleError extends Error {
  override name = 'BundleError';
}

// v1 changes only additively, and readers must ignore fields they don't
// know. The schemas forbid unknown properties (they describe exactly what
// one verify release writes), so validate against a copy that allows them:
// a newer v1 report still has to satisfy every rule this portal knows.
function allowUnknownFields(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(allowUnknownFields);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'additionalProperties' && value === false) continue;
    out[key] = allowUnknownFields(value);
  }
  return out;
}

let validators: { report: ValidateFunction; history: ValidateFunction } | null = null;

function getValidators() {
  if (!validators) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    validators = {
      report: ajv.compile(allowUnknownFields(reportSchema) as object),
      history: ajv.compile(allowUnknownFields(historySchema) as object),
    };
  }
  return validators;
}

// The schemas as published, which reject unknown fields: run on a document
// that already passed the lenient copy, their only errors are fields the
// contract doesn't define.
let strict: { report: ValidateFunction; history: ValidateFunction } | null = null;

function getStrict() {
  if (!strict) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    strict = { report: ajv.compile(reportSchema as object), history: ajv.compile(historySchema as object) };
  }
  return strict;
}

/**
 * /images/3/evidence/signature/newField → images[].evidence.signature.newField.
 * A name that isn't a plain identifier is quoted as JSON, so one from a
 * hostile report can't break a log line (or start a workflow command) where
 * the build prints it.
 */
function fieldPath(pointer: string, name: string): string {
  const parts = [...pointer.split('/').slice(1), name].map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  const plain = (p: string) => (/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(p) ? p : JSON.stringify(p));
  return parts.reduce((out, p) => (/^\d+$/.test(p) ? `${out}[]` : out ? `${out}.${plain(p)}` : plain(p)), '');
}

/** The fields of a document its published schema doesn't define, each path once, sorted. */
export function unknownFields(doc: unknown, validate: ValidateFunction): string[] {
  if (validate(doc)) return [];
  const paths = new Set<string>();
  for (const e of validate.errors ?? []) {
    if (e.keyword === 'additionalProperties') paths.add(fieldPath(e.instancePath, String(e.params.additionalProperty)));
  }
  return [...paths].sort();
}

/**
 * Whether a clearcutt-verify version is newer than `release`: a later
 * release, or a build after it (git describe's v0.16.0-3-gabc1234). A
 * version that isn't vX.Y.Z-shaped (a "dev" build) can't be compared and
 * isn't called newer; unknown fields still are.
 */
export function newerThan(version: string, release: string): boolean {
  if (!/^v\d+\.\d+\.\d+$/.test(release)) return false;
  const described = version.match(/^(v?\d+\.\d+\.\d+)-\d+-g[0-9a-f]+$/);
  if (described) return compareVersions(described[1], release, 'semver') >= 0;
  if (!/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(version)) return false;
  return compareVersions(version, release, 'semver') > 0;
}

function contractNotes(files: { file: string; doc: unknown; validate: ValidateFunction }[], report: EstateReport): ContractNotes {
  const notes: ContractNotes = {
    unknownFields: files
      .map(({ file, doc, validate }) => ({ file, paths: unknownFields(doc, validate) }))
      .filter((f) => f.paths.length > 0),
  };
  const generator = report.metadata.generator;
  if (generator.name === 'clearcutt-verify' && newerThan(generator.version, CONTRACT_UPSTREAM.release)) {
    notes.newerGenerator = { version: generator.version, builtAgainst: CONTRACT_UPSTREAM.release };
  }
  return notes;
}

/** The notes in a sentence each, for the console and the footer; none when the contract covers the bundle. */
export function describeNotes(notes: ContractNotes, max = 8): string[] {
  const out: string[] = [];
  for (const { file, paths } of notes.unknownFields) {
    const shown = paths.slice(0, max).join(', ');
    const more = paths.length > max ? `, and ${paths.length - max} more` : '';
    out.push(
      `${file} has ${paths.length === 1 ? 'a field' : `${paths.length} fields`} this portal's contract doesn't define, so no page shows ${paths.length === 1 ? 'it' : 'them'}: ${shown}${more}.`,
    );
  }
  if (notes.newerGenerator) {
    out.push(
      `The report was written by clearcutt-verify ${notes.newerGenerator.version}, newer than ${notes.newerGenerator.builtAgainst}, whose contract this portal was built against.`,
    );
  }
  return out;
}

function describe(errors: ErrorObject[] | null | undefined): string {
  const lines = (errors ?? []).slice(0, 20).map((e) => `  ${e.instancePath || '/'}: ${e.message}`);
  const more = (errors?.length ?? 0) - lines.length;
  if (more > 0) lines.push(`  …and ${more} more`);
  return lines.join('\n');
}

function readDocument<T>(file: string, kind: string, validate: ValidateFunction): T {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new BundleError(`${file}: not valid JSON (${(err as Error).message})`);
  }
  const header = doc as { apiVersion?: unknown; kind?: unknown } | null;
  if (header?.apiVersion !== API_VERSION) {
    throw new BundleError(
      `${file}: apiVersion is ${JSON.stringify(header?.apiVersion)}; this portal reads ${API_VERSION}`,
    );
  }
  if (header.kind !== kind) {
    throw new BundleError(`${file}: kind is ${JSON.stringify(header.kind)}; expected ${kind}`);
  }
  if (!validate(doc)) {
    throw new BundleError(`${file} does not match the ${kind} schema:\n${describe(validate.errors)}`);
  }
  return doc as T;
}

/**
 * What an image ID may look like. Each image's page is images/<id>/, so an ID
 * must be one plain path segment: no slashes, no "..", nothing a file system
 * or a URL treats specially. The schema allows any string; clearcutt-verify
 * writes lowercase letters, digits, and dashes.
 */
export const IMAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// Checks the promises the schema can't express but every page relies on:
// image IDs are safe, unique page names (they are URLs and directories), and
// every ID a report refers to (from a base, a package, or a stack) names an
// image in it. History rows may name images that have since left.
function checkReferences(file: string, report: EstateReport): void {
  const ids = new Set<string>();
  const folded = new Map<string, string>();
  const problems: string[] = [];
  for (const image of report.images) {
    if (!IMAGE_ID.test(image.id)) {
      problems.push(
        `image id ${JSON.stringify(image.id)} can't name a page: use 1 to 128 letters, digits, ".", "_", or "-", starting with a letter or digit`,
      );
    }
    if (ids.has(image.id)) problems.push(`image id ${JSON.stringify(image.id)} appears more than once`);
    ids.add(image.id);
    // Pages are directories, and on a case-insensitive file system these
    // would be the same one.
    const other = folded.get(image.id.toLowerCase());
    if (other !== undefined && other !== image.id) {
      problems.push(`image ids ${JSON.stringify(other)} and ${JSON.stringify(image.id)} differ only in case`);
    }
    folded.set(image.id.toLowerCase(), image.id);
  }
  for (const image of report.images) {
    const baseId = image.base?.imageId;
    if (baseId !== undefined && !ids.has(baseId)) {
      problems.push(`image ${image.id}: base.imageId ${JSON.stringify(baseId)} is not an image in the report`);
    }
  }
  for (const pkg of report.packages) {
    for (const id of pkg.images) {
      if (!ids.has(id)) {
        problems.push(`package ${pkg.name} ${pkg.version}: image ${JSON.stringify(id)} is not an image in the report`);
      }
    }
  }
  for (const stack of report.stacks ?? []) {
    for (const version of stack.versions) {
      for (const id of version.images) {
        if (!ids.has(id)) {
          problems.push(`stack ${stack.repository}: image ${JSON.stringify(id)} is not an image in the report`);
        }
      }
    }
  }
  if (problems.length > 0) {
    const shown = problems.slice(0, 20).map((p) => `  ${p}`);
    if (problems.length > shown.length) shown.push(`  …and ${problems.length - shown.length} more`);
    throw new BundleError(`${file} is inconsistent:\n${shown.join('\n')}`);
  }
}

export function readBundle(dir: string): Bundle {
  const reportFile = path.join(dir, REPORT_FILE);
  if (!existsSync(reportFile)) {
    throw new BundleError(
      `${reportFile}: not found. A bundle is the directory clearcutt-verify writes, with ${REPORT_FILE} in it.`,
    );
  }
  const { report: validateReport, history: validateHistory } = getValidators();
  const report = readDocument<EstateReport>(reportFile, 'EstateReport', validateReport);
  checkReferences(reportFile, report);
  const historyFile = path.join(dir, HISTORY_FILE);
  const history = existsSync(historyFile)
    ? readDocument<EstateHistory>(historyFile, 'EstateHistory', validateHistory)
    : null;
  const files = [{ file: REPORT_FILE, doc: report as unknown, validate: getStrict().report }];
  if (history) files.push({ file: HISTORY_FILE, doc: history, validate: getStrict().history });
  return { dir, report, history, notes: contractNotes(files, report) };
}

/** The environment variable that tells the site which bundle to render. */
export const BUNDLE_ENV = 'CLEARCUTT_PORTAL_BUNDLE';
const DEFAULT_BUNDLE = 'contract/fixtures/northcutted-images';

let cached: Bundle | null = null;

/**
 * The bundle this build renders: $CLEARCUTT_PORTAL_BUNDLE, or the vendored
 * northcutted-images fixture for `astro dev`.
 */
export function loadBundle(): Bundle {
  if (!cached) {
    cached = readBundle(path.resolve(process.env[BUNDLE_ENV] || DEFAULT_BUNDLE));
  }
  return cached;
}

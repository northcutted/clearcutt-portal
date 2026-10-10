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
import type { EstateHistory, EstateReport } from './contract.gen.ts';

export const API_VERSION = 'clearcutt.dev/v1';
export const REPORT_FILE = 'estate-report.json';
export const HISTORY_FILE = 'estate-history.json';

export interface Bundle {
  dir: string;
  report: EstateReport;
  /** Null when the bundle has no history file. */
  history: EstateHistory | null;
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

// Checks the promises the schema can't express but every page relies on:
// image IDs are unique (they are URLs), and every ID a report refers to
// names an image in it.
function checkReferences(file: string, report: EstateReport): void {
  const ids = new Set<string>();
  const problems: string[] = [];
  for (const image of report.images) {
    if (ids.has(image.id)) problems.push(`image id ${JSON.stringify(image.id)} appears more than once`);
    ids.add(image.id);
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
  return { dir, report, history };
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

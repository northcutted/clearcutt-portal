import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..');
export const FIXTURE = path.join(root, 'contract/fixtures/northcutted-images');
export const MINIMAL = path.join(root, 'contract/examples/minimal');

/** A writable copy of a bundle, with its report passed through `edit`. */
export function editedBundle(from: string, edit: (report: any) => void): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'portal-bundle-'));
  cpSync(from, dir, { recursive: true });
  const file = path.join(dir, 'estate-report.json');
  const report = JSON.parse(readFileSync(file, 'utf8'));
  edit(report);
  writeFileSync(file, JSON.stringify(report));
  return dir;
}

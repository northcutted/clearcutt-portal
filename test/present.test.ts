import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Finding, Policy } from '../src/lib/contract.gen.ts';
import { gatingScan, reproducedTone, rescanStatus, scanSourceWords, suppressionWords, type Tone } from '../src/lib/present.ts';

test('the Reproduced count is green only when every image with a recipe reproduced', () => {
  const cases: [string, { reproduced: number; notReproduced: number; notChecked: number; noRecipe: number }, Tone][] = [
    ['all reproduced', { reproduced: 4, notReproduced: 0, notChecked: 0, noRecipe: 4 }, 'good'],
    ['none reproduced, none checked', { reproduced: 0, notReproduced: 0, notChecked: 4, noRecipe: 0 }, 'unknown'],
    ['some not checked', { reproduced: 3, notReproduced: 0, notChecked: 1, noRecipe: 0 }, 'unknown'],
    ['one did not reproduce', { reproduced: 3, notReproduced: 1, notChecked: 0, noRecipe: 0 }, 'bad'],
    ['one did not reproduce, others unchecked', { reproduced: 0, notReproduced: 1, notChecked: 3, noRecipe: 0 }, 'bad'],
    ['nothing to rebuild', { reproduced: 0, notReproduced: 0, notChecked: 0, noRecipe: 5 }, 'muted'],
    ['an empty estate', { reproduced: 0, notReproduced: 0, notChecked: 0, noRecipe: 0 }, 'muted'],
  ];
  for (const [name, counts, want] of cases) assert.equal(reproducedTone(counts), want, name);
});

test('a suppressed finding says what suppressed it, and never that nothing did', () => {
  const finding = (suppressedBy?: Finding['suppressedBy']): Finding => ({
    id: 'CVE-2026-9999',
    severity: 'medium',
    package: 'p',
    version: '1',
    platforms: ['linux/amd64'],
    suppressed: true,
    ...(suppressedBy ? { suppressedBy } : {}),
  });
  const cases: [string, Finding['suppressedBy'], string][] = [
    [
      'a VEX statement, in full',
      { source: 'vex', file: 'vex/acme.json', document: 'https://acme.example/vex/1', product: 'pkg:oci/billing', status: 'not_affected', justification: 'vulnerable_code_not_in_execute_path' },
      'A VEX statement in vex/acme.json (https://acme.example/vex/1): not_affected, vulnerable_code_not_in_execute_path, about pkg:oci/billing.',
    ],
    ['a VEX statement with only its file', { source: 'vex', file: 'vex/acme.json' }, 'A VEX statement in vex/acme.json.'],
    ['a VEX statement whose @id is its file', { source: 'vex', file: 'a.json', document: 'a.json', status: 'fixed' }, 'A VEX statement in a.json: fixed.'],
    ["the scanner's own rule", { source: 'scanner', justification: 'ignored by grype (kernel headers)' }, "A rule of the scanner's own: ignored by grype (kernel headers)."],
    ["the scanner's own rule, unexplained", { source: 'scanner' }, "A rule of the scanner's own."],
    ["the publisher's scan, with a statement this run didn't see", undefined, "The publisher's scan suppressed it, with a statement this run didn't see."],
    ['a source this portal does not know', { source: 'oracle' as 'vex', file: 'x' }, 'oracle x.'],
  ];
  for (const [name, by, want] of cases) assert.equal(suppressionWords(finding(by)), want, name);
});

test("a rescan's status: scanned, or couldn't check, never clean", () => {
  assert.equal(rescanStatus('scanned').tone, 'good');
  assert.equal(rescanStatus('unknown').tone, 'unknown');
  assert.match(rescanStatus('unknown').meaning, /unknown\. Not clean, and not a pass\./);
  assert.equal(rescanStatus('partial').tone, 'unknown');
  assert.equal(rescanStatus('partial').label, 'partial');
});

test('the scan the policy gated on: as the policy says, else what clearcutt-verify defaults to', () => {
  const policy = (p: Partial<Policy>): Policy => ({ required: [], trustedSigners: [], reproduce: false, ...p });
  assert.equal(gatingScan(policy({})), 'attestation');
  assert.equal(gatingScan(policy({ rescan: true })), 'worst');
  assert.equal(gatingScan(policy({ rescan: true, scanSource: 'rescan' })), 'rescan');
  assert.equal(gatingScan(policy({ scanSource: 'attestation' })), 'attestation');
  assert.match(scanSourceWords('worst'), /^both scans/);
  assert.match(scanSourceWords('newest'), /"newest", which this version of the portal doesn't know/);
});

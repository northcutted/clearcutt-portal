import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareToConstraint, compareVersions, inRange, schemeOf, type Constraint, type Scheme } from '../src/lib/versions.ts';

/** Asserts each version is older than the next. */
function ascending(scheme: Scheme, versions: string[]) {
  for (let i = 0; i < versions.length - 1; i++) {
    const [a, b] = [versions[i], versions[i + 1]];
    assert.equal(compareVersions(a, b, scheme), -1, `${scheme}: ${a} < ${b}`);
    assert.equal(compareVersions(b, a, scheme), 1, `${scheme}: ${b} > ${a}`);
  }
  for (const v of versions) assert.equal(compareVersions(v, v, scheme), 0, `${scheme}: ${v} = ${v}`);
}

const c = (op: Constraint['op'], version: string): Constraint => ({ op, version });

test('package types map to their ecosystem ordering', () => {
  assert.equal(schemeOf('apk'), 'apk');
  assert.equal(schemeOf('deb'), 'deb');
  assert.equal(schemeOf('RPM'), 'rpm');
  assert.equal(schemeOf('golang'), 'semver');
  assert.equal(schemeOf('npm'), 'semver');
  assert.equal(schemeOf('pypi'), 'pep440');
  assert.equal(schemeOf('maven'), 'generic');
  assert.equal(schemeOf('something-new'), 'generic');
});

test('apk: components, letters, suffixes, and revisions in apk-tools order', () => {
  ascending('apk', [
    '2.13.9-r0',
    '2.14',
    '2.14.0_alpha1',
    '2.14.0_beta2',
    '2.14.0_pre1',
    '2.14.0_rc1',
    '2.14.0_rc2',
    '2.14.0',
    '2.14.0-r1',
    '2.14.0-r10',
    '2.14.0_p1',
    '2.14.0a',
    '2.14.0b-r0',
    '2.14.1',
    '2.14.10',
  ]);
  assert.equal(compareVersions('1.3.2.1_rc20260917-r0', '1.3.2.1', 'apk'), -1);
  assert.equal(compareVersions('20260909-r2', '20250911-r0', 'apk'), 1);
  // Digit runs longer than a double holds still compare as numbers.
  assert.equal(compareVersions('1.123456789012345678901', '1.123456789012345678900', 'apk'), 1);
});

test('apk: a version apk-tools would not parse falls back to the generic order', () => {
  assert.equal(compareVersions('1.2.3-weird', '1.2.4-weird', 'apk'), -1);
  assert.equal(compareVersions('foo', 'foo', 'apk'), 0);
});

test('deb: epochs, revisions, and ~ pre-releases as dpkg orders them', () => {
  ascending('deb', [
    '1.0~~',
    '1.0~~a',
    '1.0~',
    '1.0~rc1',
    '1.0',
    '1.0-1',
    '1.0a',
    '1.0+b1',
    '1.0.1',
    '1.1',
    '1:0.9',
    '2:0.1',
  ]);
  assert.equal(compareVersions('3.5.7-1~deb13u3', '3.5.7-1', 'deb'), -1);
  assert.equal(compareVersions('2.41-12+deb13u4', '2.41-12', 'deb'), 1);
  assert.equal(compareVersions('5.2.37-2+b10', '5.2.37-2+b9', 'deb'), 1);
  assert.equal(compareVersions('1.0', '1.00', 'deb'), 0);
  assert.equal(compareVersions('0:1.0', '1.0', 'deb'), 0);
});

test('rpm: epochs, releases, ~ and ^ as rpmvercmp orders them', () => {
  ascending('rpm', ['1.0~rc1', '1.0', '1.0^git1', '1.0a', '1.0.1', '1.1', '1:0.1']);
  // A number is newer than letters in the same place.
  assert.equal(compareVersions('1.0.1', '1.0a', 'rpm'), 1);
  assert.equal(compareVersions('2.34-231.amzn2023.0.5', '2.34-100.amzn2023.0.9', 'rpm'), 1);
  assert.equal(compareVersions('1:3.5.8-1.amzn2023.0.1', '3.6.0-1', 'rpm'), 1);
  // Separators alone don't make versions differ; leftover segments do.
  assert.equal(compareVersions('1.0', '1_0', 'rpm'), 0);
  assert.equal(compareVersions('1.0', '1.0.', 'rpm'), 0);
  assert.equal(compareVersions('1.0', '1.0.0', 'rpm'), -1);
});

test('semver: pre-releases before their release, Go pseudo-versions and stdlib included', () => {
  ascending('semver', ['v1.2.3-alpha', 'v1.2.3-alpha.1', 'v1.2.3-alpha.beta', 'v1.2.3-beta.2', 'v1.2.3-beta.11', 'v1.2.3-rc.1', 'v1.2.3', 'v1.2.4', 'v1.10.0']);
  assert.equal(compareVersions('v1.36.11-20260415201107-50325440f8f2.1', 'v1.36.11', 'semver'), -1);
  assert.equal(compareVersions('go1.27.0', 'go1.9.5', 'semver'), 1);
  assert.equal(compareVersions('1.2.3+build.5', '1.2.3', 'semver'), 0);
  // Not semver: compared the generic way.
  assert.equal(compareVersions('v1.2.3.4.5', 'v1.2.3.4.10', 'semver'), -1);
});

test('pep440: dev, pre, final, and post releases, and epochs', () => {
  ascending('pep440', ['1.0.dev1', '1.0a1.dev1', '1.0a1', '1.0b2', '1.0rc1', '1.0', '1.0.post1.dev1', '1.0.post1', '1.1', '1!0.1']);
  assert.equal(compareVersions('1.0', '1.0.0', 'pep440'), 0);
  assert.equal(compareVersions('1.0-1', '1.0.post1', 'pep440'), 0);
  assert.equal(compareVersions('4.16.1.3', '4.16.1', 'pep440'), 1);
});

test('generic: numbers as numbers, after an optional leading v', () => {
  ascending('generic', ['1.9', 'v1.10', '2.42-100', '15.3.0']);
});

test('a constraint compares only the parts it gives', () => {
  // The headline case: libxml2 <2.14.
  assert.ok(inRange('2.13.9-r0', [[c('<', '2.14')]], 'apk'));
  assert.ok(!inRange('2.14.0-r1', [[c('<', '2.14')]], 'apk'));
  assert.ok(inRange('2.14.0-r1', [[c('=', '2.14.0')]], 'apk'));
  assert.ok(!inRange('2.14.0-r1', [[c('=', '2.14.0-r0')]], 'apk'));
  assert.ok(inRange('2.14.0-r5', [[c('<=', '2.14.0')]], 'apk'));
  // Without an epoch, the package's epoch is ignored; with one, it counts.
  assert.equal(compareToConstraint('1:1.3.dfsg+really1.3.1-1+b1', '1.3.2', 'deb'), 1);
  assert.equal(compareToConstraint('1:3.5.8-1.amzn2023.0.1', '3.5.9', 'rpm'), -1);
  assert.equal(compareToConstraint('1:3.5.8-1.amzn2023.0.1', '2:3.0', 'rpm'), -1);
  assert.equal(compareToConstraint('3.5.8-1', '1:3.0', 'rpm'), -1);
  // Without a revision or release, the package's is ignored.
  assert.equal(compareToConstraint('3.5.7-1~deb13u3', '3.5.7', 'deb'), 0);
  assert.equal(compareToConstraint('3.5.7-1~deb13u3', '3.5.7-1', 'deb'), -1);
  assert.equal(compareToConstraint('2.34-231.amzn2023.0.5', '2.34', 'rpm'), 0);
  // A ~ pre-release is older than the release it leads to.
  assert.ok(inRange('2.14.0~rc1-1', [[c('<', '2.14.0')]], 'deb'));
});

test('ranges: every constraint of an alternative, any alternative', () => {
  const openssl = [[c('>=', '3.0'), c('<', '3.0.15')]];
  assert.ok(inRange('3.0.14-r0', openssl, 'apk'));
  assert.ok(!inRange('3.0.15-r0', openssl, 'apk'));
  assert.ok(!inRange('1.1.1w-r0', openssl, 'apk'));
  const either = [[c('<', '1.1.1w')], ...openssl];
  assert.ok(inRange('1.1.1v-r0', either, 'apk'));
  assert.ok(inRange('3.0.2-r3', either, 'apk'));
  assert.ok(!inRange('3.3.0-r0', either, 'apk'));
  assert.ok(inRange('anything', [], 'apk'));
  assert.ok(inRange('3.3', [[c('!=', '3.2')]], 'generic'));
});

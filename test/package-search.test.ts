import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBundle } from '../src/lib/bundle.ts';
import {
  answerFor,
  buildSearchIndex,
  describeRanges,
  indexTypes,
  nameMatcher,
  parseQuery,
  search,
  type IndexImage,
  type PackageQuery,
  type SearchIndex,
} from '../src/lib/package-search.ts';
import { FIXTURE, editedBundle } from './helpers.ts';

function query(text: string, types: string[] = ['apk', 'deb', 'rpm']): PackageQuery {
  const parsed = parseQuery(text, types);
  assert.ok(parsed.ok, `${text}: ${parsed.ok ? '' : parsed.error}`);
  return parsed.query;
}

function error(text: string): string {
  const parsed = parseQuery(text, ['deb']);
  assert.ok(!parsed.ok, `${text} should not parse`);
  return parsed.error;
}

test('a query is a name and, optionally, versions', () => {
  assert.deepEqual(query('libxml2'), { type: undefined, name: 'libxml2', ranges: [] });
  assert.deepEqual(query('libxml2 <2.14'), { type: undefined, name: 'libxml2', ranges: [[{ op: '<', version: '2.14' }]] });
  assert.deepEqual(query('  libxml2<2.14  ').ranges, [[{ op: '<', version: '2.14' }]]);
  assert.deepEqual(query('libxml2 < 2.14').ranges, [[{ op: '<', version: '2.14' }]]);
  assert.deepEqual(query('openssl >=3.0,<3.0.15').ranges, [[{ op: '>=', version: '3.0' }, { op: '<', version: '3.0.15' }]]);
  assert.deepEqual(query('openssl >=3.0, <3.0.15').ranges, query('openssl >=3.0 <3.0.15').ranges);
  assert.deepEqual(query('openssl <1.1.1w || >=3.0,<3.0.15').ranges, [
    [{ op: '<', version: '1.1.1w' }],
    [{ op: '>=', version: '3.0' }, { op: '<', version: '3.0.15' }],
  ]);
  assert.deepEqual(query('zlib1g 1:1.3.dfsg-1').ranges, [[{ op: '=', version: '1:1.3.dfsg-1' }]]);
  assert.deepEqual(query('zlib1g ==1.3').ranges, [[{ op: '=', version: '1.3' }]]);
  assert.deepEqual(query('zlib1g !=1.3').ranges, [[{ op: '!=', version: '1.3' }]]);
  assert.deepEqual(query('libssl3 <3.0.2~rc1').ranges, [[{ op: '<', version: '3.0.2~rc1' }]]);
  assert.equal(describeRanges(query('openssl <1.1.1w || >=3.0,<3.0.15').ranges), '<1.1.1w or >=3.0, <3.0.15');
});

test('a type prefix filters only when it is a type in the index', () => {
  assert.deepEqual(query('deb:openssl <3'), { type: 'deb', name: 'openssl', ranges: [[{ op: '<', version: '3' }]] });
  assert.deepEqual(query('DEB:openssl'), { type: 'deb', name: 'openssl', ranges: [] });
  // Maven names have a colon of their own.
  assert.deepEqual(query('org.apache:commons-text <1.10', ['maven']).name, 'org.apache:commons-text');
  assert.equal(query('org.apache:commons-text', ['maven']).type, undefined);
});

test('a query that cannot be read says why, never matches everything', () => {
  assert.match(error(''), /Type a package name/);
  assert.match(error('<2.14'), /Start with a package name/);
  assert.match(error('libxml2 <'), /"<" needs a version/);
  assert.match(error('libxml2 <2.14 ||'), /Each side of "\|\|" needs a version/);
  assert.match(error('libxml2 <2.14 | >3'), /Can't read "\| >3"/);
  assert.match(error('libxml2 ^2.14'), /~ and \^ ranges aren't supported/);
  assert.match(error('libxml2 ~2.14'), /~ and \^ ranges aren't supported/);
  assert.match(error('libxml2 2.*'), /\* works only in a name/);
  assert.match(error('deb:'), /Name a package after "deb:"/);
});

test('names match in any case, with * as a wildcard and nothing else special', () => {
  assert.ok(nameMatcher('LibXML2')('libxml2'));
  assert.ok(!nameMatcher('libxml2')('libxml2-utils'));
  assert.ok(nameMatcher('libxml2*')('libxml2-utils'));
  assert.ok(nameMatcher('*ssl*')('libssl3'));
  assert.ok(!nameMatcher('lib.ml2')('libxml2'), '. is not a wildcard');
  assert.ok(nameMatcher('c++')('c++'));
  assert.ok(!nameMatcher('(a|b)')('a'));
});

// A small estate: base ships zlib 1.3.1-r0; mid is built on base and has no
// package list; app is built on mid; fork is built on an older base and
// lists zlib 1.3.2-r0; slim is on base and lists no zlib; other ships zlib
// itself and is on nothing.
function estate(): SearchIndex {
  const image = (id: string, packages: IndexImage['packages'], base?: IndexImage['base']): IndexImage => ({
    id,
    label: `${id}:latest`,
    href: `/images/${id}/`,
    packages,
    ...(base ? { base } : {}),
  });
  return {
    images: [
      image('app', 'known', { id: 'mid', strength: 'declared', exact: null }),
      image('base', 'known'),
      image('fork', 'partial', { id: 'base', strength: 'proof', exact: false }),
      image('mid', 'unknown', { id: 'base', strength: 'proof', exact: true }),
      image('other', 'known'),
      image('slim', 'known', { id: 'base', strength: 'proof', exact: true }),
      image('top', 'known', { id: 'app', strength: 'proof', exact: true }),
    ],
    packages: [
      {
        name: 'zlib',
        type: 'apk',
        href: '/packages/apk-zlib/',
        versions: [
          { version: '1.3.1-r0', images: ['base', 'other'] },
          { version: '1.3.2-r0', images: ['fork'] },
        ],
      },
      { name: 'zlib-dev', type: 'apk', href: '/packages/apk-zlib-dev/', versions: [{ version: '1.3.1-r0', images: ['base'] }] },
    ],
  };
}

test('an image built on one that ships a version inherits it, through images whose packages are unknown', () => {
  const result = search(estate(), query('zlib <1.3.2'));
  assert.equal(result.answers.length, 1);
  const [zlib] = result.answers;
  assert.deepEqual(zlib.matching, [{ version: '1.3.1-r0', images: ['base', 'other'] }]);
  assert.deepEqual(zlib.direct, [{ id: 'base', versions: ['1.3.1-r0'] }, { id: 'other', versions: ['1.3.1-r0'] }]);
  const byId = new Map(zlib.inherited.map((i) => [i.id, i]));
  // mid has no package list: it inherits, proven, on the exact version.
  assert.deepEqual(byId.get('mid'), {
    id: 'mid',
    from: 'base',
    versions: ['1.3.1-r0'],
    via: ['base'],
    strength: 'proof',
    exact: true,
    own: 'unknown',
    ownVersions: [],
    ownPartial: false,
  });
  // app is two links up, and the weakest link (declared) and the unknown
  // version travel with it. Its own list lacks zlib, so top, built on app,
  // does not inherit.
  assert.deepEqual(
    { ...byId.get('app'), versions: undefined },
    { id: 'app', from: 'base', versions: undefined, via: ['mid', 'base'], strength: 'declared', exact: null, own: 'not-listed', ownVersions: [], ownPartial: false },
  );
  assert.ok(!byId.has('top'));
  // fork lists another version, and is on an older base than the one read.
  assert.deepEqual(
    [byId.get('fork')?.own, byId.get('fork')?.ownVersions, byId.get('fork')?.exact, byId.get('fork')?.ownPartial],
    ['other-version', ['1.3.2-r0'], false, true],
  );
  assert.equal(byId.get('slim')?.own, 'not-listed');
  assert.deepEqual(result.unknown, ['mid']);
});

test('an image that ships it itself is direct, and says when its base ships it too', () => {
  const answer = search(estate(), query('zlib')).answers[0];
  assert.deepEqual(answer.direct.find((d) => d.id === 'fork'), { id: 'fork', versions: ['1.3.2-r0'], baseToo: 'base' });
  assert.ok(!answer.inherited.some((i) => i.id === 'fork'));
});

test('a range that matches no version answers nothing for that package', () => {
  const index = estate();
  assert.deepEqual(search(index, query('zlib <1.3')).answers, []);
  assert.deepEqual(search(index, query('zlib >=1.3.2')).answers.map((a) => a.matching.map((m) => m.version)), [['1.3.2-r0']]);
  assert.deepEqual(search(index, query('zlib* <1.3.2')).answers.map((a) => a.name), ['zlib', 'zlib-dev']);
  assert.deepEqual(search(index, query('rpm:zlib')).answers, []);
  const capped = search(index, query('zlib*'), 1);
  assert.equal(capped.answers.length, 1);
  assert.equal(capped.more, 1);
});

test('a base cycle does not loop', () => {
  const index = estate();
  index.images.find((i) => i.id === 'base')!.base = { id: 'top', strength: 'proof', exact: true };
  index.images.find((i) => i.id === 'app')!.packages = 'unknown';
  const answer = answerFor(index, index.packages[0], new Set(['1.3.1-r0']));
  assert.deepEqual(answer.inherited.map((i) => i.id).sort(), ['app', 'fork', 'mid', 'slim', 'top']);
});

test('the fixture index answers with its real packages and base links', () => {
  const report = readBundle(FIXTURE).report;
  const index = buildSearchIndex(report, { image: (id) => `/images/${id}/`, package: (slug) => `/packages/${slug}/` });
  assert.equal(index.images.length, report.images.length);
  assert.deepEqual(index.images.find((i) => i.id === 'platform-tools')?.base, { id: 'wolfi-base', strength: 'proof', exact: true });
  assert.equal(index.images.find((i) => i.id === 'amazonlinux-2023')?.packages, 'unknown');
  assert.ok(indexTypes(index).includes('apk'));

  const zlib = search(index, query('apk:zlib <1.3.2.1', indexTypes(index))).answers;
  assert.deepEqual(zlib.map((a) => [a.type, a.name, a.matching.map((m) => m.version)]), [['apk', 'zlib', ['1.3.2.1_rc20260917-r0']]]);
  assert.deepEqual(zlib[0].direct, [{ id: 'platform-tools', versions: ['1.3.2.1_rc20260917-r0'], baseToo: 'wolfi-base' }, { id: 'wolfi-base', versions: ['1.3.2.1_rc20260917-r0'] }]);

  // Every version of openssl-libs (epoch 1) is under 3.6 once the epoch is left out.
  assert.equal(search(index, query('openssl-libs <3.6', indexTypes(index))).answers[0]?.matching.length, 1);
  assert.deepEqual(search(index, query('openssl-libs <1:3.5', indexTypes(index))).answers, []);
});

test('in the fixture, an app whose own SBOM is gone still inherits from its base', () => {
  const bundle = editedBundle(FIXTURE, (r) => {
    const tools = r.images.find((i: any) => i.id === 'platform-tools');
    delete tools.packages;
    delete tools.packagesSource;
    for (const pkg of r.packages) pkg.images = pkg.images.filter((id: string) => id !== 'platform-tools');
    r.packages = r.packages.filter((pkg: any) => pkg.images.length > 0);
  });
  const index = buildSearchIndex(readBundle(bundle).report, { image: (id) => id, package: (slug) => slug });
  const [busybox] = search(index, query('busybox <1.38.1', indexTypes(index))).answers;
  assert.deepEqual(busybox.direct.map((d) => d.id), ['wolfi-base']);
  assert.deepEqual(
    busybox.inherited.map((i) => [i.id, i.from, i.strength, i.exact, i.own]),
    [['platform-tools', 'wolfi-base', 'proof', true, 'unknown']],
  );
});

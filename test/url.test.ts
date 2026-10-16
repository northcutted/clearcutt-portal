import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeHttpUrl } from '../src/lib/url.ts';

test('absolute http and https URLs become links', () => {
  assert.equal(safeHttpUrl('https://github.com/acme/images'), 'https://github.com/acme/images');
  assert.equal(safeHttpUrl('http://git.example.test/repo'), 'http://git.example.test/repo');
  assert.equal(safeHttpUrl('HTTPS://GitHub.com/acme'), 'https://github.com/acme');
});

test('script and other schemes stay text, however they are spelled', () => {
  for (const value of [
    'javascript:alert(document.domain)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    '\u0000javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'mailto:security@example.test',
    'git+ssh://git@github.com/acme/images.git',
  ]) {
    assert.equal(safeHttpUrl(value), undefined, value);
  }
});

test('relative and malformed values stay text', () => {
  for (const value of ['', '//evil.example/x', '/acme/images', 'github.com/acme/images', 'https://', 'not a url']) {
    assert.equal(safeHttpUrl(value), undefined, value);
  }
  assert.equal(safeHttpUrl(undefined), undefined);
});

test('URLs with credentials stay text, since they read as one host and go to another', () => {
  assert.equal(safeHttpUrl('https://github.com@evil.example/acme'), undefined);
  assert.equal(safeHttpUrl('https://user:secret@github.com/acme'), undefined);
});

test('a link is the normalized URL, so it cannot break out of its attribute', () => {
  assert.equal(safeHttpUrl('https://example.test/a"><script>x</script>'), 'https://example.test/a%22%3E%3Cscript%3Ex%3C/script%3E');
});

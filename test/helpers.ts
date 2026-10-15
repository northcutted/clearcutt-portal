import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..');
export const FIXTURE = path.join(root, 'contract/fixtures/northcutted-images');
export const MINIMAL = path.join(root, 'contract/examples/minimal');

/**
 * A writable copy of a bundle, with its report passed through `edit` and,
 * when given, its history through `editHistory`.
 */
export function editedBundle(from: string, edit: (report: any) => void, editHistory?: (history: any) => void): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'portal-bundle-'));
  cpSync(from, dir, { recursive: true });
  const rewrite = (name: string, fn: (doc: any) => void) => {
    const file = path.join(dir, name);
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    fn(doc);
    writeFileSync(file, JSON.stringify(doc));
  };
  rewrite('estate-report.json', edit);
  if (editHistory) rewrite('estate-history.json', editHistory);
  return dir;
}

const FACTORY_SIGNER = {
  identityRegexp: '^https://github\\.com/northcutted/clearcutt-factory/',
  issuer: 'https://token.actions.githubusercontent.com',
};
export const STACK_REF = 'ghcr.io/northcutted/stacks/go:1';
export const STACK_TAG_DIGEST = `sha256:${'c'.repeat(64)}`;

/**
 * The fixture with every field clearcutt-verify v0.15 can write that the
 * fixture itself doesn't exercise: hello-app on a registry stack one version
 * behind its tag, stack signers, a scan-age limit, base platforms, an image
 * whose package source isn't recorded, and per-image rows in two runs.
 */
export function v015Bundle(): string {
  return editedBundle(
    FIXTURE,
    (r) => {
      const image = (id: string) => r.images.find((i: any) => i.id === id);
      const hello = image('hello-app');
      hello.factory.stackRef = STACK_REF;
      r.stacks = [
        {
          repository: 'ghcr.io/northcutted/stacks/go',
          ref: STACK_REF,
          currentDigest: STACK_TAG_DIGEST,
          versions: [
            {
              digest: hello.factory.stackDigest,
              current: false,
              signature: { status: 'verified', source: 'cosign-signature', signer: FACTORY_SIGNER },
              images: ['hello-app'],
            },
          ],
          consumers: 1,
          staleConsumers: 1,
        },
      ];
      r.policy.stackSigners = [FACTORY_SIGNER];
      r.policy.maxScanAgeDays = 7;
      r.bases.find((b: any) => b.repository === 'cgr.dev/chainguard/wolfi-base').currentPlatform = 'linux/amd64';
      image('platform-tools').base.platform = 'linux/amd64';
      delete image('debian-tools').packagesSource;
    },
    (h) => {
      // The run before the latest gets rows too, as clearcutt-verify v0.15
      // wrote them (no finding IDs or package digests): debian-tools was
      // failing on another digest, platform-tools' base was stale, static
      // wasn't there, and an image since removed was.
      const [latest, previous] = h.entries;
      previous.images = structuredClone(latest.images)
        .filter((i: any) => i.id !== 'static')
        .map(({ fixableFindings, packagesDigest, ...i }: any) => {
          if (i.id === 'debian-tools') {
            return { ...i, verdict: 'failed', digest: `sha256:${'d'.repeat(64)}`, vulnerabilities: { ...i.vulnerabilities, critical: 30 } };
          }
          if (i.id === 'platform-tools') return { ...i, base: { ...i.base, drift: 'stale' } };
          return i;
        })
        .concat([{ id: 'retired-image', digest: `sha256:${'e'.repeat(64)}`, verdict: 'verified' }]);
    },
  );
}
